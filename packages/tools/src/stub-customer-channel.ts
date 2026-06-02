import { randomUUID } from "node:crypto";
import type { CustomerChannel } from "@cerebro-claw/shared";

export interface StubCustomerChannelOptions {
	/** Optional hook fired on every send — useful for tests and logging integrations. */
	onSend?: (record: StubSendRecord) => void | Promise<void>;
}

export interface StubSendRecord {
	messageId: string;
	customerId: string;
	recipient: string;
	text: string;
	meta?: Record<string, unknown>;
	deliveredAt: Date;
}

export interface StubCallRecord {
	callId: string;
	customerId: string;
	recipient: string;
	script: string;
	meta?: Record<string, unknown>;
	placedAt: Date;
}

/**
 * Default customer channel — accepts every send, persists nothing, and prints
 * a one-line log so a dev tail can see the agent "doing" things. Real channels
 * (email, SMS, WeChat) drop in by implementing CustomerChannel and replacing
 * this one in the extension wiring.
 *
 * Stubbed because we don't have a real customer-facing send integration yet
 * (Lark in our stack reaches the CSM, not their customers). Stubbing keeps the
 * action-policy loop testable end-to-end without sending real messages.
 */
export class StubCustomerChannel implements CustomerChannel {
	readonly id = "stub";
	private onSend: StubCustomerChannelOptions["onSend"];
	private sent: StubSendRecord[] = [];
	private calls: StubCallRecord[] = [];

	constructor(opts: StubCustomerChannelOptions = {}) {
		this.onSend = opts.onSend;
	}

	async send(input: {
		customerId: string;
		recipient: string;
		text: string;
		meta?: Record<string, unknown>;
	}): Promise<{ messageId: string; deliveredAt: Date }> {
		const record: StubSendRecord = {
			messageId: randomUUID(),
			customerId: input.customerId,
			recipient: input.recipient,
			text: input.text,
			meta: input.meta,
			deliveredAt: new Date(),
		};
		this.sent.push(record);
		console.log(
			`[stub-customer-channel] → ${input.recipient} (${input.customerId}): ${input.text.slice(0, 80)}${input.text.length > 80 ? "…" : ""}`,
		);
		if (this.onSend) await this.onSend(record);
		return { messageId: record.messageId, deliveredAt: record.deliveredAt };
	}

	/** Test affordance — what got sent. */
	getSent(): StubSendRecord[] {
		return [...this.sent];
	}

	async call(input: {
		customerId: string;
		recipient: string;
		script: string;
		meta?: Record<string, unknown>;
	}): Promise<{ callId: string; placedAt: Date }> {
		const record: StubCallRecord = {
			callId: randomUUID(),
			customerId: input.customerId,
			recipient: input.recipient,
			script: input.script,
			meta: input.meta,
			placedAt: new Date(),
		};
		this.calls.push(record);
		console.log(
			`[stub-customer-channel] CALL → ${input.recipient} (${input.customerId}): ${input.script.slice(0, 80)}${input.script.length > 80 ? "…" : ""}`,
		);
		return { callId: record.callId, placedAt: record.placedAt };
	}

	/** Test affordance — what calls were placed. */
	getCalls(): StubCallRecord[] {
		return [...this.calls];
	}
}
