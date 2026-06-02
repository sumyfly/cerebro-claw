import type { Extension, PendingAction } from "@cerebro-claw/shared";
import { createMessageTools } from "@cerebro-claw/tools";
import type { ExtensionHost } from "../extension-host.js";

export interface MessageToolsExtensionOptions {
	pendingActions: Map<string, PendingAction>;
	host: ExtensionHost;
}

export function createMessageToolsExtension(opts: MessageToolsExtensionOptions): Extension {
	return {
		id: "message-tools",
		factory: (api) => {
			const tools = createMessageTools({
				pendingActions: opts.pendingActions,
				async sendToChannel(channelKey, recipientId, text) {
					const sender = opts.host.getChannelSender(
						channelKey === "default" ? undefined : channelKey,
					);
					if (sender) await sender.send(recipientId, text);
				},
				async onActionCreated(action) {
					// Broadcast to extensions — channels listen and render their own card.
					await opts.host.emit("pending_action_created", action);
				},
			});
			for (const tool of tools) api.registerTool(tool);

			// Bridge approval/rejection back to extensions so channels can update cards.
			api.on("shutdown", () => {
				/* placeholder for cleanup */
			});
		},
	};
}
