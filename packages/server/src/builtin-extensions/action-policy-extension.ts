import type { ActionLedger, CustomerChannel, Extension } from "@cerebro-claw/shared";
import { createActionPolicyTools } from "@cerebro-claw/tools";
import type { ExtensionHost } from "../extension-host.js";

export interface ActionPolicyExtensionOptions {
	ledger: ActionLedger;
	customerChannel: CustomerChannel;
	host: ExtensionHost;
	defaultCsmRecipientId?: string;
	defaultPauseMinutes?: number;
}

/**
 * Registers the action-policy tools (act, notify_then_send_to_customer,
 * escalate, prep, cancel_pending_action, resolve_escalation).
 *
 * sendToCsm routes through the host's channel sender (Lark by default).
 * In headless / no-channel mode (no LARK creds), we log to stderr so the
 * agent's chain of reasoning is still visible.
 */
export function createActionPolicyExtension(opts: ActionPolicyExtensionOptions): Extension {
	return {
		id: "action-policy",
		factory: (api) => {
			const tools = createActionPolicyTools({
				ledger: opts.ledger,
				customerChannel: opts.customerChannel,
				defaultCsmRecipientId: opts.defaultCsmRecipientId,
				defaultPauseMinutes: opts.defaultPauseMinutes,
				async sendToCsm(recipientId, text) {
					const sender = opts.host.getChannelSender();
					if (sender) {
						await sender.send(recipientId, text);
					} else {
						// No channel configured — at least make the action visible.
						console.log(`[csm:${recipientId}] ${text}`);
					}
				},
			});
			for (const tool of tools) api.registerTool(tool);
		},
	};
}
