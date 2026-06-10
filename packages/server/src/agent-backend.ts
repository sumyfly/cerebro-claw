import type { ToolResult } from "@cerebro-claw/shared";

export interface AgentResponse {
	text: string;
	toolCalls: AgentToolCall[];
}

export interface AgentToolCall {
	toolName: string;
	params: Record<string, unknown>;
	result: ToolResult;
}

/**
 * Interface implemented by the agent runtime. Today the only implementation is
 * ClaudeCodeRuntime (the `claude` CLI subprocess, reached over MCP). The server
 * consumes this interface so the runtime stays swappable.
 */
export interface AgentBackend {
	prompt(userMessage: string, context?: string, sessionId?: string): Promise<AgentResponse>;
	ping(): Promise<{ ok: boolean; error?: string }>;
	listSessions(): string[];
	clearSession(sessionId: string): void;
}
