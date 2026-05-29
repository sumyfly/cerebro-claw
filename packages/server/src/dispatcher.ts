import type { ActionLedger, ActionLedgerEntry, CustomerChannel } from "@cerebro-claw/shared";

/**
 * NotifyThenActDispatcher — wakes up periodically, finds notify-then-act
 * entries whose pause window has elapsed, and dispatches the customer send.
 *
 * Lives in the server process (not in the agent runtime) so the send can
 * happen even when no agent turn is running. The ledger is the source of
 * truth — the dispatcher just polls.
 *
 * Failure handling: if the customer channel throws, the entry is marked
 * "failed" with the error message. The next digest surfaces failed entries
 * so the CSM knows something needs a manual touch.
 */
export interface NotifyThenActDispatcherOptions {
	ledger: ActionLedger;
	customerChannel: CustomerChannel;
	/** Poll interval in ms. Default 60s. */
	intervalMs?: number;
	/** Clock override for tests. */
	now?: () => Date;
	/** Optional hook fired after each dispatch attempt. */
	onDispatch?: (entry: ActionLedgerEntry, outcome: "executed" | "failed") => void;
}

export class NotifyThenActDispatcher {
	private ledger: ActionLedger;
	private channel: CustomerChannel;
	private intervalMs: number;
	private now: () => Date;
	private onDispatch?: NotifyThenActDispatcherOptions["onDispatch"];
	private timer: ReturnType<typeof setInterval> | null = null;
	private running = false;

	constructor(opts: NotifyThenActDispatcherOptions) {
		this.ledger = opts.ledger;
		this.channel = opts.customerChannel;
		this.intervalMs = opts.intervalMs ?? 60_000;
		this.now = opts.now ?? (() => new Date());
		this.onDispatch = opts.onDispatch;
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
	async tick(): Promise<{ dispatched: number; failed: number }> {
		if (this.running) return { dispatched: 0, failed: 0 };
		this.running = true;
		let dispatched = 0;
		let failed = 0;
		try {
			const due = await this.ledger.listDue(this.now());
			for (const entry of due) {
				const outcome = await this.dispatchOne(entry);
				if (outcome === "executed") dispatched += 1;
				else if (outcome === "failed") failed += 1;
			}
			if (dispatched + failed > 0) {
				console.log(
					`[dispatcher] Tick: ${dispatched} executed, ${failed} failed`,
				);
			}
		} catch (err) {
			console.error("[dispatcher] Tick error:", err);
		} finally {
			this.running = false;
		}
		return { dispatched, failed };
	}

	private async dispatchOne(entry: ActionLedgerEntry): Promise<"executed" | "failed" | "skipped"> {
		const payload = entry.payload as { recipient?: string; text?: string } | undefined;
		if (!payload?.recipient || !payload.text) {
			await this.ledger.update(entry.id, {
				status: "failed",
				note: "payload missing recipient or text",
			});
			this.onDispatch?.(entry, "failed");
			return "failed";
		}
		try {
			const result = await this.channel.send({
				customerId: entry.customerId,
				recipient: payload.recipient,
				text: payload.text,
				meta: { actionId: entry.id, customerName: entry.customerName },
			});
			await this.ledger.update(entry.id, {
				status: "executed",
				executedAt: result.deliveredAt,
				payload: { ...payload, messageId: result.messageId },
			});
			this.onDispatch?.(entry, "executed");
			return "executed";
		} catch (err) {
			await this.ledger.update(entry.id, {
				status: "failed",
				note: `Customer channel error: ${(err as Error).message}`,
			});
			this.onDispatch?.(entry, "failed");
			return "failed";
		}
	}
}
