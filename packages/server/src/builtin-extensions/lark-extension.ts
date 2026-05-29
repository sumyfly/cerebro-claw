import type { Extension, MemoryStore, PendingAction } from "@cerebro-claw/shared";
import { LarkBot, buildApprovalCard } from "@cerebro-claw/channel-lark";

export interface LarkExtensionOptions {
	appId: string;
	appSecret: string;
	pendingActions: Map<string, PendingAction>;
	onMessage: (text: string, senderId: string, channelId: string) => Promise<string | null>;
	/** Read access to the memory store so we can look up CSM Lark IDs per customer. */
	store: MemoryStore;
	/** Fallback CSM Lark user ID used when a customer has no csmLarkUserId set. */
	defaultCsmLarkUserId?: string;
}

/**
 * Built-in Lark channel extension.
 *
 * Three concerns:
 *  1. Receives inbound messages and dispatches them through the router.
 *  2. Listens for card-button actions and resolves pending actions.
 *  3. Subscribes to pending_action_created events from message-tools and
 *     sends an interactive approval card to the customer's CSM.
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

			// When a draft is created anywhere, push a card to the owning CSM.
			api.on("pending_action_created", async (payload) => {
				const action = payload as PendingAction;
				if (!action.draft) return;

				// Resolve the CSM's Lark user ID: customer-specific first, then env fallback.
				let larkUserId = opts.defaultCsmLarkUserId;
				try {
					const profile = await opts.store.getProfile(action.customerId);
					if (profile?.csmLarkUserId) larkUserId = profile.csmLarkUserId;

					const customerName = profile?.companyName ?? action.customerId;
					if (!larkUserId) {
						console.warn(
							`[lark] No CSM Lark ID configured for ${customerName} — draft stays in admin queue only.`,
						);
						return;
					}

					const card = buildApprovalCard(
						action.id,
						customerName,
						action.description,
						action.draft.text,
					);
					await bot.sendCard(larkUserId, card);
				} catch (err) {
					console.error("[lark] Failed to send approval card:", err);
				}
			});
		},
	};

	return { extension, bot };
}

export { buildApprovalCard };
