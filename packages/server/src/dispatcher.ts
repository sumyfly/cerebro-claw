import { hostname } from "node:os";
import type { ActionLedger, ActionLedgerEntry, CustomerChannel } from "@cerebro-claw/shared";

/**
 * NotifyThenActDispatcher — picks up due notify-then-act ledger rows and
 * delivers them through the registered CustomerChannel.
 *
 * Reliability model (v2):
 *
 *  - CAS lease. `claimForDispatch` is an atomic UPDATE that flips status
 *    in-flight → claimed in one statement; only one worker can win. The next
 *    poller / restart never re-races a claim.
 *  - Idempotency. Every row's `idempotency_key` is UNIQUE in the ledger and
 *    flows down to the CustomerChannel as `meta.idempotencyKey`. Channels that
 *    support at-most-once semantics use it.
 *  - Cancel-after-claim. We re-read the row after claiming and right before
 *    sending. If the CSM hit cancel during that window we abort and revert
 *    to cancelled.
 *  - Retries. Failed sends bump attempt_count (already done by the claim
 *    UPDATE). Under maxAttempts the row goes back to in-flight with a backoff
 *    on execute_at; at the budget the row goes to dead-letter AND the
 *    handler opens an escalate so a human catches the bounce.
 *
 * Lifetime. Lives in the server process; the brain loop doesn't touch it.
 */
export interface NotifyThenActDispatcherOptions {
	ledger: ActionLedger;
	customerChannel: CustomerChannel;
	/** Poll interval in ms. Default 60s. */
	intervalMs?: number;
	/** Clock override for tests. */
	now?: () => Date;
	/** Optional hook fired after each dispatch attempt. */
	onDispatch?: (entry: ActionLedgerEntry, outcome: "executed" | "failed" | "dead-letter") => void;
	/** Retry budget. Default 3 attempts before dead-letter. */
	maxAttempts?: number;
	/** Backoff schedule in minutes between retries. Default [1, 5, 30]. */
	backoffMinutes?: number[];
	/**
	 * Called when a row hits the retry budget. Lets the host open an escalate /
	 * notify the CSM so the failed customer touch doesn't get lost as a number.
	 * Receives the dead-lettered entry and the last error message.
	 */
	onDeadLetter?: (entry: ActionLedgerEntry, error: string) => Promise<void> | void;
}

const DEFAULT_BACKOFF_MINUTES = [1, 5, 30];

export class NotifyThenActDispatcher {
	private ledger: ActionLedger;
	private channel: CustomerChannel;
	private intervalMs: number;
	private now: () => Date;
	private onDispatch?: NotifyThenActDispatcherOptions["onDispatch"];
	private maxAttempts: number;
	private backoffMinutes: number[];
	private onDeadLetter?: NotifyThenActDispatcherOptions["onDeadLetter"];
	private timer: ReturnType<typeof setInterval> | null = null;
	private running = false;
	private workerId: string;

	constructor(opts: NotifyThenActDispatcherOptions) {
		this.ledger = opts.ledger;
		this.channel = opts.customerChannel;
		this.intervalMs = opts.intervalMs ?? 60_000;
		this.now = opts.now ?? (() => new Date());
		this.onDispatch = opts.onDispatch;
		this.maxAttempts = Math.max(1, opts.maxAttempts ?? 3);
		this.backoffMinutes =
			opts.backoffMinutes && opts.backoffMinutes.length > 0
				? opts.backoffMinutes
				: DEFAULT_BACKOFF_MINUTES;
		this.onDeadLetter = opts.onDeadLetter;
		// Identifies which dispatcher claimed a row; informational, written to claimed_by.
		this.workerId = `dispatcher@${hostname()}:${process.pid}`;
	}

	start(): void {
		if (this.timer) return;
		console.log(
			`[dispatcher] Starting — checking every ${this.intervalMs / 1000}s for due notify-then-act sends`,
		);
		this.timer = setInterval(() => this.tick(), this.intervalMs);
		// Fire one tick immediately so a freshly restarted server catches up.
		void this.tick();
	}

	stop(): void {
		if (this.timer) {
			clearInterval(this.timer);
			this.timer = null;
		}
		console.log("[dispatcher] Stopped");
	}

