import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ToolDefinition, TurnContext } from "@cerebro-claw/shared";
import type {
	AgentBackend,
	AgentResponse,
	PromptOptions,
	PromptSubject,
} from "./agent-backend.js";
import type { TurnRegistry } from "./harness/turn-registry.js";
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

export interface ClaudeCodeRuntimeOptions {
	model: string;
	tools: ToolDefinition[];
	/** Path to the `claude` CLI; default "claude". */
	claudeBinary?: string;
	/** Base URL of the local MCP server (e.g. "http://127.0.0.1:7700"). No trailing /mcp. */
	mcpBaseUrl?: string;
	/**
	 * The TurnRegistry the harness MCP pipeline reads from. When provided, each
	 * prompt() registers a TurnContext and points the subprocess at
	 * `${mcpBaseUrl}/mcp/turn/<turnId>` so every tool call is scoped. Without it
	 * the runtime falls back to the legacy `/mcp` endpoint (no scope = no
	 * capability gating, no auto-stamped ledger fields).
	 */
	turnRegistry?: TurnRegistry;
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
 *
 * Turn scope. When a TurnRegistry is wired, prompt() generates a fresh
 * turnId per call, registers a TurnContext (carrying the subject and the
 * situation, if any), writes a per-turn MCP config pointing the subprocess at
 * `/mcp/turn/<turnId>`, and releases the registration after the subprocess
 * exits. All temp files are cleaned in the same finally so a crashed turn
 * does not leak them.
 */
export class ClaudeCodeRuntime implements AgentBackend {
	private sessions = new Map<string, string>(); // our sessionId → Claude Code session_id
	private model: string;
	private claudeBinary: string;
	private tools: ToolDefinition[];
	private mcpBaseUrl: string | null;
	private allowedToolPatterns: string[];
	private turnRegistry?: TurnRegistry;
	/** Fallback config path used when no turn registry is wired. */
	private legacyMcpConfigPath: string | null;

	constructor(options: ClaudeCodeRuntimeOptions);
	/** @deprecated Use the options-object constructor; positional args kept for one release. */
	constructor(model: string, tools: ToolDefinition[], claudeBinary?: string, mcpUrl?: string);
	constructor(
		modelOrOptions: string | ClaudeCodeRuntimeOptions,
		tools?: ToolDefinition[],
		claudeBinary: string = "claude",
		mcpUrl?: string,
	) {
		const opts: ClaudeCodeRuntimeOptions =
			typeof modelOrOptions === "string"
				? {
						model: modelOrOptions,
						tools: tools ?? [],
						claudeBinary,
						// Legacy callers passed the FULL /mcp URL; convert it to a base by
						// stripping a trailing /mcp segment so the new per-turn config can
						// append /mcp/turn/<id>.
						mcpBaseUrl: mcpUrl?.replace(/\/mcp\/?$/, ""),
					}
				: modelOrOptions;

		this.model = opts.model;
		this.tools = opts.tools;
		this.claudeBinary = opts.claudeBinary ?? "claude";
		this.mcpBaseUrl = opts.mcpBaseUrl ?? null;
		this.turnRegistry = opts.turnRegistry;

		if (this.mcpBaseUrl) {
			// Allow Claude Code to call any tool that came from our MCP server
			// without prompting for approval on each call.
			this.allowedToolPatterns = this.tools.map((t) => `mcp__cerebro-claw__${t.name}`);
			// Build a single legacy config to reuse for callers that don't pass a
			// subject (chat, ad-hoc). Per-turn callers get a fresh config file.
			this.legacyMcpConfigPath = writeMcpConfig(this.legacyMcpUrl());
			console.log(
				`[claude-code-runtime] MCP base: ${this.mcpBaseUrl} (${this.tools.length} tools, ${this.turnRegistry ? "turn-scoped" : "legacy /mcp"})`,
			);
		} else {
			this.legacyMcpConfigPath = null;
			this.allowedToolPatterns = [];
		}
	}

	private legacyMcpUrl(): string {
		return `${this.mcpBaseUrl}/mcp`;
	}

	private turnMcpUrl(turnId: string): string {
		return `${this.mcpBaseUrl}/mcp/turn/${turnId}`;
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

	async prompt(
		userMessage: string,
		context?: string,
		sessionId?: string,
		promptOptions?: PromptOptions,
	): Promise<AgentResponse> {
		const claudeSessionId = sessionId ? this.sessions.get(sessionId) : undefined;

		// Decide which MCP config to use. Turn-scoped path requires both a
		// registry and a base URL — degrade gracefully to legacy if either is
		// missing so chat surfaces keep working.
		const useTurn = !!(this.turnRegistry && this.mcpBaseUrl);
		const turnId = useTurn ? randomUUID() : undefined;
		const turnConfigPath = useTurn ? writeMcpConfig(this.turnMcpUrl(turnId as string)) : null;
		if (useTurn && turnId && this.turnRegistry) {
			const subject: PromptSubject = promptOptions?.subject ?? { kind: "ad-hoc" };
			const ctx: TurnContext = {
				id: turnId,
				subject,
				situationId: promptOptions?.situationId,
				startedAt: new Date(),
			};
			this.turnRegistry.register(ctx);
		}

		const mcpConfigPath = turnConfigPath ?? this.legacyMcpConfigPath;

		const args = buildClaudeArgs({
			userMessage,
			model: this.model,
			context,
			resumeSessionId: claudeSessionId,
			mcpConfigPath,
			allowedToolPatterns: this.allowedToolPatterns,
		});

		const cleanup = () => {
			if (turnId && this.turnRegistry) this.turnRegistry.release(turnId);
			if (turnConfigPath) {
				try {
					rmSync(turnConfigPath, { force: true });
				} catch {
					// Tmpfile already gone — ignore.
				}
			}
		};

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
				cleanup();
				reject(new Error(`Failed to spawn claude: ${err.message}`));
			});

			child.on("close", (code) => {
				cleanup();
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

/**
 * Write a `claude` MCP config file pointing at one specific endpoint. The file
 * lives under a fresh `mkdtempSync` directory so per-turn configs do not
 * collide. Returns the absolute path of the written file.
 */
function writeMcpConfig(mcpUrl: string): string {
	const dir = mkdtempSync(join(tmpdir(), "cerebro-claw-mcp-"));
	const path = join(dir, "mcp-config.json");
	writeFileSync(
		path,
		JSON.stringify({
			mcpServers: {
				"cerebro-claw": { type: "http", url: mcpUrl },
			},
		}),
	);
	return path;
}
