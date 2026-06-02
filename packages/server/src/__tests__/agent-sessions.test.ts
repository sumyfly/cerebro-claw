import { describe, expect, it } from "vitest";
import { AgentRuntime } from "../agent-runtime.js";

describe("AgentRuntime sessions", () => {
	const agent = new AgentRuntime("fake-key", "fake-model", []);

	it("creates sessions on demand", () => {
		const history = agent.getOrCreateSession("test-1");
		expect(history).toEqual([]);
	});

	it("returns same session for same ID", () => {
		const h1 = agent.getOrCreateSession("test-2");
		h1.push({ role: "user", content: "hello" });
		const h2 = agent.getOrCreateSession("test-2");
		expect(h2).toHaveLength(1);
	});

	it("lists active sessions", () => {
		agent.getOrCreateSession("s-a");
		agent.getOrCreateSession("s-b");
		const sessions = agent.listSessions();
		expect(sessions).toContain("s-a");
		expect(sessions).toContain("s-b");
	});

	it("clears a session", () => {
		agent.getOrCreateSession("s-clear");
		agent.clearSession("s-clear");
		expect(agent.listSessions()).not.toContain("s-clear");
	});
});
