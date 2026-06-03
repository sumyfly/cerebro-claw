import { spawn } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ToolDefinition } from "@cerebro-claw/shared";
import type { AgentBackend, AgentResponse } from "./agent-backend.js";
import { SYSTEM_PROMPT } from "./system-prompt.js";

export interface BuildArgsInput {
	userMessage: string;
	model: string;
	context?: string;
	resumeSessionId?: string;
	mcpConfigPath?: string | null;
	allowedToolPatterns?: string[];
}

/**
 * Builds the `claude` CLI argv for a single turn. Pure function so the arg
 * construction is unit-testable without spawning the subprocess. Always injects
 * the Cerebro SYSTEM_PROMPT via --append-system-prompt (with any per-account
 * context appended after it).
 */
export function buildClaudeArgs(input: BuildArgsInput): string[] {
	const args: string[] = ["-p", input.userMessage, "--output-format", "stream-json", "--verbose"];
	if (input.model && !input.model.startsWith("claude-sonnet-4-")) {
		// Pass through explicit model selection. Skip the SDK default
		// because Claude Code picks its own default.
		args.push("--model", input.model);
	}
	const systemPrompt = input.context ? `${SYSTEM_PROMPT}\n\n${input.context}` : SYSTEM_PROMPT;
	args.push("--append-system-prompt", systemPrompt);
	if (input.resumeSessionId) args.push("--resume", input.resumeSessionId);
	if (input.mcpConfigPath) {
		args.push("--mcp-config", input.mcpConfigPath);
		if (input.allowedToolPatterns && input.allowedToolPatterns.length > 0) {
			args.push("--allowed-tools", input.allowedToolPatterns.join(","));
		}
	}
	return args;
}

/**
 * The agent runtime: drives the `claude` CLI (Claude Code) as a subprocess.
 * Uses the user's Claude Code login — no ANTHROPIC_API_KEY needed.
 *
 *  + No API key. Uses your Max/Pro subscription.
 *  + Inherits Claude Code's built-in file/bash tools.
 *  - Custom tools are exposed over the MCP endpoint (`--mcp-config`); the
 *    Cerebro system prompt is injected via `--append-system-prompt`.
 *  - Higher per-turn latency (subprocess startup).
 *  - Requires `claude` on PATH.
 */
export class ClaudeCodeRuntime implements AgentBackend {
	private sessions = new Map<string, string>(); // our sessionId → Claude Code session_id
	private model: string;
	private claudeBinary: string;
	private tools: ToolDefinition[];
	private mcpConfigPath: string | null;
	private allowedToolPatterns: string[];

	constructor(model: string, tools: ToolDefinition[], claudeBinary = "claude", mcpUrl?: string) {
		this.model = model;
		this.tools = tools;
		this.claudeBinary = claudeBinary;

		// If an MCP URL is provided, write an MCP config file the subprocess can
		// load via --mcp-config. The spawned `claude` will discover our tools
		// from this endpoint and call them natively over MCP — no Anthropic key
		// needed (the user's Claude Code login handles inference).
		if (mcpUrl) {
			const dir = mkdtempSync(join(tmpdir(), "cerebro-claw-mcp-"));
			this.mcpConfigPath = join(dir, "mcp-config.json");
			writeFileSync(
				this.mcpConfigPath,
				JSON.stringify({
					mcpServers: {
						"cerebro-claw": { type: "http", url: mcpUrl },
					},
				}),
			);
			// Allow Claude Code to call any tool that came from our MCP server
			// without prompting for approval on each call.
			this.allowedToolPatterns = tools.map((t) => `mcp__cerebro-claw__${t.name}`);
			console.log(
				`[claude-code-runtime] MCP config: ${this.mcpConfigPath} (${tools.length} tools exposed)`,
			);
		} else {
			this.mcpConfigPath = null;
			this.allowedToolPatterns = [];
		}
	}

	getOrCreateSession(sessionId: string): string[] {
		const claudeId = this.sessions.get(sessionId);
		return claudeId ? [claudeId] : [];
	}

	clearSession(sessionId: string): void {
		this.sessions.delete(sessionId);
	}

	listSessions(): string[] {
		return Array.from(this.sessions.keys());
	}

	async ping(): Promise<{ ok: boolean; error?: string }> {
		return new Promise((resolve) => {
			const child = spawn(this.claudeBinary, ["--version"]);
			let output = "";
			child.stdout.on("data", (c) => {
				output += c.toString();
			});
			child.on("exit", (code) => {
				if (code === 0) resolve({ ok: true });
				else resolve({ ok: false, error: `claude CLI exited ${code}` });
			});
			child.on("error", (err) => {
				resolve({
					ok: false,
					error: `claude CLI not found on PATH (${err.message}). Install Claude Code and run \`claude\` once to log in.`,
				});
			});
		});
	}

	async prompt(userMessage: string, context?: string, sessionId?: string): Promise<AgentResponse> {
		const claudeSessionId = sessionId ? this.sessions.get(sessionId) : undefined;

		const args = buildClaudeArgs({
			userMessage,
			model: this.model,
			context,
			resumeSessionId: claudeSessionId,
			mcpConfigPath: this.mcpConfigPath,
			allowedToolPatterns: this.allowedToolPatterns,
		});

		return new Promise<AgentResponse>((resolve, reject) => {
			const child = spawn(this.claudeBinary, args);
			let buffer = "";
			let responseText = "";
			let newSessionId: string | undefined;

			child.stdout.on("data", (chunk) => {
				buffer += chunk.toString();
				const lines = buffer.split("\n");
				buffer = lines.pop() ?? "";
				for (const line of lines) {
					if (!line.trim()) continue;
					try {
						const event = JSON.parse(line);
						if (event.type === "system" && event.session_id) {
							newSessionId = event.session_id;
						} else if (event.type === "assistant" && event.message?.content) {
							for (const block of event.message.content) {
								if (block.type === "text" && typeof block.text === "string") {
									responseText += block.text;
								}
							}
						} else if (event.type === "result" && event.result) {
							// `result` carries the final text on completion
							if (!responseText) responseText = event.result;
						}
					} catch {
						// Skip non-JSON lines (warnings, etc.)
					}
				}
			});

			let stderrBuf = "";
			child.stderr.on("data", (c) => {
				stderrBuf += c.toString();
			});

			child.on("error", (err) => {
				reject(new Error(`Failed to spawn claude: ${err.message}`));
			});

			child.on("close", (code) => {
				if (code !== 0 && !responseText) {
					reject(new Error(`claude exited ${code}: ${stderrBuf.trim() || "no output"}`));
					return;
				}
				if (sessionId && newSessionId) {
					this.sessions.set(sessionId, newSessionId);
				}
				resolve({ text: responseText.trim(), toolCalls: [] });
			});
		});
	}
}
