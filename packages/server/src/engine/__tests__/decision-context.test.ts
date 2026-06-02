import { describe, expect, it } from "vitest";
import { renderDecisionContext } from "../decision-context.js";
import { type AccountSnapshot, computeSignals } from "../signals.js";

const NOW = new Date("2026-06-02T00:00:00Z");
const sig = (o: Partial<AccountSnapshot> = {}) => computeSignals({ now: NOW, ...o });

describe("renderDecisionContext", () => {
	it("states health, usage, renewal, and contract value", () => {
		const ctx = renderDecisionContext(
			sig({
				account: { contractValue: 50000 },
				healthScore: { overallScore: 41, grade: "D", trend: "down" },
				engagement: { logins30d: 12, trend: "down" },
				renewals: [{ renewalDate: "2026-07-02T00:00:00Z", status: "OPEN" }],
			}),
		);
		expect(ctx).toContain("Health: 41 (grade D), trend down");
		expect(ctx).toContain("Usage trend: down (12 logins/30d)");
		expect(ctx).toContain("Renewal: 30 day(s) away");
		expect(ctx).toContain("$50,000/yr");
	});

	it("emits a hard MUST directive when an override forces a band", () => {
		const ctx = renderDecisionContext(
			sig({ overrides: [{ rule: "always escalate Acme", forcesBand: "escalate" }] }),
		);
		expect(ctx).toContain("OVERRIDE");
		expect(ctx).toMatch(/MUST use the "escalate" band/);
	});

	it("tells the agent to default to no action when nothing changed", () => {
		const base: Partial<AccountSnapshot> = {
			healthScore: { grade: "B", trend: "flat" },
			engagement: { trend: "flat" },
		};
		const first = sig(base);
		const ctx = renderDecisionContext(
			sig({ ...base, lastDecision: { signalFingerprint: first.signalFingerprint, band: "act" } }),
		);
		expect(ctx).toContain("No material change since last cycle");
		expect(ctx).toContain("last decision: act");
		expect(ctx).toContain("Default to NO action");
	});

	it("suppresses a bookkeeping placeholder band in the no-change line", () => {
		const base: Partial<AccountSnapshot> = { healthScore: { grade: "C", trend: "flat" } };
		const first = sig(base);
		const ctx = renderDecisionContext(
			sig({
				...base,
				lastDecision: { signalFingerprint: first.signalFingerprint, band: "reviewed" },
			}),
		);
		expect(ctx).toContain("No material change since last cycle");
		expect(ctx).not.toContain("last decision");
	});

	it("does NOT add the no-change line on a first look", () => {
		const ctx = renderDecisionContext(sig({ healthScore: { grade: "A", trend: "flat" } }));
		expect(ctx).not.toContain("No material change");
	});

	it("lists instinct notes", () => {
		const ctx = renderDecisionContext(sig(), ["Mike is the real decision maker."]);
		expect(ctx).toContain("instinct notes");
		expect(ctx).toContain("- Mike is the real decision maker.");
	});

	it("omits the renewal line when there is no open renewal", () => {
		const ctx = renderDecisionContext(sig());
		expect(ctx).not.toContain("Renewal:");
	});
});
