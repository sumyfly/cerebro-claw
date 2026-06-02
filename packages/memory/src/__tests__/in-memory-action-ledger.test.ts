import { beforeEach, describe, expect, it } from "vitest";
import { InMemoryActionLedger } from "../in-memory-action-ledger.js";

describe("InMemoryActionLedger", () => {
	let ledger: InMemoryActionLedger;

	beforeEach(() => {
		ledger = new InMemoryActionLedger();
	});

	it("records and fetches an act entry", async () => {
		const entry = await ledger.record({
			band: "act",
			customerId: "biz-1",
			customerName: "Acme",
			summary: "Logged a CSP note",
			reason: "Health flipped to at-risk",
			status: "done",
			executedAt: new Date(),
		});
		expect(entry.id).toBeDefined();
		const fetched = await ledger.get(entry.id);
		expect(fetched?.summary).toBe("Logged a CSP note");
	});

	it("updates status without losing other fields", async () => {
		const entry = await ledger.record({
			band: "notify-then-act",
			customerId: "biz-1",
			summary: "Send check-in",
			reason: "30d silence",
			status: "in-flight",
			executeAt: new Date(Date.now() + 1_000_000),
			payload: { recipient: "x@y.com", text: "hi" },
		});
		const updated = await ledger.update(entry.id, { status: "executed", executedAt: new Date() });
		expect(updated?.status).toBe("executed");
		expect(updated?.payload).toEqual({ recipient: "x@y.com", text: "hi" });
		expect(updated?.summary).toBe("Send check-in");
	});

	it("listByWindow returns only entries inside the half-open interval", async () => {
		const t0 = new Date("2026-05-29T08:00:00Z");
		const t1 = new Date("2026-05-29T12:00:00Z");
		const t2 = new Date("2026-05-29T18:00:00Z");
		await ledger.record({
			band: "act",
			customerId: "a",
			summary: "before",
			reason: "x",
			status: "done",
			createdAt: t0,
		});
		await ledger.record({
			band: "act",
			customerId: "a",
			summary: "inside",
			reason: "x",
			status: "done",
			createdAt: new Date("2026-05-29T13:00:00Z"),
		});
		await ledger.record({
			band: "act",
			customerId: "a",
			summary: "after",
			reason: "x",
			status: "done",
			createdAt: new Date("2026-05-29T19:00:00Z"),
		});
		const window = await ledger.listByWindow(t1, t2);
		expect(window.map((e) => e.summary)).toEqual(["inside"]);
	});

	it("listDue returns notify-then-act entries whose executeAt has passed", async () => {
		const now = new Date("2026-05-29T12:00:00Z");
		await ledger.record({
			band: "notify-then-act",
			customerId: "a",
			summary: "due",
			reason: "x",
			status: "in-flight",
			executeAt: new Date("2026-05-29T11:00:00Z"),
		});
		await ledger.record({
			band: "notify-then-act",
			customerId: "b",
			summary: "not yet",
			reason: "x",
			status: "in-flight",
			executeAt: new Date("2026-05-29T13:00:00Z"),
		});
		await ledger.record({
			band: "notify-then-act",
			customerId: "c",
			summary: "already executed",
			reason: "x",
			status: "executed",
			executeAt: new Date("2026-05-29T10:00:00Z"),
		});
		await ledger.record({
			band: "act",
			customerId: "d",
			summary: "not a notify",
			reason: "x",
			status: "done",
		});
		const due = await ledger.listDue(now);
		expect(due.map((e) => e.summary)).toEqual(["due"]);
	});

	it("listOpen returns in-flight + needs-csm", async () => {
		await ledger.record({
			band: "act",
			customerId: "a",
			summary: "done",
			reason: "x",
			status: "done",
		});
		await ledger.record({
			band: "notify-then-act",
			customerId: "b",
			summary: "queued",
			reason: "x",
			status: "in-flight",
			executeAt: new Date(),
		});
		await ledger.record({
			band: "escalate",
			customerId: "c",
			summary: "awaiting csm",
			reason: "x",
			status: "needs-csm",
		});
		await ledger.record({
			band: "escalate",
			customerId: "d",
			summary: "resolved",
			reason: "x",
			status: "resolved",
		});
		const open = await ledger.listOpen();
		expect(open.map((e) => e.summary).sort()).toEqual(["awaiting csm", "queued"]);
	});

	it("get returns null for unknown id", async () => {
		expect(await ledger.get("nope")).toBeNull();
	});

	it("update returns null for unknown id", async () => {
		expect(await ledger.update("nope", { status: "executed" })).toBeNull();
	});
});
