import { InMemoryActionLedger, InMemorySituationStore } from "@cerebro-claw/memory";
import { describe, expect, it } from "vitest";
import { computeDigestCounts, digestHeadline } from "../digest.js";

const NOW = new Date("2026-06-05T12:00:00Z");

describe("digest — D5 situations reframe", () => {
	it("falls back to escalation count when no situation store", async () => {
		const ledger = new InMemoryActionLedger();
		await ledger.record({
			band: "escalate",
			customerId: "b1",
			summary: "x",
			reason: "y",
			status: "needs-csm",
		});
		const counts = await computeDigestCounts(ledger, NOW);
		expect(counts.situations.needsCsm).toBe(1);
		expect(digestHeadline(counts)).toContain("1 situations need you");
	});

	it("counts escalated/needs-attention situations + bare escalations (union)", async () => {
		const ledger = new InMemoryActionLedger();
		const situations = new InMemorySituationStore();

		// An escalated situation
		const esc = await situations.open({ businessId: "b1", kind: "billing-issue", title: "e" });
		await situations.update(esc.id, { status: "escalated" });
		// A watching+needsAttention situation (also needs CSM)
		const watch = await situations.open({ businessId: "b2", kind: "adoption-gap", title: "w" });
		await situations.update(watch.id, { status: "watching", needsAttention: true });
		// A plain watching situation (tracked, no action)
		const calm = await situations.open({ businessId: "b3", kind: "other", title: "c" });
		await situations.update(calm.id, { status: "watching" });

		// A bare escalation in the ledger with NO situation link → must not be lost
		await ledger.record({
			band: "escalate",
			customerId: "b9",
			summary: "bare",
			reason: "r",
			status: "needs-csm",
		});

		const counts = await computeDigestCounts(ledger, NOW, 24, situations);
		expect(counts.situations.needsCsm).toBe(3); // esc + watch(needsAttention) + bare escalation
		expect(counts.situations.watching).toBe(2); // watch + calm
		expect(digestHeadline(counts)).toContain("3 situations need you");
	});
});