	/** Run a single dispatch pass. Public so tests can drive it directly. */
	async tick(): Promise<{ dispatched: number; failed: number; deadLettered: number }> {
		if (this.running) return { dispatched: 0, failed: 0, deadLettered: 0 };
		this.running = true;
		let dispatched = 0;
		let failed = 0;
		let deadLettered = 0;
		try {
			const due = await this.ledger.listDue(this.now());
			for (const entry of due) {
				const outcome = await this.dispatchOne(entry);
				if (outcome === "executed") dispatched += 1;
				else if (outcome === "failed") failed += 1;
				else if (outcome === "dead-letter") deadLettered += 1;
			}
			if (dispatched + failed + deadLettered > 0) {
				console.log(
					`[dispatcher] Tick: ${dispatched} executed, ${failed} retrying, ${deadLettered} dead-lettered`,
				);
			}
		} catch (err) {
			console.error("[dispatcher] Tick error:", err);
		} finally {
			this.running = false;
		}
		return { dispatched, failed, deadLettered };
	}

	private async dispatchOne(
		entry: ActionLedgerEntry,
	): Promise<"executed" | "failed" | "dead-letter" | "skipped"> {
		// 1) CAS claim — only one worker wins. After this the row is `claimed`
		//    with attempt_count incremented. If the CAS lost (raced or already
		//    not due), bail without changing state.
		const claimed = await this.ledger.claimForDispatch(entry.id, this.now(), this.workerId);
		if (!claimed) return "skipped";

		// 2) Re-read to catch a late cancel. Two possible interleavings:
		//    - cancel UPDATE happened BEFORE claim: claim's WHERE status='in-flight'
		//      would have failed → covered.
		//    - cancel UPDATE happened AFTER claim: status now `cancelled` — we
		//      MUST honor that and stop here.
		const fresh = await this.ledger.get(entry.id);
		if (!fresh) return "skipped";
		if (fresh.status === "cancelled") return "skipped";

		const payload = (fresh.payload ?? {}) as {
			recipient?: string;
			text?: string;
			channel?: string;
		};
		const body = payload.text;
		if (!payload.recipient || !body) {
			await this.handleFailure(fresh, "payload missing recipient or text");
			return fresh.attemptCount && fresh.attemptCount >= this.maxAttempts ? "dead-letter" : "failed";
		}

		const meta = {
			actionId: fresh.id,
			customerName: fresh.customerName,
			// Channels that support at-most-once delivery should use this key.
			idempotencyKey: fresh.idempotencyKey,
			attempt: fresh.attemptCount ?? 1,
		};
		const wantsCall = payload.channel === "call" && typeof this.channel.call === "function";

		try {
			const result = wantsCall
				? // biome-ignore lint/style/noNonNullAssertion: guarded by typeof check above
					await this.channel.call!({
						customerId: fresh.customerId,
						recipient: payload.recipient,
						script: body,
						meta,
					})
				: await this.channel.send({
						customerId: fresh.customerId,
						recipient: payload.recipient,
						text: body,
						meta,
					});
			const messageId = "messageId" in result ? result.messageId : result.callId;
			const deliveredAt = "deliveredAt" in result ? result.deliveredAt : result.placedAt;
			await this.ledger.update(fresh.id, {
				status: "executed",
				executedAt: deliveredAt,
				payload: { ...payload, messageId },
			});
			this.onDispatch?.(fresh, "executed");
			return "executed";
		} catch (err) {
			return await this.handleFailure(fresh, (err as Error).message);
		}
	}

	/**
	 * Update the row after a delivery failure. Under the retry budget the row
	 * goes back to in-flight with a fresh execute_at (backoff); at the budget
	 * it's dead-lettered AND the host is notified so the bounce surfaces to a
	 * human instead of disappearing as a counter.
	 */
	private async handleFailure(
		entry: ActionLedgerEntry,
		errorMessage: string,
	): Promise<"failed" | "dead-letter"> {
		const attempts = entry.attemptCount ?? 1;
		if (attempts >= this.maxAttempts) {
			await this.ledger.update(entry.id, {
				status: "dead-letter",
				note: `Send failed after ${attempts} attempt(s): ${errorMessage}`,
			});
			this.onDispatch?.(entry, "dead-letter");
			if (this.onDeadLetter) {
				try {
					await this.onDeadLetter(entry, errorMessage);
				} catch (cbErr) {
					console.error("[dispatcher] onDeadLetter handler failed:", cbErr);
				}
			}
			return "dead-letter";
		}
		// Pick the backoff for the NEXT attempt. attempts indexes the slot just used.
		const backoffSlot = Math.min(attempts - 1, this.backoffMinutes.length - 1);
		const delayMinutes = this.backoffMinutes[Math.max(0, backoffSlot)];
		const nextAttempt = new Date(this.now().getTime() + delayMinutes * 60_000);
		await this.ledger.update(entry.id, {
			status: "in-flight",
			note: `Attempt ${attempts} failed: ${errorMessage}. Retrying at ${nextAttempt.toISOString()}.`,
			executeAt: nextAttempt,
		});
		this.onDispatch?.(entry, "failed");
		return "failed";
	}
}
