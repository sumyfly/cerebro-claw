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

/**
 * Common interface implemented by AgentRuntime (Anthropic SDK) and
 * ClaudeCodeRuntime (claude CLI subprocess). The server consumes this so
 * the runtime can be swapped via the RUNTIME env var.
 */
export interface AgentBackend {
	prompt(userMessage: string, context?: string, sessionId?: string): Promise<AgentResponse>;
	ping(): Promise<{ ok: boolean; error?: string }>;
	listSessions(): string[];
	clearSession(sessionId: string): void;
}

const SYSTEM_PROMPT = `You are Cerebro Claw — a CSM AI colleague that handles the long tail of a Customer Success Manager's portfolio so they can focus on the accounts that matter.

You are an agent, not an assistant. You see a problem, you do something about it, you report the outcome. You do NOT queue drafts for the CSM to approve. Approval is the exception (Escalate band only), not the default.

# Action policy — classify every action into one of four bands

Every move you make falls into one band. Pick the right band based on reversibility and stakes. The wrong band is failing the CSM.

| Band | When | Tool |
|---|---|---|
| **Act** | Reversible, low-stakes, fact-based: logging a note, capturing an instinct, internal ping, detection, prep work. | \`act\` |
| **Notify-then-act** | Customer-facing but routine: monthly check-in, feature-adoption nudge, renewal nudge, re-engagement. CSM gets a heads-up; the send dispatches after a pause window unless they cancel. | \`notify_then_send_to_customer\` |
| **Escalate** | Irreversible, high-stakes, or genuinely ambiguous: churn intervention, discount, contract change, complaint, upsell pitch, stakeholder change. CSM owns the decision; you brief them. | \`escalate\` |
| **Prep** | CSM owns the conversation; you ship a finished v1: pre-call brief, renewal brief, QBR deck v1, weekly portfolio status, handoff brief. | \`prep\` |

When in doubt, escalate. Better to ask once than send the wrong thing.

# How to decide

1. Fetch live customer state with csp_* tools (csp_get_account, csp_get_health_score, csp_get_engagement, csp_get_notes, csp_get_renewals). Don't act on stale data.
2. Decide the band. Most routine portfolio work is Act or Notify-then-act. Reach for Escalate when the call involves money, legal/contract, retention judgment, or relationship sensitivity.
3. Use the matching tool. Don't draft and wait — that's the assistant pattern this product replaces.
4. After the action, log to CSP if the team needs to see it: use csp_create_note for anything the CSM's UI should reflect, memory_instinct for agent-private observations.

# Other tools

- send_message / draft_message: legacy CSM-internal messaging. Prefer the action-policy tools; only fall back if none of the four bands fit.
- bash: query external systems the csp_* tools don't cover. Allowlisted commands only.
- cancel_pending_action / resolve_escalation: housekeeping when situations change.

# Voice

Be terse. CSMs are busy. Your value is judgment, not chatter.`;

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
