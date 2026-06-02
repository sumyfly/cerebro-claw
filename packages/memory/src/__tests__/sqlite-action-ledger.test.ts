import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { SqliteActionLedger } from "../sqlite-action-ledger.js";

describe("SqliteActionLedger", () => {
	let dir: string;
	let dbPath: string;
	let ledger: SqliteActionLedger;

	beforeEach(() => {
		dir = mkdtempSync(join(tmpdir(), "cc-ledger-"));
		dbPath = join(dir, "ledger.db");
		ledger = new SqliteActionLedger(dbPath);
	});

	afterEach(() => {
		ledger.close();
		rmSync(dir, { recursive: true, force: true });
	});

	it("persists records across reopens", async () => {
		const e = await ledger.record({
			band: "act",
			customerId: "biz-1",
			customerName: "Acme",
			summary: "noted",
			reason: "x",
			status: "done",
			executedAt: new Date(),
		});
		ledger.close();
		const reopened = new SqliteActionLedger(dbPath);
		try {
			const fetched = await reopened.get(e.id);
			expect(fetched?.summary).toBe("noted");
			expect(fetched?.customerName).toBe("Acme");
		} finally {
			reopened.close();
		}
	});

	it("roundtrips payload JSON", async () => {
		const e = await ledger.record({
			band: "notify-then-act",
			customerId: "biz-1",
			summary: "send",
			reason: "x",
			status: "in-flight",
			executeAt: new Date(),
			payload: { recipient: "a@b.com", text: "hello", count: 7 },
		});
		const fetched = await ledger.get(e.id);
		expect(fetched?.payload).toEqual({ recipient: "a@b.com", text: "hello", count: 7 });
	});

	it("listDue filters by execute_at <= now AND in-flight", async () => {
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
			summary: "future",
			reason: "x",
			status: "in-flight",
			executeAt: new Date("2026-05-29T13:00:00Z"),
		});
		const due = await ledger.listDue(now);
		expect(due.map((e) => e.summary)).toEqual(["due"]);
	});

	it("update mutates status + executed_at", async () => {
		const e = await ledger.record({
			band: "notify-then-act",
			customerId: "a",
			summary: "send",
			reason: "x",
			status: "in-flight",
			executeAt: new Date(),
			payload: { recipient: "x@y", text: "hi" },
		});
		const executedAt = new Date("2026-05-29T14:00:00Z");
		const updated = await ledger.update(e.id, { status: "executed", executedAt });
		expect(updated?.status).toBe("executed");
		expect(updated?.executedAt?.toISOString()).toBe(executedAt.toISOString());
		// payload preserved
		expect(updated?.payload).toEqual({ recipient: "x@y", text: "hi" });
	});

	it("listByWindow respects [since, until)", async () => {
		await ledger.record({
			band: "act",
			customerId: "a",
			summary: "inside",
			reason: "x",
			status: "done",
			createdAt: new Date("2026-05-29T10:00:00Z"),
		});
		await ledger.record({
			band: "act",
			customerId: "a",
			summary: "at-end",
			reason: "x",
			status: "done",
			createdAt: new Date("2026-05-29T12:00:00Z"),
		});
		const window = await ledger.listByWindow(
			new Date("2026-05-29T09:00:00Z"),
			new Date("2026-05-29T12:00:00Z"),
		);
		// half-open: 12:00:00 is excluded
		expect(window.map((e) => e.summary)).toEqual(["inside"]);
	});
});
