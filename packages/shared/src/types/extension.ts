import type { MemoryStore } from "./memory.js";
import type { InboundMessage } from "./message.js";
import type { ToolDefinition } from "./tool.js";

export interface ChannelAdapter {
	/** Channel identifier — e.g. "lark", "email", "slack". */
	type: string;

	/** Start the channel — register inbound message handler. */
	start(handler: ChannelMessageHandler): Promise<void>;

	/** Send a plain text message to a recipient. */
	send(recipientId: string, text: string): Promise<void>;

	/** Optional: send a rich card (channel-specific payload). */
	sendCard?(recipientId: string, card: unknown): Promise<void>;

	/** Optional: handle inbound webhook payload from the channel platform. */
	handleWebhook?(body: Record<string, unknown>): Promise<Record<string, unknown> | null>;

	/** Optional: stop the channel cleanly on shutdown. */
	stop?(): Promise<void>;
}

export type ChannelMessageHandler = (message: InboundMessage) => Promise<string | null>;

/** Lifecycle events extensions can hook into. */
export type ExtensionEvent =
	| "before_agent_prompt"
	| "after_agent_prompt"
	| "before_tool_call"
	| "after_tool_call"
	| "channel_message_received"
	| "channel_message_sent"
	| "brain_loop_cycle_start"
	| "brain_loop_cycle_end"
	| "pending_action_created"
	| "pending_action_resolved"
	| "shutdown";

export type EventHandler<T = unknown> = (payload: T) => void | Promise<void>;

/** API given to each extension at load time. */
export interface ExtensionAPI {
	/** Register a tool the agent can call. */
	registerTool(tool: ToolDefinition): void;

	/** Register a channel adapter. */
	registerChannel(channel: ChannelAdapter): void;

	/** Subscribe to a lifecycle event. */
	on(event: ExtensionEvent, handler: EventHandler): void;

	/** Read-only access to the customer memory store. */
	getStore(): MemoryStore;

	/** Read-only access to environment / config. */
	getConfig(): Record<string, string>;

	/** Extension's own ID — useful for logging. */
	extensionId: string;
}

/** An extension is a factory function called once at startup. */
export type ExtensionFactory = (api: ExtensionAPI) => void | Promise<void>;

export interface Extension {
	id: string;
	factory: ExtensionFactory;
}
