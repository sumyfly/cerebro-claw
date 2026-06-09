import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Express } from "express";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createApp } from "../app.js";

/**
 * POST /api/brain/cycle runs one cycle on demand. With no sources configured the
 * cycle is a no-op but still returns a well-formed summary — enough to verify the
 * route, the limit parsing, and the response shape without spawning a real agent.
 */
describe("POST /api/brain/cycle", () => {
	let app: Express;
	let shutdown: () => Promise<void>;
	let tmpDir: string;
	const prev: Record<string, string | undefined> = {};

	beforeAll(async () => {
		tmpDir = mkdtempSync(join(tmpdir(), "brain-cycle-"));
		prev.DB_PATH = process.env.DB_PATH;
		prev.BRAIN_LOOP_ENABLED = process.env.BRAIN_LOOP_ENABLED;
		process.env.DB_PATH = join(tmpDir, "test.db");
		process.env.BRAIN_LOOP_ENABLED = "false"; // no interval timer during the test

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

	it("returns a cycle summary with the default cap of 3", async () => {
		const res = await request(app).post("/api/brain/cycle");
		expect(res.status).toBe(200);
		expect(res.body.ran).toBe(true);
		expect(res.body.limit).toBe(3);
		expect(res.body).toHaveProperty("accounts.evaluated");
		expect(res.body).toHaveProperty("actionsTaken");
		expect(res.body).toHaveProperty("durationMs");
	});

	it("parses ?limit=0 as no cap", async () => {
		const res = await request(app).post("/api/brain/cycle?limit=0");
		expect(res.status).toBe(200);
		expect(res.body.limit).toBe(0);
	});

	it("treats a non-numeric limit as omitted (default cap 3)", async () => {
		const res = await request(app).post("/api/brain/cycle?limit=abc");
		expect(res.status).toBe(200);
		expect(res.body.limit).toBe(3);
	});
});
