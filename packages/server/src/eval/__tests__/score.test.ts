import { describe, expect, it } from "vitest";
import type { ActionLedgerEntry } from "@cerebro-claw/shared";
import { scoreScenario } from "../score.js";
import type { Scenario } from "../types.js";

function entry(band: ActionLedgerEntry["band"], payload?: Record<string, unknown>): ActionLedgerEntry {
	return {
		id: "x", band, customerId: "c", summary: "s", reason: "r",
		status: "done", createdAt: new Date(), payload,
	};
}

const base: Scenario = { id: "s1", description: "", csp: {}, expect: { band: "escalate" } };

describe("scoreScenario", () => {
	it("passes when the expected band was fired", () => {
		const r = scoreScenario(base, [entry("escalate", { situation: "x", recommendation: "y" })]);
		expect(r.pass).toBe(true);
		expect(r.actualBand).toBe("escalate");
	});

	it("fails when a different band was fired", () => {
		const r = scoreScenario(base, [entry("act")]);
		expect(r.pass).toBe(false);
		expect(r.failures[0]).toContain("expected escalate");
	});

	it("treats no ledger entries as band 'none'", () => {
		const noop: Scenario = { ...base, expect: { band: "none" } };
		expect(scoreScenario(noop, []).pass).toBe(true);
		expect(scoreScenario(noop, [entry("act")]).pass).toBe(false);
	});

	it("prefers escalate when multiple bands fired", () => {
		const r = scoreScenario(base, [entry("act"), entry("escalate", { situation: "x", recommendation: "y" })]);
		expect(r.actualBand).toBe("escalate");
		expect(r.pass).toBe(true);
	});

	it("flags an escalate missing situation/recommendation in its payload", () => {
		const r = scoreScenario(base, [entry("escalate", { situation: "x" })]);
		expect(r.pass).toBe(false);
		expect(r.failures.some((f) => f.includes("situation/recommendation"))).toBe(true);
	});

	it("fails an override-required scenario that did not escalate", () => {
		const ov: Scenario = { ...base, expect: { band: "act", overrideHonored: true } };
		const r = scoreScenario(ov, [entry("act")]);
		expect(r.pass).toBe(false);
		expect(r.failures.some((f) => f.includes("override"))).toBe(true);
	});
});
