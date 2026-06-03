export interface InboundMessage {
	channelType: string;
	channelId: string;
	senderId: string;
	senderName: string;
	text: string;
	timestamp: Date;
	metadata?: Record<string, unknown>;
}
