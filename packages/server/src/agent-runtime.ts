import Anthropic from "@anthropic-ai/sdk";
import type { ToolDefinition, ToolResult } from "@cerebro-claw/shared";

export interface AgentResponse {
	text: string;
	toolCalls: AgentToolCall[];
}

export interface AgentToolCall {
	toolName: string;
	params: Record<string, unknown>;
	result: ToolResult;
}

const SYSTEM_PROMPT = `You are a CSM AI colleague — an always-on agent that helps Customer Success Managers manage their accounts.

You are an agent, not an assistant. You have your own judgment about what needs doing. You proactively watch for risks, prepare briefs, draft messages, and keep customer records up to date.

When the CSM talks to you directly, switch to assistant mode — respond to their question with full context.

Rules:
- Never contact a customer directly without CSM approval. Use draft_message for customer-facing messages.
- Use send_message to alert the CSM about things that need attention.
- Use memory tools to read and update customer information.
- Use the bash tool to query external data when you need information that isn't in memory — e.g. \`curl\` an internal API for live usage data, run a script, fetch a status page. Only allowlisted commands work; if you need a different command, tell the CSM rather than guessing data.
- When you notice something concerning (usage drop, missed follow-up, approaching renewal), alert the CSM with context and a recommendation.
- When the CSM tells you to remember something about a customer (e.g. "remember, Acme is price-sensitive"), use memory_instinct to store it. You don't need to be told explicitly — if the CSM shares informal knowledge about a customer, capture it.
- Be concise. CSMs are busy.`;

export class AgentRuntime {
	private client: Anthropic;
	private model: string;
	private tools: ToolDefinition[];
	private sessions = new Map<string, Anthropic.MessageParam[]>();

	constructor(apiKey: string, model: string, tools: ToolDefinition[]) {
		this.client = new Anthropic({ apiKey });
		this.model = model;
		this.tools = tools;
	}

	getOrCreateSession(sessionId: string): Anthropic.MessageParam[] {
		if (!this.sessions.has(sessionId)) {
			this.sessions.set(sessionId, []);
		}
		return this.sessions.get(sessionId)!;
	}

	clearSession(sessionId: string): void {
		this.sessions.delete(sessionId);
	}

	listSessions(): string[] {
		return Array.from(this.sessions.keys());
	}

	async ping(): Promise<{ ok: boolean; error?: string }> {
		try {
			await this.client.messages.create({
				model: this.model,
				max_tokens: 10,
				messages: [{ role: "user", content: "ping" }],
			});
			return { ok: true };
		} catch (err) {
			return { ok: false, error: friendlyAnthropicError(err) };
		}
	}

	async prompt(userMessage: string, context?: string, sessionId?: string): Promise<AgentResponse> {
		const systemPrompt = context ? `${SYSTEM_PROMPT}\n\n${context}` : SYSTEM_PROMPT;

		const anthropicTools: Anthropic.Tool[] = this.tools.map((t) => ({
			name: t.name,
			description: t.description,
			input_schema: t.parameters as Anthropic.Tool.InputSchema,
		}));

		const history = sessionId ? this.getOrCreateSession(sessionId) : [];
		const messages: Anthropic.MessageParam[] = [
			...history,
			{ role: "user", content: userMessage },
		];

		const toolCalls: AgentToolCall[] = [];
		let responseText = "";

		let continueLoop = true;
		while (continueLoop) {
			const response = await this.client.messages.create({
				model: this.model,
				max_tokens: 4096,
				system: systemPrompt,
				tools: anthropicTools,
				messages,
			});

			const textBlocks = response.content.filter((b) => b.type === "text");
			const toolBlocks = response.content.filter((b) => b.type === "tool_use");

			for (const block of textBlocks) {
				responseText += block.text;
			}

			if (toolBlocks.length === 0) {
				continueLoop = false;
				break;
			}

			messages.push({ role: "assistant", content: response.content });

			const toolResults: Anthropic.ToolResultBlockParam[] = [];
			for (const block of toolBlocks) {
				const tool = this.tools.find((t) => t.name === block.name);
				if (!tool) {
					toolResults.push({
						type: "tool_result",
						tool_use_id: block.id,
						content: `Unknown tool: ${block.name}`,
						is_error: true,
					});
					continue;
				}

				const result = await tool.execute(block.input as Record<string, unknown>);
				toolCalls.push({
					toolName: block.name,
					params: block.input as Record<string, unknown>,
					result,
				});
				toolResults.push({
					type: "tool_result",
					tool_use_id: block.id,
					content: result.content,
					is_error: !result.success,
				});
			}

			messages.push({ role: "user", content: toolResults });

			if (response.stop_reason === "end_turn") {
				continueLoop = false;
			}
		}

		// Save conversation history for this session
		if (sessionId) {
			// Add the user message and final assistant response
			history.push({ role: "user", content: userMessage });
			history.push({ role: "assistant", content: responseText });

			// Trim history to last 40 messages to keep context manageable
			if (history.length > 40) {
				history.splice(0, history.length - 40);
			}
		}

		return { text: responseText, toolCalls };
	}
}

export function friendlyAnthropicError(err: unknown): string {
	const e = err as { status?: number; error?: { error?: { message?: string } }; message?: string };
	if (e?.status === 401) return "Invalid ANTHROPIC_API_KEY";
	if (e?.status === 429) return "Anthropic rate limit hit — try again in a moment";
	if (e?.status === 529) return "Anthropic is overloaded — retry shortly";
	if (e?.error?.error?.message) return `Anthropic: ${e.error.error.message}`;
	if (e?.message) return e.message;
	return "Unknown error contacting Anthropic";
}
