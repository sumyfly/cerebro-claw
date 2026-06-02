import { describe, expect, it } from "vitest";
import { type AccountSnapshot, computeSignals } from "../signals.js";

const NOW = new Date("2026-06-02T00:00:00Z");

function snap(overrides: Partial<AccountSnapshot> = {}): AccountSnapshot {
	return { now: NOW, ...overrides };
}

describe("computeSignals", () => {
	it("extracts health, usage, and contract value", () => {
		const s = computeSignals(
			snap({
				account: { contractValue: 50000 },
				healthScore: { overallScore: 88, grade: "A", trend: "flat" },
				engagement: { logins30d: 120, trend: "flat" },
			}),
		);
		expect(s.healthScore).toBe(88);
		expect(s.healthGrade).toBe("A");
		expect(s.usageTrend).toBe("flat");
		expect(s.logins30d).toBe(120);
		expect(s.contractValue).toBe(50000);
	});

	it("falls back to arr when contractValue is absent", () => {
		const s = computeSignals(snap({ account: { arr: 12000 } }));
		expect(s.contractValue).toBe(12000);
	});

	it("computes days to the soonest OPEN renewal (ignores closed)", () => {
		const s = computeSignals(
			snap({
				renewals: [
					{ renewalDate: "2026-07-02T00:00:00Z", status: "OPEN" }, // 30 days
					{ renewalDate: "2026-06-09T00:00:00Z", status: "CLOSED_WON" }, // ignored
				],
			}),
		);
		expect(s.daysToRenewal).toBe(30);
	});

	it("reports a negative daysToRenewal for an overdue renewal", () => {
		const s = computeSignals(
			snap({ renewals: [{ renewalDate: "2026-05-28T00:00:00Z", status: "OPEN" }] }),
		);
		expect(s.daysToRenewal).toBe(-5);
	});

	it("computes days since last contact", () => {
		const s = computeSignals(snap({ lastContactDate: "2026-05-23T00:00:00Z" }));
		expect(s.daysSinceLastContact).toBe(10);
	});

	it("surfaces an override that forces a band", () => {
		const s = computeSignals(
			snap({ overrides: [{ rule: "escalate everything for Acme", forcesBand: "escalate" }] }),
		);
		expect(s.hasOverride).toBe(true);
		expect(s.overrideForcesBand).toBe("escalate");
	});

	it("marks first-ever look as changed", () => {
		const s = computeSignals(snap({ healthScore: { grade: "B", trend: "flat" } }));
		expect(s.changedSinceLastCycle).toBe(true);
		expect(s.lastBand).toBeNull();
	});

	it("is unchanged when the fingerprint matches last cycle", () => {
		const base = snap({
			healthScore: { grade: "C", trend: "down" },
			engagement: { trend: "down" },
		});
		const first = computeSignals(base);
		const second = computeSignals({
			...base,
			lastDecision: { signalFingerprint: first.signalFingerprint, band: "act" },
		});
		expect(second.changedSinceLastCycle).toBe(false);
		expect(second.lastBand).toBe("act");
	});

	it("detects a change when the trend moves but old fingerprint is stale", () => {
		const before = computeSignals(snap({ healthScore: { grade: "B", trend: "flat" } }));
		const after = computeSignals(
			snap({
				healthScore: { grade: "D", trend: "down" },
				lastDecision: { signalFingerprint: before.signalFingerprint, band: "act" },
			}),
		);
		expect(after.changedSinceLastCycle).toBe(true);
	});

	it("does not churn the fingerprint on sub-bucket noise (one login, one health point)", () => {
		const a = computeSignals(
			snap({
				healthScore: { overallScore: 80, grade: "B", trend: "flat" },
				engagement: { logins30d: 100, trend: "flat" },
			}),
		);
		const b = computeSignals(
			snap({
				healthScore: { overallScore: 81, grade: "B", trend: "flat" },
				engagement: { logins30d: 103, trend: "flat" },
			}),
		);
		expect(a.signalFingerprint).toBe(b.signalFingerprint);
	});
});
