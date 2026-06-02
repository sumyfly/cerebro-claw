import { InMemoryActionLedger } from "@cerebro-claw/memory";
import { describe, expect, it } from "vitest";
import { createActionObserver } from "../action-observer.js";

const NOW = new Date("2026-06-02T12:00:00Z");
const ok = { content: "done", success: true };

describe("createActionObserver", () => {
	it("records an implicit act when the agent logs a CSP note without `act`", async () => {
		const ledger = new InMemoryActionLedger();
		const observe = createActionObserver(ledger, () => NOW);
		await observe("csp_create_note", { business_id: "biz-1", content: "note" }, ok);
		const entries = await ledger.listByWindow(new Date(0), new Date(8640000000000000));
		expect(entries).toHaveLength(1);
		expect(entries[0]).toMatchObject({ band: "act", customerId: "biz-1" });
	});

	it("does not double-count when a band entry already exists for the customer", async () => {
		const ledger = new InMemoryActionLedger();
		await ledger.record({
			band: "escalate",
			customerId: "biz-1",
			summary: "escalated",
			reason: "risk",
			status: "needs-csm",
			createdAt: NOW,
		});
		const observe = createActionObserver(ledger, () => NOW);
		await observe("csp_create_note", { business_id: "biz-1" }, ok);
		const entries = await ledger.listByWindow(new Date(0), new Date(8640000000000000));
		expect(entries).toHaveLength(1); // no extra act
		expect(entries[0].band).toBe("escalate");
	});

	it("ignores non-note tools and failed calls", async () => {
		const ledger = new InMemoryActionLedger();
		const observe = createActionObserver(ledger, () => NOW);
		await observe("csp_get_account", { business_id: "biz-1" }, ok);
		await observe("csp_create_note", { business_id: "biz-1" }, { content: "x", success: false });
		expect(await ledger.listByWindow(new Date(0), new Date(8640000000000000))).toHaveLength(0);
	});
});
