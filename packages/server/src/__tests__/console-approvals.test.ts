import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ActionLedger } from "@cerebro-claw/shared";
import type { Express } from "express";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createApp } from "../app.js";

describe("Console approval endpoints", () => {
	let app: Express;
	let ledger: ActionLedger;
	let shutdown: () => Promise<void>;
	let tmpDir: string;
	let prevDbPath: string | undefined;

	beforeAll(async () => {
		tmpDir = mkdtempSync(join(tmpdir(), "console-appr-"));
		prevDbPath = process.env.DB_PATH;
		process.env.DB_PATH = join(tmpDir, "test.db");
		const handles = await createApp();
		app = handles.app;
		ledger = handles.ledger;
		shutdown = handles.shutdown;
	});

	afterAll(async () => {
		await shutdown();
		if (prevDbPath !== undefined) process.env.DB_PATH = prevDbPath;
		else delete process.env.DB_PATH;
		rmSync(tmpDir, { recursive: true, force: true });
	});

	async function seedNotify() {
		return ledger.record({
			band: "notify-then-act",
			customerId: "biz-1",
			customerName: "Acme",
			summary: "Send to Acme: check-in",
			reason: "30d silent",
			status: "in-flight",
			createdAt: new Date(),
			executeAt: new Date(Date.now() + 3_600_000),
			payload: { recipient: "a@acme.com", text: "hi" },
		});
	}

	async function seedEscalation() {
		return ledger.record({
			band: "escalate",
			customerId: "biz-2",
			customerName: "Globex",
			summary: "Escalation: Globex — needs CSM decision",
			reason: "renewal risk",
			status: "needs-csm",
			createdAt: new Date(),
			payload: { situation: "x", options: "1. y", recommendation: "y" },
		});
	}

	it("GET /api/actions/pending lists only in-flight notifies", async () => {
		const notify = await seedNotify();
		await seedEscalation();
		const res = await request(app).get("/api/actions/pending");
		expect(res.status).toBe(200);
		const ids = res.body.map((e: { id: string }) => e.id);
		expect(ids).toContain(notify.id);
		for (const e of res.body) {
			expect(e.band).toBe("notify-then-act");
			expect(e.status).toBe("in-flight");
		}
	});

	it("GET /api/actions/escalations lists only needs-csm escalations", async () => {
		const res = await request(app).get("/api/actions/escalations");
		expect(res.status).toBe(200);
		expect(res.body.length).toBeGreaterThan(0);
		for (const e of res.body) {
			expect(e.band).toBe("escalate");
			expect(e.status).toBe("needs-csm");
		}
	});

	it("POST /api/actions/:id/cancel cancels a pending send so the dispatcher never fires it", async () => {
		const notify = await seedNotify();
		const res = await request(app)
			.post(`/api/actions/${notify.id}/cancel`)
			.send({ reason: "CSM said hold off" });
		expect(res.status).toBe(200);
		expect(res.body.status).toBe("cancelled");
		const stored = await ledger.get(notify.id);
		expect(stored?.status).toBe("cancelled");
		expect(stored?.note).toBe("CSM said hold off");
		// Not due — listDue never returns cancelled entries.
		expect((await ledger.listDue(new Date(Date.now() + 7_200_000))).map((e) => e.id)).not.toContain(
			notify.id,
		);
	});

	it("POST /api/actions/:id/resolve records the CSM decision on an escalation", async () => {
		const esc = await seedEscalation();
		const res = await request(app)
			.post(`/api/actions/${esc.id}/resolve`)
			.send({ outcome: "Approved 10% discount" });
		expect(res.status).toBe(200);
		expect(res.body.status).toBe("resolved");
		const stored = await ledger.get(esc.id);
		expect(stored?.note).toBe("Approved 10% discount");
	});

	it("rejects cancel on an executed entry (invalid transition)", async () => {
		const notify = await seedNotify();
		await ledger.update(notify.id, { status: "executed", executedAt: new Date() });
		const res = await request(app).post(`/api/actions/${notify.id}/cancel`).send({ reason: "x" });
		expect(res.status).toBe(400);
		expect((await ledger.get(notify.id))?.status).toBe("executed");
	});

	it("rejects resolve on a non-escalation and on an already-resolved escalation", async () => {
		const notify = await seedNotify();
		const wrongBand = await request(app)
			.post(`/api/actions/${notify.id}/resolve`)
			.send({ outcome: "x" });
		expect(wrongBand.status).toBe(400);

		const esc = await seedEscalation();
		await request(app).post(`/api/actions/${esc.id}/resolve`).send({ outcome: "done" });
		const again = await request(app).post(`/api/actions/${esc.id}/resolve`).send({ outcome: "y" });
		expect(again.status).toBe(400);
	});

	it("404s on unknown action ids", async () => {
		const res = await request(app).post("/api/actions/does-not-exist/cancel").send({ reason: "x" });
		expect(res.status).toBe(404);
	});
});
