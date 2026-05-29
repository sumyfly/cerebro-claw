import { describe, it, expect } from "vitest";
import { writeFileSync, mkdtempSync, chmodSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ClaudeCodeRuntime } from "../claude-code-runtime.js";

/**
 * Drives the runtime against a fake `claude` binary so we don't depend on
 * Claude Code being installed in the test environment.
 */
function makeFakeClaude(behavior: "ok" | "error" | "no-session"): string {
	const dir = mkdtempSync(join(tmpdir(), "fake-claude-"));
	const path = join(dir, "claude");
	const sessionId = "test-session-abc";

	let body = "";
	if (behavior === "ok") {
		body = `#!/usr/bin/env bash
if [ "$1" = "--version" ]; then echo "claude 0.0.1-fake"; exit 0; fi
printf '%s\\n' '{"type":"system","session_id":"${sessionId}"}'
printf '%s\\n' '{"type":"assistant","message":{"content":[{"type":"text","text":"Hello from fake claude."}]}}'
printf '%s\\n' '{"type":"result","result":"Hello from fake claude."}'
`;
	} else if (behavior === "error") {
		body = `#!/usr/bin/env bash
if [ "$1" = "--version" ]; then echo "claude 0.0.1-fake"; exit 0; fi
echo "fake error" >&2
exit 1
`;
	} else {
		// no-session: returns text but no session_id
		body = `#!/usr/bin/env bash
if [ "$1" = "--version" ]; then echo "claude 0.0.1-fake"; exit 0; fi
printf '%s\\n' '{"type":"result","result":"orphaned response"}'
`;
	}
	writeFileSync(path, body);
	chmodSync(path, 0o755);
	return path;
}

