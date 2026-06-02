import { describe, expect, it } from "vitest";
import { snapshotFromScenario } from "../snapshot.js";
import type { Scenario } from "../types.js";

const NOW = new Date("2026-06-02T00:00:00Z");
const ID = "bbbbbbbbbbbbbbbbbbbbbbbb";

const scenario: Scenario = {
	id: "s",
	description: "",
	csp: {
		[`/api/v1/accounts/${ID}`]: {
			data: {
				id: ID,
				name: "Risky Co",
				businessMetrics: {
					mrr: 6000,
					transactionMetrics: {
						breakdown: { pos_txn_count_past30days: 400, pos_txn_count_past7days: 25 },
					},
				},
			},
		},
		[`/api/v1/accounts/${ID}/health-score`]: {
			data: { overall: { score: 41, category: "AT_RISK" } },
		},
		[`/api/v1/accounts/${ID}/engagement`]: { data: [{ last_seen: "2026-05-20T10:00:00.000Z" }] },
	},
	memory: {
		instincts: ["Evaluating a competitor."],
		overrides: [{ rule: "always escalate", forcesBand: "escalate" }],
	},
	expect: { band: "escalate" },
};

describe("snapshotFromScenario", () => {
	it("maps real CSP shapes + memory keyed by business id", () => {
		const built = snapshotFromScenario(scenario, NOW);
		expect(built).not.toBeNull();
		expect(built?.businessId).toBe(ID);
		expect(built?.snapshot.account?.contractValue).toBe(72000); // mrr 6000 * 12
		expect(built?.snapshot.healthScore?.overallScore).toBe(41);
		expect(built?.snapshot.healthScore?.grade).toBe("AT_RISK");
		expect(built?.snapshot.engagement?.trend).toBe("down"); // 7d=25 << weekly avg ~93
		expect(built?.snapshot.instincts).toEqual(["Evaluating a competitor."]);
		expect(built?.snapshot.overrides?.[0].forcesBand).toBe("escalate");
	});

	it("returns null when no account fixture is present", () => {
		const empty: Scenario = { id: "x", description: "", csp: {}, expect: { band: "none" } };
		expect(snapshotFromScenario(empty, NOW)).toBeNull();
	});
});
