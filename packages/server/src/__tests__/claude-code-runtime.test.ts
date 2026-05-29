import { describe, it, expect } from "vitest";
import { writeFileSync, mkdtempSync, chmodSync } from "node:fs";
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
});
