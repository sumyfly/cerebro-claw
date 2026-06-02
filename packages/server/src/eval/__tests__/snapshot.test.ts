import { describe, expect, it } from "vitest";
import { snapshotFromScenario } from "../snapshot.js";
import type { Scenario } from "../types.js";

const NOW = new Date("2026-06-02T00:00:00Z");
const ID = "bbbbbbbbbbbbbbbbbbbbbbbb";

const scenario: Scenario = {
	id: "s",
	description: "",
	csp: {
		[`/api/v1/accounts/${ID}`]: { data: { id: ID, name: "Risky Co", contractValue: 80000 } },
		[`/api/v1/accounts/${ID}/health-score`]: {
			data: { overallScore: 41, grade: "D", trend: "down" },
		},
		[`/api/v1/accounts/${ID}/engagement`]: { data: { logins30d: 12, trend: "down" } },
	},
	memory: {
		instincts: ["Evaluating a competitor."],
		overrides: [{ rule: "always escalate", forcesBand: "escalate" }],
	},
	expect: { band: "escalate" },
};

describe("snapshotFromScenario", () => {
	it("extracts account/health/engagement + memory keyed by business id", () => {
		const built = snapshotFromScenario(scenario, NOW);
		expect(built).not.toBeNull();
		expect(built?.businessId).toBe(ID);
		expect(built?.snapshot.account?.contractValue).toBe(80000);
		expect(built?.snapshot.healthScore?.grade).toBe("D");
		expect(built?.snapshot.engagement?.trend).toBe("down");
		expect(built?.snapshot.instincts).toEqual(["Evaluating a competitor."]);
		expect(built?.snapshot.overrides?.[0].forcesBand).toBe("escalate");
	});

	it("returns null when no account fixture is present", () => {
		const empty: Scenario = { id: "x", description: "", csp: {}, expect: { band: "none" } };
		expect(snapshotFromScenario(empty, NOW)).toBeNull();
	});
});
