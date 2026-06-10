import { describe, expect, it, vi } from "vitest";
import type { AgentBackend } from "../agent-backend.js";
import { createLlmCriticVerifier } from "../verifier.js";

const INPUT = {
	band: "notify-then-act",
	customerId: "biz-1",
	customerName: "Acme",
	summary: "Send to Acme: check-in",
	reason: "30d silent, healthy account",
};

function agentReplying(text: string) {
	const prompt = vi.fn(async () => ({ text, toolCalls: [] }));
	return { agent: { prompt } as unknown as AgentBackend, prompt };
}

describe("createLlmCriticVerifier", () => {
	it("passes when the critic replies PASS", async () => {
		const { agent } = agentReplying("PASS justification clearly supports a routine touch");
		const res = await createLlmCriticVerifier(agent).verify(INPUT);
		expect(res.pass).toBe(true);
		expect(res.reason).toContain("routine touch");
	});

	it("fails when the critic replies FAIL", async () => {
		const { agent } = agentReplying("FAIL justification is generic");
		const res = await createLlmCriticVerifier(agent).verify(INPUT);
		expect(res.pass).toBe(false);
		expect(res.reason).toContain("generic");
	});

	it("fail-safe: a critic error blocks the action instead of waving it through", async () => {
		const prompt = vi.fn(async () => {
			throw new Error("model unavailable");
		});
		const res = await createLlmCriticVerifier({ prompt } as unknown as AgentBackend).verify(INPUT);
		expect(res.pass).toBe(false);
		expect(res.reason).toContain("model unavailable");
	});

	it("runs on whichever backend it is given (the VERIFIER_MODEL seam)", async () => {
		// app.ts builds the critic on a second runtime when VERIFIER_MODEL is set;
		// the contract that makes that work is simply that the verifier prompts
		// THE BACKEND IT WAS CONSTRUCTED WITH, never a global.
		const { agent, prompt } = agentReplying("PASS ok");
		await createLlmCriticVerifier(agent).verify(INPUT);
		expect(prompt).toHaveBeenCalledOnce();
		expect(prompt.mock.calls[0][2]).toBe("verify:biz-1"); // its own session, not the review session
	});
});
