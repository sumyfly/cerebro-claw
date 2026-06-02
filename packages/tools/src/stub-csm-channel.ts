import type { ChannelAdapter, ChannelMessageHandler, InboundMessage } from "@cerebro-claw/shared";

export interface CsmInboxEntry {
	kind: "text" | "card";
	recipientId: string;
	text?: string;
	card?: unknown;
	at: Date;
}

/**
 * Offline replacement for the Lark channel. Captures every CSM-facing send and
 * card into an in-memory inbox so the eval can assert on what the agent told
 * the CSM. Inbound replies can be injected via `inject()`.
 */
export class StubCsmChannel implements ChannelAdapter {
	readonly type = "stub-csm";
	private handler: ChannelMessageHandler | null = null;
	private inbox: CsmInboxEntry[] = [];

	async start(handler: ChannelMessageHandler): Promise<void> {
		this.handler = handler;
	}

	async send(recipientId: string, text: string): Promise<void> {
		this.inbox.push({ kind: "text", recipientId, text, at: new Date() });
	}

	async sendCard(recipientId: string, card: unknown): Promise<void> {
		this.inbox.push({ kind: "card", recipientId, card, at: new Date() });
	}

	/** Simulate the CSM replying; returns the handler's response if any. */
	async inject(senderId: string, text: string): Promise<string | null> {
		if (!this.handler) return null;
		const message: InboundMessage = {
			channelType: this.type,
			channelId: "stub-csm",
			senderId,
			senderName: senderId,
			text,
			timestamp: new Date(),
		};
		return this.handler(message);
	}

	getInbox(): CsmInboxEntry[] {
		return [...this.inbox];
	}

	clear(): void {
		this.inbox = [];
	}
}
