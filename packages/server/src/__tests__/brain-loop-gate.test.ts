import { InMemoryStore } from "@cerebro-claw/memory";
import { describe, expect, it, vi } from "vitest";
import {
	type AccountGateOptions,
	type AccountReviewPlan,
	type AccountSource,
	BrainLoop,
} from "../brain-loop.js";

const NOW = new Date("2026-06-10T00:00:00Z");
const daysAgo = (n: number) => new Date(NOW.getTime() - n * 86_400_000);

/** A steady, unchanged plan — the gate's "skip me" baseline. */
function steadyPlan(overrides: Partial<AccountReviewPlan> = {}): AccountReviewPlan {
	return {
		triage: { healthScore: 80 },
		changedSinceLastCycle: false,
		hasOpenSituations: false,
		daysToRenewal: null,
		lastReviewedAt: daysAgo(1),
		...overrides,
	};
}

function makeSource(
	accounts: { id: string; companyName: string; plan: AccountReviewPlan | null }[],
): AccountSource {
	const byId = new Map(accounts.map((a) => [a.id, a.plan]));
	return {
		label: "test",
		async list() {
			return accounts.map(({ id, companyName }) => ({ id, companyName }));
		},
		async prepare(id) {
			return byId.get(id) ?? null;
		},
		async buildSummary(_id, companyName) {
			return `Context for ${companyName}`;
		},
	};
}

function loop(
	source: AccountSource,
	opts: { triageMax?: number; gate?: Partial<AccountGateOptions> } = {},
) {
	const prompt = vi.fn(async () => ({ text: "done", toolCalls: [] }));
	const l = new BrainLoop(
		new InMemoryStore(),
		{ prompt } as never,
		999_999,
		true,
		null,
		source,
		null,
		null,
		null,
		null,
		opts.triageMax ?? 0,
		0,
		false,
		opts.gate,
	);
	return { l, prompt };
}

describe("BrainLoop account skip gate", () => {
	it("skips an unchanged steady account without an agent turn", async () => {
		const { l, prompt } = loop(
			makeSource([{ id: "a1", companyName: "Steady", plan: steadyPlan() }]),
		);
		const res = await l.runOnce({ limit: 0 });
		expect(res).toMatchObject({ ran: true });
		expect(prompt).not.toHaveBeenCalled();
	});

	it("reviews an account whose fingerprint changed", async () => {
		const { l, prompt } = loop(
			makeSource([
				{ id: "a1", companyName: "Changed", plan: steadyPlan({ changedSinceLastCycle: true }) },
			]),
		);
		await l.runOnce({ limit: 0 });
		expect(prompt).toHaveBeenCalledTimes(1);
		expect(prompt.mock.calls[0][0] as string).toContain("Changed");
	});

	it("an open Situation bypasses the gate", async () => {
		const { l, prompt } = loop(
			makeSource([
				{ id: "a1", companyName: "Watched", plan: steadyPlan({ hasOpenSituations: true }) },
			]),
		);
		await l.runOnce({ limit: 0 });
		expect(prompt).toHaveBeenCalledTimes(1);
	});

	it("a renewal within the horizon bypasses the gate; one beyond it does not", async () => {
		const { l, prompt } = loop(
			makeSource([
				{ id: "near", companyName: "NearRenewal", plan: steadyPlan({ daysToRenewal: 30 }) },
				{ id: "far", companyName: "FarRenewal", plan: steadyPlan({ daysToRenewal: 200 }) },
			]),
			{ gate: { renewalHorizonDays: 90 } },
		);
		await l.runOnce({ limit: 0 });
		expect(prompt).toHaveBeenCalledTimes(1);
		expect(prompt.mock.calls[0][0] as string).toContain("NearRenewal");
	});

	it("an overdue renewal (negative days) bypasses the gate", async () => {
		const { l, prompt } = loop(
			makeSource([{ id: "od", companyName: "Overdue", plan: steadyPlan({ daysToRenewal: -3 }) }]),
		);
		await l.runOnce({ limit: 0 });
		expect(prompt).toHaveBeenCalledTimes(1);
	});

	it("force-reviews a stale account past maxSkipAgeDays even if unchanged", async () => {
		const { l, prompt } = loop(
			makeSource([
				{ id: "a1", companyName: "Stale", plan: steadyPlan({ lastReviewedAt: daysAgo(10) }) },
			]),
			{ gate: { maxSkipAgeDays: 7 } },
		);
		await l.runOnce({ limit: 0 });
		expect(prompt).toHaveBeenCalledTimes(1);
	});

	it("treats a failed prepare (null plan) as must-review", async () => {
		const { l, prompt } = loop(makeSource([{ id: "a1", companyName: "Broken", plan: null }]));
		await l.runOnce({ limit: 0 });
		expect(prompt).toHaveBeenCalledTimes(1);
	});

	it("gate disabled reviews everything", async () => {
		const { l, prompt } = loop(
			makeSource([{ id: "a1", companyName: "Steady", plan: steadyPlan() }]),
			{ gate: { enabled: false } },
		);
		await l.runOnce({ limit: 0 });
		expect(prompt).toHaveBeenCalledTimes(1);
	});
});

describe("BrainLoop account triage ranking (real signals)", () => {
	it("under a cap, a health-dropped account outranks a steady one", async () => {
		const { l, prompt } = loop(
			makeSource([
				{
					id: "steady",
					companyName: "SteadyCo",
					plan: steadyPlan({ changedSinceLastCycle: true, triage: { healthScore: 85 } }),
				},
				{
					id: "dropping",
					companyName: "DroppingCo",
					plan: steadyPlan({
						changedSinceLastCycle: true,
						triage: { healthScore: 55, healthTrend: "down" },
					}),
				},
			]),
		);
		await l.runOnce({ limit: 1 });
		expect(prompt).toHaveBeenCalledTimes(1);
		expect(prompt.mock.calls[0][0] as string).toContain("DroppingCo");
	});

	it("an override-forced account outranks an unflagged one", async () => {
		const { l, prompt } = loop(
			makeSource([
				{
					id: "plain",
					companyName: "PlainCo",
					plan: steadyPlan({ changedSinceLastCycle: true, triage: { healthScore: 90 } }),
				},
				{
					id: "vip",
					companyName: "VipCo",
					plan: steadyPlan({
						changedSinceLastCycle: true,
						triage: { healthScore: 90, overrideForcesBand: "escalate" },
					}),
				},
			]),
		);
		await l.runOnce({ limit: 1 });
		expect(prompt).toHaveBeenCalledTimes(1);
		expect(prompt.mock.calls[0][0] as string).toContain("VipCo");
	});
});
