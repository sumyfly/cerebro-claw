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
- When you notice something concerning (usage drop, missed follow-up, approaching renewal), alert the CSM with context and a recommendation.
- Be concise. CSMs are busy.`;

export class AgentRuntime {
	private client: Anthropic;
	private model: string;
	private tools: ToolDefinition[];

	constructor(apiKey: string, model: string, tools: ToolDefinition[]) {
		this.client = new Anthropic({ apiKey });
		this.model = model;
		this.tools = tools;
	}

	async prompt(userMessage: string, context?: string): Promise<AgentResponse> {
		const systemPrompt = context ? `${SYSTEM_PROMPT}\n\n${context}` : SYSTEM_PROMPT;

		const anthropicTools: Anthropic.Tool[] = this.tools.map((t) => ({
			name: t.name,
			description: t.description,
			input_schema: t.parameters as Anthropic.Tool.InputSchema,
		}));

		const messages: Anthropic.MessageParam[] = [{ role: "user", content: userMessage }];

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

		return { text: responseText, toolCalls };
	}
}
