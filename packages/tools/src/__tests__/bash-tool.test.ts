import { describe, expect, it } from "vitest";
import { DEFAULT_ALLOWLIST, createBashTool } from "../bash-tool.js";

describe("bash tool", () => {
	it("executes an allowlisted command", async () => {
		const tool = createBashTool({ allowlist: ["echo"] });
		const result = await tool.execute({ command: "echo hello world" });
		expect(result.success).toBe(true);
		expect(result.content).toContain("hello world");
	});

	it("blocks non-allowlisted commands", async () => {
		const tool = createBashTool({ allowlist: ["echo"] });
		const result = await tool.execute({ command: "rm -rf /" });
		expect(result.success).toBe(false);
		expect(result.content).toContain("not allowlisted");
	});

	it("rejects empty command", async () => {
		const tool = createBashTool({ allowlist: ["echo"] });
		const result = await tool.execute({ command: "   " });
		expect(result.success).toBe(false);
		expect(result.content).toContain("Empty");
	});

	it("captures stderr", async () => {
		const tool = createBashTool({ allowlist: ["sh"] });
		// Use sh -c through the allowlist for this test
		const result = await tool.execute({ command: "sh -c 'echo oops >&2; exit 1'" });
		expect(result.success).toBe(false);
		expect(result.content).toContain("oops");
		expect(result.details?.exitCode).toBe(1);
	});

	it("includes exit code in details", async () => {
		const tool = createBashTool({ allowlist: ["false"] });
		const result = await tool.execute({ command: "false" });
		expect(result.details?.exitCode).toBe(1);
		expect(result.success).toBe(false);
	});

	it("kills commands that exceed timeout", async () => {
		const tool = createBashTool({ allowlist: ["sleep"], timeoutMs: 200 });
		const result = await tool.execute({ command: "sleep 5" });
		expect(result.success).toBe(false);
		expect(result.content).toContain("timeout");
	}, 5000);

	it("truncates output exceeding maxOutputBytes", async () => {
		const tool = createBashTool({ allowlist: ["sh"], maxOutputBytes: 50 });
		const result = await tool.execute({
			command: "sh -c 'for i in $(seq 1 100); do echo padding-$i; done'",
		});
		expect(result.details?.truncated).toBe(true);
		expect(result.content).toContain("truncated");
	});

	it("exposes a usable default allowlist", () => {
		expect(DEFAULT_ALLOWLIST).toContain("curl");
		expect(DEFAULT_ALLOWLIST).toContain("cat");
		expect(DEFAULT_ALLOWLIST).toContain("jq");
	});

	it("respects custom env vars", async () => {
		const tool = createBashTool({
			allowlist: ["sh"],
			env: { CSM_AGENT_TEST: "from-test" },
		});
		const result = await tool.execute({ command: "sh -c 'echo $CSM_AGENT_TEST'" });
		expect(result.content).toContain("from-test");
	});
});
