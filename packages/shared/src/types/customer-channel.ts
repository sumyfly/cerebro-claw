/**
 * CustomerChannel — the agent's outbound path to a customer.
 *
 * This is intentionally tiny (one method) compared to ChannelAdapter, which
 * also handles inbound messages, webhooks, and CSM-facing cards. The agent
 * only needs to reach the customer outbound; inbound customer messages flow
 * through CSP / support tickets, not through this interface.
 *
 * Implementations:
 * - StubCustomerChannel (built-in) — writes to the ActionLedger and CSP notes.
 *   Used in dev and when no real customer channel is configured. Lets the
 *   action policy run end-to-end without sending real messages.
 * - Future: EmailCustomerChannel, SmsCustomerChannel, WeChatCustomerChannel.
 */
export interface CustomerChannel {
	/** Short id, e.g. "stub", "email", "sms", "wechat". */
	id: string;

	/**
	 * Deliver a message to the customer.
	 * Throws if the send genuinely failed — the dispatcher will mark the ledger
	 * entry "failed" and the digest will surface it as an escalation candidate.
	 */
	send(input: {
		customerId: string;
		recipient: string;
		text: string;
		meta?: Record<string, unknown>;
	}): Promise<{ messageId: string; deliveredAt: Date }>;
}
