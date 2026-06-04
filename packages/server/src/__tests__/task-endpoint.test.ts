import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Express } from "express";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createApp } from "../app.js";

/**
 * Exercises the configured task surface end-to-end: TASK_SOURCE=stub wires the
 * in-memory queue, registers the task tools, and serves /api/tasks. The digest
 * is band-driven, so task actions count there with no extra wiring.
 */
describe("Task surface (TASK_SOURCE=stub)", () => {
	let app: Express;
	let shutdown: () => Promise<void>;
	let tmpDir: string;
	const prev: Record<string, string | undefined> = {};

	beforeAll(async () => {
		tmpDir = mkdtempSync(join(tmpdir(), "task-int-"));
		prev.DB_PATH = process.env.DB_PATH;
		prev.TASK_SOURCE = process.env.TASK_SOURCE;
		process.env.DB_PATH = join(tmpDir, "test.db");
		process.env.TASK_SOURCE = "stub";

		const handles = await createApp();
		app = handles.app;
		shutdown = handles.shutdown;
	});

	afterAll(async () => {
		await shutdown();
		for (const [k, v] of Object.entries(prev)) {
			if (v !== undefined) process.env[k] = v;
			else delete process.env[k];
		}
		rmSync(tmpDir, { recursive: true, force: true });
	});

	it("registers the task tools and the task-tools extension", async () => {
		const res = await request(app).get("/api/extensions");
		expect(res.body.loaded).toContain("task-tools");
		const names = res.body.tools.map((t: { name: string }) => t.name);
		expect(names).toContain("task_list_open");
		expect(names).toContain("task_get");
		expect(names).toContain("task_complete");
		expect(names).toContain("task_block");
	});

	it("GET /api/tasks reports the open queue with no outcomes yet", async () => {
		const res = await request(app).get("/api/tasks");
		expect(res.status).toBe(200);
		expect(res.body.configured).toBe(true);
		expect(res.body.label).toContain("stub");
		expect(res.body.open.length).toBeGreaterThan(0);
		for (const t of res.body.open) expect(t.latestAction).toBeNull();
	});

	it("completing a task is recorded, counted in the digest, and joined into /api/tasks", async () => {
		// drive the task_complete tool the way the agent would (via /mcp)
		const list = await request(app).get("/api/tasks");
		const taskId = list.body.open[0].id;

		const before = await request(app).get("/api/digest/counters");
		const beforeActs = before.body.counts.acts;

		const mcp = await request(app)
			.post("/mcp")
			.set("Accept", "application/json, text/event-stream")
			.send({
				jsonrpc: "2.0",
				id: 1,
				method: "tools/call",
				params: {
					name: "task_complete",
					arguments: { task_id: taskId, result: "done in test", band: "act" },
				},
			});
		expect(mcp.status).toBe(200);

		const after = await request(app).get("/api/digest/counters");
		expect(after.body.counts.acts).toBe(beforeActs + 1);

		const tasks = await request(app).get("/api/tasks");
		const completedStillOpen = tasks.body.open.find((t: { id: string }) => t.id === taskId);
		expect(completedStillOpen).toBeUndefined(); // dropped from open
		const outcome = tasks.body.recentOutcomes.find((o: { taskId: string }) => o.taskId === taskId);
		expect(outcome?.status).toBe("done");
	});
});
