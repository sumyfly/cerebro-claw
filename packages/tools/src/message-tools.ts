import type { ToolDefinition, PendingAction } from "@cerebro-claw/shared";
import { randomUUID } from "node:crypto";

export interface MessageToolsContext {
	pendingActions: Map<string, PendingAction>;
	sendToChannel: (channelId: string, recipientId: string, text: string) => Promise<void>;
}

export function createMessageTools(ctx: MessageToolsContext): ToolDefinition[] {
	const draftMessage: ToolDefinition = {
		name: "draft_message",
		description:
			"Draft a message for the CSM to review before sending. The message will be held as a pending action until approved.",
		parameters: {
			type: "object",
			properties: {
				customer_id: { type: "string", description: "The customer this message is about" },
				recipient_id: {
					type: "string",
					description: "Who to send the message to (CSM ID or customer contact ID)",
				},
				channel_id: { type: "string", description: "Channel to send through" },
				text: { type: "string", description: "The message text" },
				description: {
					type: "string",
					description: "Why this message should be sent (shown to CSM for approval)",
				},
			},
			required: ["customer_id", "recipient_id", "text", "description"],
		},
		async execute(params) {
			const action: PendingAction = {
				id: randomUUID(),
				customerId: params.customer_id as string,
				type: "send_message",
				description: params.description as string,
				draft: {
					channelType: "lark",
					channelId: (params.channel_id as string) ?? "default",
					recipientId: params.recipient_id as string,
					text: params.text as string,
					requiresApproval: true,
				},
				status: "pending",
				createdAt: new Date(),
			};
			ctx.pendingActions.set(action.id, action);
			return {
				content: `Draft created (ID: ${action.id}). Waiting for CSM approval.`,
				success: true,
				details: { actionId: action.id },
			};
		},
	};

	const sendMessage: ToolDefinition = {
		name: "send_message",
		description:
			"Send a message directly to the CSM (not to the customer). Use this for alerts, briefs, and recommendations. Does not require approval.",
		parameters: {
			type: "object",
			properties: {
				channel_id: { type: "string", description: "Channel to send through" },
				recipient_id: { type: "string", description: "CSM user ID" },
				text: { type: "string", description: "The message text" },
			},
			required: ["recipient_id", "text"],
		},
		async execute(params) {
			await ctx.sendToChannel(
				(params.channel_id as string) ?? "default",
				params.recipient_id as string,
				params.text as string,
			);
			return { content: "Message sent to CSM.", success: true };
		},
	};

	return [draftMessage, sendMessage];
}