describe("ClaudeCodeRuntime", () => {
	it("ping succeeds when binary exists", async () => {
		const path = makeFakeClaude("ok");
		const runtime = new ClaudeCodeRuntime("sonnet", [], path);
		const result = await runtime.ping();
		expect(result.ok).toBe(true);
	});

	it("ping fails when binary missing", async () => {
		const runtime = new ClaudeCodeRuntime("sonnet", [], "/does/not/exist/claude");
		const result = await runtime.ping();
		expect(result.ok).toBe(false);
		expect(result.error).toContain("claude CLI");
	});

	it("prompt returns text from assistant message", async () => {
		const path = makeFakeClaude("ok");
		const runtime = new ClaudeCodeRuntime("sonnet", [], path);
		const result = await runtime.prompt("hi");
		expect(result.text).toBe("Hello from fake claude.");
		expect(result.toolCalls).toEqual([]);
	});

	it("persists Claude Code session ID for a given local session", async () => {
		const path = makeFakeClaude("ok");
		const runtime = new ClaudeCodeRuntime("sonnet", [], path);
		await runtime.prompt("hi", undefined, "my-chat");
		expect(runtime.listSessions()).toContain("my-chat");
	});

	it("clearSession removes a session", async () => {
		const path = makeFakeClaude("ok");
		const runtime = new ClaudeCodeRuntime("sonnet", [], path);
		await runtime.prompt("hi", undefined, "my-chat");
		runtime.clearSession("my-chat");
		expect(runtime.listSessions()).not.toContain("my-chat");
	});

	it("rejects when the binary exits non-zero with no output", async () => {
		const path = makeFakeClaude("error");
		const runtime = new ClaudeCodeRuntime("sonnet", [], path);
		await expect(runtime.prompt("hi")).rejects.toThrow(/claude exited 1/);
	});

	it("tolerates responses with no session_id", async () => {
		const path = makeFakeClaude("no-session");
		const runtime = new ClaudeCodeRuntime("sonnet", [], path);
		const result = await runtime.prompt("hi", undefined, "no-sess");
		expect(result.text).toBe("orphaned response");
		// session was never registered because we never got a session_id
		expect(runtime.listSessions()).not.toContain("no-sess");
	});

	// --- MCP wiring: ensure --mcp-config and --allowed-tools reach the subprocess ---

	/**
	 * Builds a fake claude that writes its argv to a known file before exiting
	 * successfully. The test can then inspect the captured args.
	 */
	function makeArgCapturingClaude(): { path: string; argsFile: string } {
		const dir = mkdtempSync(join(tmpdir(), "fake-claude-args-"));
		const argsFile = join(dir, "args.json");
		const path = join(dir, "claude");
		const body = `#!/usr/bin/env bash
if [ "$1" = "--version" ]; then echo "claude 0.0.1-fake"; exit 0; fi
# Capture argv as JSON
printf '['  > "${argsFile}"
first=1
for a in "$@"; do
  if [ $first -eq 1 ]; then first=0; else printf ',' >> "${argsFile}"; fi
  printf '%s' "$a" | python3 -c 'import json,sys; print(json.dumps(sys.stdin.read()),end="")' >> "${argsFile}"
done
printf ']' >> "${argsFile}"
printf '%s\\n' '{"type":"system","session_id":"sess-1"}'
printf '%s\\n' '{"type":"result","result":"ok"}'
`;
		writeFileSync(path, body);
		chmodSync(path, 0o755);
		return { path, argsFile };
	}

	function makeFakeTool(name: string): import("@cerebro-claw/shared").ToolDefinition {
		return {
			name,
			description: `tool ${name}`,
			parameters: { type: "object", properties: {} },
			async execute() {
				return { content: "ok", success: true };
			},
		};
	}

	it("when mcpUrl is given, passes --mcp-config pointing at a temp file with the URL", async () => {
		const { path, argsFile } = makeArgCapturingClaude();
		const tools = [makeFakeTool("csp_get_account"), makeFakeTool("memory_read")];
		const runtime = new ClaudeCodeRuntime(
			"sonnet",
			tools,
			path,
			"http://127.0.0.1:9999/mcp",
		);
		await runtime.prompt("hi");

		const argv = JSON.parse(readFileSync(argsFile, "utf8")) as string[];
		const idx = argv.indexOf("--mcp-config");
		expect(idx).toBeGreaterThan(-1);
		const configPath = argv[idx + 1];
		expect(configPath).toBeTruthy();
		// The config file itself should exist and contain our URL
		const config = JSON.parse(readFileSync(configPath, "utf8"));
		expect(config.mcpServers?.["cerebro-claw"]?.url).toBe("http://127.0.0.1:9999/mcp");
		expect(config.mcpServers?.["cerebro-claw"]?.type).toBe("http");
	});

	it("when mcpUrl is given, passes --allowed-tools listing every registered tool", async () => {
		const { path, argsFile } = makeArgCapturingClaude();
		const tools = [makeFakeTool("csp_get_account"), makeFakeTool("memory_read")];
		const runtime = new ClaudeCodeRuntime(
			"sonnet",
			tools,
			path,
			"http://127.0.0.1:9999/mcp",
		);
		await runtime.prompt("hi");

		const argv = JSON.parse(readFileSync(argsFile, "utf8")) as string[];
		const idx = argv.indexOf("--allowed-tools");
		expect(idx).toBeGreaterThan(-1);
		const list = argv[idx + 1].split(",");
		expect(list).toContain("mcp__cerebro-claw__csp_get_account");
		expect(list).toContain("mcp__cerebro-claw__memory_read");
	});

	it("without mcpUrl, does NOT pass --mcp-config or --allowed-tools (backward compat)", async () => {
		const { path, argsFile } = makeArgCapturingClaude();
		const runtime = new ClaudeCodeRuntime("sonnet", [], path);
		await runtime.prompt("hi");

		const argv = JSON.parse(readFileSync(argsFile, "utf8")) as string[];
		expect(argv).not.toContain("--mcp-config");
		expect(argv).not.toContain("--allowed-tools");
	});
});
