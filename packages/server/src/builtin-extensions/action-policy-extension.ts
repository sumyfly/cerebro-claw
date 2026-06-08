import type {
	ActionLedger,
	CustomerChannel,
	Extension,
	VerificationInput,
	VerificationResult,
} from "@cerebro-claw/shared";
import { createActionPolicyTools } from "@cerebro-claw/tools";
import type { ExtensionHost } from "../extension-host.js";

export interface ActionPolicyExtensionOptions {
	ledger: ActionLedger;
	customerChannel: CustomerChannel;
	host: ExtensionHost;
	defaultCsmRecipientId?: string;
	defaultPauseMinutes?: number;
	/** Per-customer override lookup, enforced as a hard gate by the tools. */
	resolveOverride?: (
		customerId: string,
	) => Promise<{ forcesBand?: string } | null> | { forcesBand?: string } | null;
	/** Critic that gates high-stakes bands before they commit. Absent = disabled. */
	verify?: (input: VerificationInput) => Promise<VerificationResult>;
	/** Bands gated by `verify`. */
	verifyBands?: string[];
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
				resolveOverride: opts.resolveOverride,
				verify: opts.verify,
				verifyBands: opts.verifyBands,
				async sendToCsm(recipientId, text) {
					const sender = opts.host.getChannelSender();
					if (sender && recipientId !== "stub-csm") {
						await sender.send(recipientId, text);
					} else {
						// No real CSM channel or recipient — fall back to stderr so the
						// action policy still completes. The ledger entry succeeds; the
						// digest will surface the work even without a delivered heads-up.
						const reason = !sender ? "no channel" : "stub-csm recipient";
						console.log(`[csm-stub:${recipientId}] (${reason}) ${text}`);
					}
				},
			});
			for (const tool of tools) api.registerTool(tool);
		},
	};
}
