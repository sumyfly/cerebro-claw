import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Express } from "express";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createApp } from "../app.js";

describe("App integration", () => {
	let app: Express;
	let shutdown: () => Promise<void>;
	let tmpDir: string;
	let prevDbPath: string | undefined;
	let prevAnthropicKey: string | undefined;

	beforeAll(async () => {
		tmpDir = mkdtempSync(join(tmpdir(), "app-int-"));
		prevDbPath = process.env.DB_PATH;
		prevAnthropicKey = process.env.ANTHROPIC_API_KEY;
		// Use an isolated DB and an obviously-fake key so we don't hit the network.
		process.env.DB_PATH = join(tmpDir, "test.db");
		process.env.ANTHROPIC_API_KEY = "fake-key-for-tests";

		const handles = await createApp();
		app = handles.app;
		shutdown = handles.shutdown;
	});

	afterAll(async () => {
		await shutdown();
		if (prevDbPath !== undefined) process.env.DB_PATH = prevDbPath;
		else delete process.env.DB_PATH;
		if (prevAnthropicKey !== undefined) process.env.ANTHROPIC_API_KEY = prevAnthropicKey;
		else delete process.env.ANTHROPIC_API_KEY;
		rmSync(tmpDir, { recursive: true, force: true });
	});

	it("GET /health returns status and extension info", async () => {
		const res = await request(app).get("/health");
		expect(res.status).toBe(200);
		expect(res.body.status).toBe("ok");
		expect(Array.isArray(res.body.extensions)).toBe(true);
		expect(res.body.tools).toContain("memory_read");
		expect(res.body.tools).toContain("draft_message");
		expect(res.body.tools).toContain("bash");
	});

	it("attaches X-Request-Id to responses", async () => {
		const res = await request(app).get("/health");
		expect(res.headers["x-request-id"]).toBeDefined();
	});

	it("respects incoming X-Request-Id", async () => {
		const res = await request(app).get("/health").set("X-Request-Id", "external-trace-1");
		expect(res.headers["x-request-id"]).toBe("external-trace-1");
	});

	it("GET /api/customers returns an array", async () => {
		const res = await request(app).get("/api/customers");
		expect(res.status).toBe(200);
		expect(Array.isArray(res.body)).toBe(true);
	});

	it("creates and retrieves a customer", async () => {
		const create = await request(app).post("/api/customers").send({
			id: "test-co",
			companyName: "Test Co",
			plan: "Growth",
			contacts: [],
			csmOwnerId: "sarah",
		});
		expect(create.status).toBe(201);

		const get = await request(app).get("/api/customers/test-co");
		expect(get.status).toBe(200);
		expect(get.body.profile.companyName).toBe("Test Co");
		expect(get.body.state).toBeDefined();
		expect(Array.isArray(get.body.history)).toBe(true);
		expect(Array.isArray(get.body.instincts)).toBe(true);
	});

	it("returns 404 for an unknown customer", async () => {
		const res = await request(app).get("/api/customers/does-not-exist");
		expect(res.status).toBe(404);
	});

	it("returns JSON 404 for unknown routes", async () => {
		const res = await request(app).get("/api/totally-unknown");
		expect(res.status).toBe(404);
		expect(res.body.error).toContain("No route");
		expect(res.body.requestId).toBeDefined();
	});

	it("approves and rejects pending actions", async () => {
		const approve = await request(app).post("/api/actions/nonexistent/approve").send({});
		expect(approve.status).toBe(404);

		const reject = await request(app).post("/api/actions/nonexistent/reject").send({});
		expect(reject.status).toBe(404);
	});

	it("exposes /api/extensions with loaded extensions and tools", async () => {
		const res = await request(app).get("/api/extensions");
		expect(res.status).toBe(200);
		expect(res.body.loaded).toContain("memory-tools");
		expect(res.body.loaded).toContain("message-tools");
		expect(res.body.channels).toContain("lark");
		expect(res.body.tools.length).toBeGreaterThan(0);
	});

	it("diagnostics endpoint runs all checks", async () => {
		const res = await request(app).get("/api/diagnostics");
		expect(res.status).toBe(200);
		expect(res.body.database).toBeDefined();
		expect(res.body.runtime).toBeDefined();
		expect(res.body.lark).toBeDefined();
	});

	it("exposes the four action-policy tools through /api/extensions", async () => {
		const res = await request(app).get("/api/extensions");
		const toolNames = res.body.tools.map((t: { name: string }) => t.name);
		expect(toolNames).toContain("act");
		expect(toolNames).toContain("notify_then_send_to_customer");
		expect(toolNames).toContain("escalate");
		expect(toolNames).toContain("prep");
		expect(toolNames).toContain("cancel_pending_action");
		expect(toolNames).toContain("resolve_escalation");
	});

	it("GET /api/digest/counters returns the three-numbers headline", async () => {
		const res = await request(app).get("/api/digest/counters");
		expect(res.status).toBe(200);
		expect(res.body.headline).toMatch(
			/Yesterday: \d+ acts, \d+ notifies in-flight, \d+ escalations need you\./,
		);
		expect(res.body.counts.acts).toBeGreaterThanOrEqual(0);
		expect(res.body.counts.notifies).toBeDefined();
		expect(res.body.counts.escalations).toBeDefined();
		expect(res.body.counts.preps).toBeGreaterThanOrEqual(0);
	});

	it("GET /api/ledger lists entries in a window", async () => {
		const res = await request(app).get("/api/ledger");
		expect(res.status).toBe(200);
		expect(res.body.since).toBeDefined();
		expect(res.body.until).toBeDefined();
		expect(Array.isArray(res.body.entries)).toBe(true);
	});

	it("GET /api/ledger/open returns currently open entries", async () => {
		const res = await request(app).get("/api/ledger/open");
		expect(res.status).toBe(200);
		expect(Array.isArray(res.body)).toBe(true);
	});

	it("POST /api/ledger/:id/cancel rejects unknown ids", async () => {
		const res = await request(app).post("/api/ledger/unknown-id/cancel").send({ reason: "test" });
		expect(res.status).toBe(404);
	});

	it("POST /api/ledger/:id/resolve rejects unknown ids", async () => {
		const res = await request(app).post("/api/ledger/unknown-id/resolve").send({ outcome: "test" });
		expect(res.status).toBe(404);
	});
});
