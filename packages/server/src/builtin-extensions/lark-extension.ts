import type { Extension, PendingAction } from "@cerebro-claw/shared";
import { LarkBot, buildApprovalCard } from "@cerebro-claw/channel-lark";

export interface LarkExtensionOptions {
	appId: string;
	appSecret: string;
	pendingActions: Map<string, PendingAction>;
	onMessage: (text: string, senderId: string, channelId: string) => Promise<string | null>;
}

/**
 * Built-in Lark channel extension.
 * Registers the Lark channel adapter and wires card-action callbacks
 * to the pending-action approval flow.
 *
 * Exposes the LarkBot instance via getInstance() for the server's webhook route.
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

	bot.onCardAction(async (_tag, value) => {
		const actionId = value.id;
		const action = opts.pendingActions.get(actionId);
		if (!action) return;

		if (value.action === "approve") {
			action.status = "approved";
			if (action.draft) {
				await bot.send(action.draft.recipientId, action.draft.text);
			}
		} else if (value.action === "reject") {
			action.status = "rejected";
		}
	});

	const extension: Extension = {
		id: "channel-lark",
		factory: (api) => {
			api.registerChannel(bot);
		},
	};

	return { extension, bot };
}

export { buildApprovalCard };
