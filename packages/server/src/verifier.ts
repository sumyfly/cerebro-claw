import type { VerificationInput, VerificationResult, Verifier } from "@cerebro-claw/shared";
import type { AgentBackend } from "./agent-backend.js";

/**
 * Default verifier — an adversarial LLM critic. Given a proposed high-stakes
 * action, it tries to REFUTE it and defaults to FAIL when the justification is
 * thin or doesn't clearly support the band. A separate cheap pass through the
 * same agent backend; pluggable, so a rule-based or cheaper critic can replace
 * it. Disabled → use createNoopVerifier (always passes).
 */
export function createLlmCriticVerifier(agent: AgentBackend): Verifier {
	return {
		async verify(input: VerificationInput): Promise<VerificationResult> {
			const lines = [
				"You are a strict reviewer guarding the customer relationship. Do NOT call any tools — just judge.",
				`The agent proposes a "${input.band}" action for ${input.customerName ?? input.customerId}.`,
				`Summary: ${input.summary}`,
				`Justification: ${input.reason || "(none given)"}`,
			];
			if (input.signals) lines.push(`Signals: ${input.signals}`);
			if (input.situation) lines.push(`Open situation: ${input.situation}`);
			lines.push(
				"",
				"Does this action clearly follow from its justification and suit the band? Refute it if the justification is thin, generic, contradicts the signals, or doesn't warrant a customer-facing / high-stakes move. Default to FAIL when unsure.",
				"Reply with EXACTLY one line: `PASS <reason>` or `FAIL <reason>`.",
			);

			let text: string;
			try {
				const res = await agent.prompt(lines.join("\n"), undefined, `verify:${input.customerId}`);
				text = res.text.trim();
			} catch (err) {
				// If the critic itself errors, fail safe toward the human: block, so a
				// broken verifier never silently waves customer-facing actions through.
				return { pass: false, reason: `verifier error: ${(err as Error).message}` };
			}

			const pass = /^\s*PASS\b/i.test(text);
			const reason = text.replace(/^\s*(PASS|FAIL)\b[:\s-]*/i, "").slice(0, 300);
			return { pass, reason: reason || (pass ? "ok" : "refuted") };
		},
	};
}
