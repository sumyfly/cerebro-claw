import { describe, expect, it } from "vitest";
import { computeTriageScore, selectByTriage } from "../engine/triage.js";

describe("computeTriageScore", () => {
	it("is deterministic and returns a breakdown", () => {
		const a = computeTriageScore({ healthScore: 40, contractValue: 50_000, daysToRenewal: 10 });
		const b = computeTriageScore({ healthScore: 40, contractValue: 50_000, daysToRenewal: 10 });
		expect(a).toEqual(b);
		expect(a).toHaveProperty("risk");
		expect(a).toHaveProperty("value");
		expect(a).toHaveProperty("urgency");
		expect(a.score).toBeGreaterThan(0);
	});

	it("scores higher risk above lower risk (else equal)", () => {
		const atRisk = computeTriageScore({ healthScore: 30, usageTrend: "down" });
		const healthy = computeTriageScore({ healthScore: 90, usageTrend: "up" });
		expect(atRisk.score).toBeGreaterThan(healthy.score);
	});

	it("scores higher value above lower value (else equal)", () => {
		const big = computeTriageScore({ contractValue: 60_000 });
		const small = computeTriageScore({ contractValue: 2_000 });
		expect(big.value).toBeGreaterThan(small.value);
	});

	it("scores nearer/overdue renewals as more urgent", () => {
		const soon = computeTriageScore({ daysToRenewal: 5 });
		const far = computeTriageScore({ daysToRenewal: 80 });
		const overdue = computeTriageScore({ daysToRenewal: -3 });
		expect(soon.urgency).toBeGreaterThan(far.urgency);
		expect(overdue.urgency).toBe(1);
	});
});

describe("selectByTriage", () => {
	const items = [
		{ id: "low", v: 0.1 },
		{ id: "high", v: 0.9 },
		{ id: "mid", v: 0.5 },
	];
	const scoreOf = (x: { v: number }) => ({ score: x.v, risk: x.v, value: 0, urgency: 0 });

	it("selects the top-N by score, defers the rest (over budget)", () => {
		const { selected, deferred } = selectByTriage(items, scoreOf, { max: 2, minScore: 0 });
		expect(selected.map((s) => s.item.id)).toEqual(["high", "mid"]);
		expect(deferred.map((d) => d.item.id)).toEqual(["low"]);
		expect(deferred[0].reason).toBe("over-budget");
	});

	it("defers everything below the floor (zero turns when all calm)", () => {
		const { selected, deferred } = selectByTriage(items, scoreOf, { max: 10, minScore: 1 });
		expect(selected).toHaveLength(0);
		expect(deferred).toHaveLength(3);
		expect(deferred.every((d) => d.reason === "below-floor")).toBe(true);
	});

	it("a worsening deferred item resurfaces when its score rises", () => {
		let lowScore = 0.1;
		const dyn = [{ id: "x" }, { id: "y", fixed: 0.5 }];
		const score = (it: { id: string; fixed?: number }) => ({
			score: it.fixed ?? lowScore,
			risk: 0,
			value: 0,
			urgency: 0,
		});
		// Cycle 1: x below y, budget 1 → only y worked.
		let r = selectByTriage(dyn, score, { max: 1, minScore: 0 });
		expect(r.selected.map((s) => s.item.id)).toEqual(["y"]);
		// Cycle 2: x worsens (score rises above y) → x now surfaces.
		lowScore = 0.9;
		r = selectByTriage(dyn, score, { max: 1, minScore: 0 });
		expect(r.selected.map((s) => s.item.id)).toEqual(["x"]);
	});
});
