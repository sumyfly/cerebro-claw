import { LarkBot } from "@cerebro-claw/channel-lark";
import type { Extension, MemoryStore } from "@cerebro-claw/shared";

export interface LarkExtensionOptions {
	appId: string;
	appSecret: string;
	onMessage: (text: string, senderId: string, channelId: string) => Promise<string | null>;
	/** Read access to the memory store so we can look up CSM Lark IDs per customer. */
	store: MemoryStore;
	/** Fallback CSM Lark user ID used when a customer has no csmLarkUserId set. */
	defaultCsmLarkUserId?: string;
}

/**
 * Built-in Lark channel extension.
 *
 * Receives inbound messages and dispatches them through the router. Plain-text
 * sends to the CSM (alerts, briefs, notify-then-act heads-ups) go through the
 * registered channel's `send`.
 */
export function createLarkExtension(opts: LarkExtensionOptions): {
	extension: Extension;
	bot: LarkBot;
} {
	const bot = new LarkBot({ appId: opts.appId, appSecret: opts.appSecret });

	bot.onMessage(async (message) => {
		const reply = await opts.onMessage(message.text, message.senderId, message.channelId);
		if (reply) await bot.send(message.channelId, reply);
	});

	const extension: Extension = {
		id: "channel-lark",
		factory: (api) => {
			api.registerChannel(bot);
		},
	};

	return { extension, bot };
}
