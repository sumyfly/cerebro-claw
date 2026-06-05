import { resolveNextCheckpoint } from "@cerebro-claw/shared";
import Database from "better-sqlite3";
import { describe, expect, it } from "vitest";
import { InMemorySituationStore } from "../in-memory-situation-store.js";
import { SqliteSituationStore } from "../sqlite-situation-store.js";

// Run the same behavioral suite against both implementations.
const stores: [string, () => { open: SqliteSituationStore | InMemorySituationStore }][] = [
	["InMemorySituationStore", () => ({ open: new InMemorySituationStore() })],
	["SqliteSituationStore", () => ({ open: new SqliteSituationStore(new Database(":memory:")) })],
];

for (const [name, make] of stores) {
	describe(name, () => {
		it("opens and fetches a situation", async () => {
			const store = make().open;
			const s = await store.open({
				businessId: "biz-1",
				kind: "renewal-risk",
				renewalId: "R1",
				title: "biz-1 renewal at risk",
			});
			expect(s.id).toBeDefined();
			expect(s.status).toBe("open");
			expect(s.needsAttention).toBe(false);
			const fetched = await store.get(s.id);
			expect(fetched?.title).toBe("biz-1 renewal at risk");
		});

		it("open is idempotent for the same identity (no duplicate)", async () => {
			const store = make().open;
			const a = await store.open({
				businessId: "biz-1",
				kind: "renewal-risk",
				renewalId: "R1",
				title: "first",
			});
			const b = await store.open({
				businessId: "biz-1",
				kind: "renewal-risk",
				renewalId: "R1",
				title: "second attempt",
			});
			expect(b.id).toBe(a.id);
			expect(b.title).toBe("first"); // existing returned, not re-created
		});

		it("keeps two renewals on one account as two situations", async () => {
			const store = make().open;
			const r1 = await store.open({
				businessId: "biz-1",
				kind: "renewal-risk",
				renewalId: "R1",
				title: "R1",
			});
			const r2 = await store.open({
				businessId: "biz-1",
				kind: "renewal-risk",
				renewalId: "R2",
				title: "R2",
			});
			expect(r1.id).not.toBe(r2.id);
			const open = await store.listOpen("biz-1");
			expect(open).toHaveLength(2);
		});

		it("account-level kinds key on (businessId, kind) only", async () => {
			const store = make().open;
			const a = await store.open({
				businessId: "biz-1",
				kind: "adoption-gap",
				title: "adoption",
			});
			const b = await store.open({
				businessId: "biz-1",
				kind: "adoption-gap",
				title: "again",
			});
			expect(b.id).toBe(a.id);
		});

		it("defaults nextCheckpoint to ~72h when set to watching", async () => {
			const store = make().open;
			const s = await store.open({
				businessId: "biz-1",
				kind: "adoption-gap",
				title: "x",
				status: "watching",
			});
			expect(s.nextCheckpoint).toBeDefined();
			const hours = (s.nextCheckpoint!.getTime() - s.openedAt.getTime()) / 3_600_000;
			expect(hours).toBeGreaterThan(71);
			expect(hours).toBeLessThan(73);
		});

		it("surfaces escalated and needsAttention as needing the CSM", async () => {
			const store = make().open;
			const esc = await store.open({ businessId: "b1", kind: "billing-issue", title: "e" });
			await store.update(esc.id, { status: "escalated" });
			const watch = await store.open({ businessId: "b2", kind: "adoption-gap", title: "w" });
			await store.update(watch.id, { status: "watching", needsAttention: true });
			const calm = await store.open({ businessId: "b3", kind: "other", title: "c" });
			await store.update(calm.id, { status: "watching" });

			const needing = await store.listNeedingCsm();
			const ids = needing.map((s) => s.id).sort();
			expect(ids).toEqual([esc.id, watch.id].sort());
		});

		it("resolves a situation and drops it from open lists", async () => {
			const store = make().open;
			const s = await store.open({ businessId: "b1", kind: "support-escalation", title: "s" });
			await store.resolve(s.id, "recovered");
			expect((await store.get(s.id))?.status).toBe("resolved");
			expect(await store.listOpen("b1")).toHaveLength(0);
			// identity is free again after resolution
			const reopened = await store.open({
				businessId: "b1",
				kind: "support-escalation",
				title: "s2",
			});
			expect(reopened.id).not.toBe(s.id);
		});
	});
}

describe("resolveNextCheckpoint", () => {
	const now = new Date("2026-06-05T00:00:00.000Z");

	it("defaults to 72h when not requested", () => {
		expect(resolveNextCheckpoint(undefined, now).getTime()).toBe(now.getTime() + 72 * 3_600_000);
	});

	it("clamps below 1h up to 1h", () => {
		const tooSoon = new Date(now.getTime() + 60_000);
		expect(resolveNextCheckpoint(tooSoon, now).getTime()).toBe(now.getTime() + 3_600_000);
	});

	it("clamps beyond 30d down to 30d", () => {
		const tooFar = new Date(now.getTime() + 60 * 24 * 3_600_000);
		expect(resolveNextCheckpoint(tooFar, now).getTime()).toBe(now.getTime() + 30 * 24 * 3_600_000);
	});
});
