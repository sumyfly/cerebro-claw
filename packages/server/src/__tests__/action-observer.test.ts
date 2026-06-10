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

	it("attaches the created note id as evidence when the result echoes it", async () => {
		const ledger = new InMemoryActionLedger();
		const observe = createActionObserver(ledger, () => NOW);
		await observe(
			"csp_create_note",
			{ business_id: "biz-1", content: "note" },
			{
				content: 'Note created in CSP. {"data":{"id":"note-abc-123","content":"note"}}',
				success: true,
			},
		);
		const entries = await ledger.listByWindow(new Date(0), new Date(8640000000000000));
		expect(entries[0].payload).toMatchObject({ evidence: { kind: "note", id: "note-abc-123" } });
	});

	it("records an implicit act with renewal evidence on csp_update_renewal", async () => {
		const ledger = new InMemoryActionLedger();
		const observe = createActionObserver(ledger, () => NOW);
		await observe(
			"csp_update_renewal",
			{ renewal_id: "0f8fad5b-d9cb-469f-a165-70867728950e", status: "IN_PROGRESS" },
			ok,
		);
		const entries = await ledger.listByWindow(new Date(0), new Date(8640000000000000));
		expect(entries).toHaveLength(1);
		expect(entries[0]).toMatchObject({
			band: "act",
			renewalId: "0f8fad5b-d9cb-469f-a165-70867728950e",
		});
		expect(entries[0].payload).toMatchObject({
			evidence: { kind: "renewal", id: "0f8fad5b-d9cb-469f-a165-70867728950e" },
		});
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

	it("keys a renewal update by the businessId echoed in the CSP response", async () => {
		const ledger = new InMemoryActionLedger();
		const observe = createActionObserver(ledger, () => NOW);
		await observe(
			"csp_update_renewal",
			{ renewal_id: "0f8fad5b-d9cb-469f-a165-70867728950e", status: "IN_PROGRESS" },
			{
				content:
					'Renewal updated. {"data":{"id":"0f8fad5b-d9cb-469f-a165-70867728950e","businessId":"aaaaaaaaaaaaaaaaaaaaaaaa","status":"IN_PROGRESS"}}',
				success: true,
			},
		);
		const entries = await ledger.listByWindow(new Date(0), new Date(8640000000000000));
		expect(entries).toHaveLength(1);
		// Keyed by the account, so listRecentByCustomer(businessId) sees it (closed loop).
		expect(entries[0].customerId).toBe("aaaaaaaaaaaaaaaaaaaaaaaa");
		expect(entries[0].renewalId).toBe("0f8fad5b-d9cb-469f-a165-70867728950e");
	});

	it("dedups on renewalId even when customer ids differ (UUID-keyed vs business-keyed)", async () => {
		const ledger = new InMemoryActionLedger();
		await ledger.record({
			band: "act",
			customerId: "aaaaaaaaaaaaaaaaaaaaaaaa", // explicit act keyed by business id
			summary: "Advanced renewal",
			reason: "x",
			status: "done",
			createdAt: NOW,
			renewalId: "0f8fad5b-d9cb-469f-a165-70867728950e",
		});
		const observe = createActionObserver(ledger, () => NOW);
		await observe(
			"csp_update_renewal",
			{ renewal_id: "0f8fad5b-d9cb-469f-a165-70867728950e" },
			ok, // no businessId in the response → would fall back to UUID keying
		);
		const entries = await ledger.listByWindow(new Date(0), new Date(8640000000000000));
		expect(entries).toHaveLength(1); // no second entry for the same renewal
	});

	it("ignores non-note tools and failed calls", async () => {
		const ledger = new InMemoryActionLedger();
		const observe = createActionObserver(ledger, () => NOW);
		await observe("csp_get_account", { business_id: "biz-1" }, ok);
		await observe("csp_create_note", { business_id: "biz-1" }, { content: "x", success: false });
		expect(await ledger.listByWindow(new Date(0), new Date(8640000000000000))).toHaveLength(0);
	});
});
