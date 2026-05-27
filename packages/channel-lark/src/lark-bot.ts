import type { InboundMessage } from "@cerebro-claw/shared";

export interface LarkConfig {
	appId: string;
	appSecret: string;
}

export type MessageHandler = (message: InboundMessage) => Promise<void>;

export class LarkBot {
	private config: LarkConfig;
	private accessToken: string | null = null;
	private tokenExpiresAt = 0;
	private handler: MessageHandler | null = null;

	constructor(config: LarkConfig) {
		this.config = config;
	}

	onMessage(handler: MessageHandler): void {
		this.handler = handler;
	}

	async handleWebhook(body: Record<string, unknown>): Promise<Record<string, unknown> | null> {
		// Lark URL verification challenge
		if (body.type === "url_verification") {
			return { challenge: body.challenge };
		}

		const header = body.header as Record<string, unknown> | undefined;
		if (header?.event_type === "im.message.receive_v1") {
			const event = body.event as Record<string, unknown>;
			const sender = event.sender as Record<string, unknown>;
			const senderId = (sender.sender_id as Record<string, unknown>)?.open_id as string;
			const message = event.message as Record<string, unknown>;
			const content = JSON.parse(message.content as string) as { text?: string };

			const inbound: InboundMessage = {
				channelType: "lark",
				channelId: message.chat_id as string,
				senderId,
				senderName: senderId,
				text: content.text ?? "",
				timestamp: new Date(),
				metadata: { messageId: message.message_id },
			};

			if (this.handler) {
				await this.handler(inbound);
			}
		}

		return null;
	}

	async sendMessage(chatId: string, text: string): Promise<void> {
		const token = await this.getAccessToken();
		const resp = await fetch("https://open.larksuite.com/open-apis/im/v1/messages", {
			method: "POST",
			headers: {
				Authorization: `Bearer ${token}`,
				"Content-Type": "application/json",
			},
			body: JSON.stringify({
				receive_id: chatId,
				msg_type: "text",
				content: JSON.stringify({ text }),
			}),
		});
		if (!resp.ok) {
			throw new Error(`Lark API error: ${resp.status} ${await resp.text()}`);
		}
	}

	async sendMessageToUser(userId: string, text: string): Promise<void> {
		const token = await this.getAccessToken();
		const resp = await fetch(
			"https://open.larksuite.com/open-apis/im/v1/messages?receive_id_type=open_id",
			{
				method: "POST",
				headers: {
					Authorization: `Bearer ${token}`,
					"Content-Type": "application/json",
				},
				body: JSON.stringify({
					receive_id: userId,
					msg_type: "text",
					content: JSON.stringify({ text }),
				}),
			},
		);
		if (!resp.ok) {
			throw new Error(`Lark API error: ${resp.status} ${await resp.text()}`);
		}
	}

	private async getAccessToken(): Promise<string> {
		if (this.accessToken && Date.now() < this.tokenExpiresAt) {
			return this.accessToken;
		}

		const resp = await fetch(
			"https://open.larksuite.com/open-apis/auth/v3/tenant_access_token/internal",
			{
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({
					app_id: this.config.appId,
					app_secret: this.config.appSecret,
				}),
			},
		);
		const data = (await resp.json()) as {
			tenant_access_token: string;
			expire: number;
		};
		this.accessToken = data.tenant_access_token;
		this.tokenExpiresAt = Date.now() + data.expire * 1000 - 60_000;
		return this.accessToken;
	}
}
