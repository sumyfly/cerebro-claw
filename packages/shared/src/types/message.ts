export interface InboundMessage {
	channelType: string;
	channelId: string;
	senderId: string;
	senderName: string;
	text: string;
	timestamp: Date;
	metadata?: Record<string, unknown>;
}

export interface OutboundMessage {
	channelType: string;
	channelId: string;
	recipientId: string;
	text: string;
	requiresApproval: boolean;
	metadata?: Record<string, unknown>;
}

export interface PendingAction {
	id: string;
	customerId: string;
	type: "send_message" | "update_crm" | "create_ticket" | "other";
	description: string;
	draft?: OutboundMessage;
	status: "pending" | "approved" | "rejected";
	createdAt: Date;
}
