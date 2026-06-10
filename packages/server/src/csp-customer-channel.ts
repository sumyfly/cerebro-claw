import type { CustomerChannel } from "@cerebro-claw/shared";

/**
 * CspCustomerChannel — the real customer effector, without an external
 * messaging integration: a dispatched notify-then-act send is written into CSP
 * as a CSM activity (the system of record the CSM and the next work-loop cycle
 * both read), plus a note carrying the full body for team visibility.
 *
 * The activity write is authoritative: if it fails, the send failed (the
 * dispatcher marks the ledger entry `failed`). The note is best-effort —
 * a note failure after a successful activity write must not flip a delivered
 * send to failed, so it only logs.
 *
 * Subjects are prefixed "agent:" so agent-sent touches are distinguishable
 * from CSM-authored activities in CSP reporting (see docs/extending.md).
 */
export interface CspCustomerChannelOptions {
	baseUrl: string;
	token: string;
	timeoutMs?: number;
	/** Clock override (tests). */
	now?: () => Date;
}

interface CspResponse {
	ok: boolean;
	status: number;
	body: unknown;
}

/** Pull the created object's id out of a CSP `{data: {...}}` response. */
function extractId(body: unknown): string | undefined {
	if (!body || typeof body !== "object") return undefined;
	const b = body as { data?: { id?: unknown }; id?: unknown };
	const id = b.data?.id ?? b.id;
	return id != null ? String(id) : undefined;
}

export class CspCustomerChannel implements CustomerChannel {
	readonly id = "csp";
	private baseUrl: string;
	private token: string;
	private timeoutMs: number;
	private now: () => Date;

	constructor(opts: CspCustomerChannelOptions) {
		this.baseUrl = opts.baseUrl.replace(/\/$/, "");
		this.token = opts.token;
		this.timeoutMs = opts.timeoutMs ?? 10_000;
		this.now = opts.now ?? (() => new Date());
	}

	private async post(path: string, body: unknown): Promise<CspResponse> {
		const ac = new AbortController();
		const t = setTimeout(() => ac.abort(), this.timeoutMs);
		try {
			const res = await fetch(`${this.baseUrl}/api/v1${path}`, {
				method: "POST",
				headers: {
					Authorization: `Bearer ${this.token}`,
					Accept: "application/json",
					"Content-Type": "application/json",
				},
				body: JSON.stringify(body),
				signal: ac.signal,
			});
			let parsed: unknown;
			try {
				parsed = await res.json();
			} catch {
				parsed = undefined;
			}
			return { ok: res.ok, status: res.status, body: parsed };
		} finally {
			clearTimeout(t);
		}
	}

	async send(input: {
		customerId: string;
		recipient: string;
		text: string;
		meta?: Record<string, unknown>;
	}): Promise<{ messageId: string; deliveredAt: Date }> {
		const ts = this.now();
		const isEmail = input.recipient.includes("@");
		const activity = await this.post("/csm-activities", {
			businessId: input.customerId,
			type: isEmail ? "EMAIL" : "MESSAGE",
			subject: `agent: outbound ${isEmail ? "email" : "message"} to ${input.recipient}`,
			summary: input.text,
			occurredAt: ts.toISOString(),
		});
		if (!activity.ok) {
			throw new Error(
				`CSP activity write failed (HTTP ${activity.status}): ${JSON.stringify(activity.body)}`,
			);
		}
		const activityId = extractId(activity.body);

		// Best-effort note for team visibility — never undoes a delivered send.
		const note = await this.post("/notes", {
			businessId: input.customerId,
			title: `agent: sent to ${input.recipient}`,
			content: input.text,
			type: "GENERAL",
		}).catch((err) => {
			console.error(`[csp-customer-channel] note write errored: ${(err as Error).message}`);
			return { ok: false, status: 0, body: undefined } as CspResponse;
		});
		if (!note.ok) {
			console.error(
				`[csp-customer-channel] note write failed for ${input.customerId} (HTTP ${note.status})`,
			);
		}

		return {
			messageId: activityId ?? extractId(note.body) ?? "csp-activity",
			deliveredAt: ts,
		};
	}

	async call(input: {
		customerId: string;
		recipient: string;
		script: string;
		meta?: Record<string, unknown>;
	}): Promise<{ callId: string; placedAt: Date }> {
		const ts = this.now();
		const activity = await this.post("/csm-activities", {
			businessId: input.customerId,
			type: "CALL",
			subject: `agent: call to ${input.recipient}`,
			summary: input.script,
			occurredAt: ts.toISOString(),
		});
		if (!activity.ok) {
			throw new Error(
				`CSP call-activity write failed (HTTP ${activity.status}): ${JSON.stringify(activity.body)}`,
			);
		}
		return { callId: extractId(activity.body) ?? "csp-activity", placedAt: ts };
	}
}
