import { describe, expect, it } from "vitest";
import { cspToSnapshot, deriveUsageTrend } from "../csp-snapshot.js";

const NOW = new Date("2026-06-02T00:00:00Z");

// Trimmed real-shaped CSP payloads (verified against cspapi.test.shub.us).
const account = {
	id: "651a8020a67e5b0007f02a3d",
	name: "16chillgrill",
	plan: "small_annually",
	businessMetrics: {
		mrr: 101.39,
		renewalDate: "2027-11-07T09:02:00.000Z",
		transactionMetrics: {
			breakdown: {
				pos_txn_count_past30days: 424,
				qrdinein_txn_count_past30days: 133,
				pos_txn_count_past7days: 137,
				qrdinein_txn_count_past7days: 29,
			},
		},
	},
};
const health = { overall: { score: 54, category: "AT_RISK" } };
const engagement = [
	{ last_seen: "2026-05-30T22:55:38.000Z" },
	{ last_seen: "2026-05-25T02:30:23.000Z" },
	{ last_seen: "2026-01-01T00:00:00.000Z" }, // >30d ago, excluded
];

describe("cspToSnapshot", () => {
	it("maps the real CSP shapes into the engine snapshot", () => {
		const s = cspToSnapshot({ account, health, engagement }, NOW);
		expect(s.healthScore?.overallScore).toBe(54);
		expect(s.healthScore?.grade).toBe("AT_RISK");
		expect(s.account?.contractValue).toBe(1217); // round(101.39*12)
		expect(s.renewals?.[0].renewalDate).toBe("2027-11-07T09:02:00.000Z");
		expect(s.engagement?.logins30d).toBe(2); // two sessions within 30d
	});

	it("handles missing businessMetrics/health gracefully", () => {
		const s = cspToSnapshot({ account: { id: "x" }, health: {} }, NOW);
		expect(s.healthScore?.overallScore).toBeUndefined();
		expect(s.account?.contractValue).toBeUndefined();
		expect(s.renewals).toBeUndefined();
	});
});

describe("deriveUsageTrend", () => {
	it("flags down when the 7d run-rate is below the 30d weekly average", () => {
		// 30d=557 → weekly avg ≈130; 7d=50 < 117 → down
		expect(deriveUsageTrend({ pos_txn_count_past30days: 557, pos_txn_count_past7days: 50 })).toBe(
			"down",
		);
	});
	it("flags up when the 7d run-rate beats the 30d weekly average", () => {
		expect(deriveUsageTrend({ pos_txn_count_past30days: 400, pos_txn_count_past7days: 200 })).toBe(
			"up",
		);
	});
	it("flags flat within the ±10% band", () => {
		// 30d=120 → weekly avg=28; 7d=28 → flat
		expect(deriveUsageTrend({ pos_txn_count_past30days: 120, pos_txn_count_past7days: 28 })).toBe(
			"flat",
		);
	});
	it("returns undefined with no data", () => {
		expect(deriveUsageTrend(undefined)).toBeUndefined();
	});
});

import { deriveHealthTrend } from "../csp-snapshot.js";
describe("deriveHealthTrend", () => {
	it("down when health fell beyond the noise band", () => {
		expect(deriveHealthTrend(54, 70)).toBe("down");
	});
	it("up when health rose beyond the noise band", () => {
		expect(deriveHealthTrend(80, 60)).toBe("up");
	});
	it("flat within ±2", () => {
		expect(deriveHealthTrend(61, 60)).toBe("flat");
	});
	it("undefined without a prior", () => {
		expect(deriveHealthTrend(60, undefined)).toBeUndefined();
	});
});
