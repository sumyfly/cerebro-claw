import { InMemoryStore } from "@cerebro-claw/memory";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createCspAccountSource } from "../brain-loop.js";

const ID = "aaaaaaaaaaaaaaaaaaaaaaaa";
const NOW = new Date("2026-06-02T00:00:00Z");

function mockCsp(responses: Record<string, unknown>) {
	vi.stubGlobal(
		"fetch",
		vi.fn(async (url: string) => {
			const path = new URL(url).pathname;
			if (path in responses) {
				return { ok: true, json: async () => ({ data: responses[path] }) } as unknown as Response;
			}
			return { ok: false, status: 404, json: async () => ({}) } as unknown as Response;
		}),
	);
}

afterEach(() => vi.unstubAllGlobals());

const opts = (store?: InMemoryStore) => ({
	baseUrl: "http://csp.test",
	token: "t",
	csmEmail: "andrew@x.com",
	store,
	now: () => NOW,
});

describe("createCspAccountSource — engine injection", () => {
	it("injects a computed decision-signals block + the pointer prompt", async () => {
		mockCsp({
			// Real CSP shapes: health.overall.{score,category}; account.businessMetrics.
			[`/api/v1/accounts/${ID}`]: {
				id: ID,
				name: "Acme",
				businessMetrics: {
					mrr: 4000,
					renewalDate: "2026-07-02T00:00:00Z",
					transactionMetrics: {
						breakdown: { pos_txn_count_past30days: 400, pos_txn_count_past7days: 40 },
					},
				},
			},
			[`/api/v1/accounts/${ID}/health-score`]: { overall: { score: 41, category: "AT_RISK" } },
			[`/api/v1/accounts/${ID}/engagement`]: [{ last_seen: "2026-06-01T00:00:00Z" }],
		});
		const source = createCspAccountSource(opts());
		const summary = await source.buildSummary(ID, "Acme");
		expect(summary).toContain("Decision signals (computed for you)");
		expect(summary).toContain("Health: 41 (grade AT_RISK)");
		expect(summary).toContain("Usage trend: down"); // 7d=40 << weekly avg ~93
		expect(summary).toContain("$48,000/yr"); // mrr 4000 * 12
		expect(summary).toContain("Renewal: 30 day(s) away");
		// Pointer prompt is still appended.
		expect(summary).toContain("Pick the right band and CALL ITS TOOL");
	});

	it("surfaces a stored override as a hard MUST directive", async () => {
		mockCsp({
			[`/api/v1/accounts/${ID}`]: { id: ID, name: "VIP" },
			[`/api/v1/accounts/${ID}/health-score`]: { overall: { score: 90, category: "EXCELLENT" } },
			[`/api/v1/accounts/${ID}/engagement`]: [],
		});
		const store = new InMemoryStore();
		await store.addInstinct({
			id: "o1",
			customerId: ID,
			content: "override: escalate — VIP, CSM owns every touch",
			source: "csm",
			createdAt: NOW,
		});
		const source = createCspAccountSource(opts(store));
		const summary = await source.buildSummary(ID, "VIP");
		expect(summary).toMatch(/MUST use the "escalate" band/);
	});

	it("persists the signal fingerprint and reports no-change on the next cycle", async () => {
		mockCsp({
			[`/api/v1/accounts/${ID}`]: {
				id: ID,
				name: "Acme",
				businessMetrics: {
					transactionMetrics: {
						breakdown: { pos_txn_count_past30days: 120, pos_txn_count_past7days: 28 },
					},
				},
			},
			[`/api/v1/accounts/${ID}/health-score`]: { overall: { score: 60, category: "MODERATE" } },
			[`/api/v1/accounts/${ID}/engagement`]: [],
		});
		const store = new InMemoryStore();
		const source = createCspAccountSource(opts(store));

		// Cycle 1: first look — no prior decision, so no "no change" line. The
		// fingerprint is persisted by onEvaluated (after the review), NOT by
		// buildSummary (which is side-effect free).
		const first = await source.buildSummary(ID, "Acme");
		expect(first).not.toContain("No material change");
		expect(await store.getLastDecision(ID)).toBeNull(); // buildSummary didn't record
		await source.onEvaluated!(ID);
		expect(await store.getLastDecision(ID)).not.toBeNull();

		// Cycle 2: identical CSP data → fingerprint matches → the agent is told
		// nothing has changed and should default to no action.
		const second = await source.buildSummary(ID, "Acme");
		expect(second).toContain("No material change since last cycle");
	});

	it("derives a health trend from the prior cycle's score", async () => {
		const store = new InMemoryStore();
		const acct = (score: number) => ({
			[`/api/v1/accounts/${ID}`]: { id: ID, name: "Acme" },
			[`/api/v1/accounts/${ID}/health-score`]: { overall: { score, category: "X" } },
			[`/api/v1/accounts/${ID}/engagement`]: [],
		});

		// Cycle 1 at health 80 — no prior; onEvaluated records the score.
		mockCsp(acct(80));
		const s1 = createCspAccountSource(opts(store));
		const first = await s1.buildSummary(ID, "Acme");
		expect(first).toContain("Health: 80");
		await s1.onEvaluated!(ID);
		expect(await store.getLastDecision(ID)).toMatchObject({ healthScore: 80 });

		// Cycle 2 at health 54 — prior was 80 → trend down surfaced to the agent.
		mockCsp(acct(54));
		const second = await createCspAccountSource(opts(store)).buildSummary(ID, "Acme");
		expect(second).toContain("Health: 54");
		expect(second).toContain("trend down");
	});

	it("degrades to the pointer prompt when CSP fetch fails", async () => {
		vi.stubGlobal(
			"fetch",
			vi.fn(async () => {
				throw new Error("network down");
			}),
		);
		const source = createCspAccountSource(opts());
		const summary = await source.buildSummary(ID, "Acme");
		// computeSignals still runs on an empty snapshot, so a signals block renders,
		// but the pointer must always be present and nothing should throw.
		expect(summary).toContain("Pick the right band and CALL ITS TOOL");
	});
});
