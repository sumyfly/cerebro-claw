import { spawn } from "node:child_process";
import type { ToolDefinition, ToolResult } from "@cerebro-claw/shared";

export interface BashToolOptions {
	/** Commands the agent is allowed to invoke (matched against the first word). */
	allowlist: string[];
	/** Working directory for spawned commands. */
	cwd?: string;
	/** Max time a command may run (ms). Default 30s. */
	timeoutMs?: number;
	/** Max output bytes captured. Default 64KB. */
	maxOutputBytes?: number;
	/** Extra environment variables exposed to the command. */
	env?: Record<string, string>;
}

const DEFAULT_TIMEOUT_MS = 30_000;
const DEFAULT_MAX_OUTPUT = 64 * 1024;

/** Default safe allowlist — read-only inspection commands. */
export const DEFAULT_ALLOWLIST = [
	"curl",
	"cat",
	"head",
	"tail",
	"ls",
	"grep",
	"find",
	"jq",
	"date",
	"echo",
	"wc",
];

export function createBashTool(options: BashToolOptions): ToolDefinition {
	const allowlist = new Set(options.allowlist);
	const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
	const maxBytes = options.maxOutputBytes ?? DEFAULT_MAX_OUTPUT;
	const cwd = options.cwd ?? process.cwd();
	const env = { ...process.env, ...options.env };

	return {
		name: "bash",
		description: `Run a shell command. Only allowlisted commands are permitted: ${[...allowlist].join(", ")}. Output is truncated at ${maxBytes} bytes. Timeout: ${timeoutMs}ms. Use this to query external APIs (via curl), read local files, or run any data-fetching script the operator has installed.`,
		parameters: {
			type: "object",
			properties: {
				command: {
					type: "string",
					description: "The shell command to run. Must start with an allowlisted program.",
				},
			},
			required: ["command"],
		},
		async execute(params) {
			const command = (params.command as string).trim();
			if (!command) {
				return { content: "Empty command", success: false };
			}

			const program = command.split(/\s+/)[0];
			if (!allowlist.has(program)) {
				return {
					content: `Command "${program}" is not allowlisted. Allowed: ${[...allowlist].join(", ")}.`,
					success: false,
				};
			}

			return runCommand(command, { cwd, env, timeoutMs, maxBytes });
		},
	};
}

interface RunOptions {
	cwd: string;
	env: Record<string, string | undefined>;
	timeoutMs: number;
	maxBytes: number;
}

function runCommand(command: string, opts: RunOptions): Promise<ToolResult> {
	return new Promise((resolve) => {
		const child = spawn("sh", ["-c", command], {
			cwd: opts.cwd,
			env: opts.env,
		});

		let stdout = "";
		let stderr = "";
		let truncated = false;

		const append = (which: "out" | "err", chunk: Buffer) => {
			const text = chunk.toString("utf8");
			if (which === "out") {
				if (stdout.length + text.length > opts.maxBytes) {
					stdout += text.slice(0, opts.maxBytes - stdout.length);
					truncated = true;
				} else {
					stdout += text;
				}
			} else {
				if (stderr.length + text.length > opts.maxBytes) {
					stderr += text.slice(0, opts.maxBytes - stderr.length);
					truncated = true;
				} else {
					stderr += text;
				}
			}
		};

		child.stdout.on("data", (c) => append("out", c));
		child.stderr.on("data", (c) => append("err", c));

		const timer = setTimeout(() => {
			child.kill("SIGTERM");
			setTimeout(() => child.kill("SIGKILL"), 1000);
		}, opts.timeoutMs);

		child.on("error", (err) => {
			clearTimeout(timer);
			resolve({
				content: `Failed to spawn command: ${err.message}`,
				success: false,
			});
		});

		child.on("close", (code, signal) => {
			clearTimeout(timer);
			const parts: string[] = [];
			if (stdout) parts.push(`STDOUT:\n${stdout}`);
			if (stderr) parts.push(`STDERR:\n${stderr}`);
			if (truncated) parts.push("(output truncated)");
			if (signal === "SIGTERM" || signal === "SIGKILL") {
				parts.push(`(killed by timeout after ${opts.timeoutMs}ms)`);
			}
			if (parts.length === 0) {
				parts.push(`(no output, exit code ${code})`);
			}
			resolve({
				content: parts.join("\n\n"),
				success: code === 0,
				details: { exitCode: code, signal, truncated },
			});
		});
	});
}
