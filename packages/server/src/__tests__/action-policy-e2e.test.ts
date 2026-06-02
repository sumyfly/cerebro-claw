import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { InMemoryActionLedger } from "@cerebro-claw/memory";
import { StubCustomerChannel, createActionPolicyTools } from "@cerebro-claw/tools";
import type { Express } from "express";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createApp } from "../app.js";
import { NotifyThenActDispatcher } from "../dispatcher.js";

/**
 * End-to-end check that the action-policy slice composes correctly:
 *   1. Agent calls `act` → ledger has an entry
 *   2. Agent calls `notify_then_send_to_customer` → ledger queues in-flight
 *      + CSM gets heads-up
 *   3. Dispatcher tick after pause window → send dispatches, ledger updates
 *      to executed, counters increment
 *
 * Uses real in-memory implementations of every piece (no mocks) so a
 * regression anywhere along the path fails this test.
 */
describe("Action policy end-to-end", () => {
	it("drives an act + notify through to the digest counters", async () => {
		const ledger = new InMemoryActionLedger();
		const channel = new StubCustomerChannel();
		const headsUps: string[] = [];

		const fixedNow = new Date("2026-05-29T08:00:00Z");
		const dispatcherNow = new Date("2026-05-29T08:31:00Z");
		const tools = createActionPolicyTools({
			ledger,
			customerChannel: channel,
			defaultCsmRecipientId: "csm:andrew",
			defaultPauseMinutes: 30,
			now: () => fixedNow,
			async sendToCsm(_recipient, text) {
				headsUps.push(text);
			},
		});
		const toolMap = new Map(tools.map((t) => [t.name, t]));

		// 1. The agent acts.
		await toolMap.get("act")!.execute({
			customer_id: "biz-1",
			customer_name: "Acme",
			summary: "Logged usage-drop note",
			reason: "Engagement down 35% vs last week",
		});

		// 2. The agent queues a notify-then-act.
		const notifyResult = await toolMap.get("notify_then_send_to_customer")!.execute({
			customer_id: "biz-1",
			customer_name: "Acme",
			recipient: "alice@acme.com",
			text: "Hi Alice — checking in on your usage this week.",
			reason: "30-day silence, healthy account",
		});
		expect(notifyResult.success).toBe(true);
		expect(headsUps).toHaveLength(1);
		expect(headsUps[0]).toContain("About to send to Acme");

		// 3. Dispatcher runs after the pause window.
		const dispatcher = new NotifyThenActDispatcher({
			ledger,
			customerChannel: channel,
			now: () => dispatcherNow,
		});
		const tick = await dispatcher.tick();
		expect(tick.dispatched).toBe(1);
		expect(channel.getSent()).toHaveLength(1);
		expect(channel.getSent()[0].recipient).toBe("alice@acme.com");

		// 4. The ledger reflects the full journey.
		const allInWindow = await ledger.listByWindow(
			new Date("2026-05-29T00:00:00Z"),
			new Date("2026-05-30T00:00:00Z"),
		);
		expect(allInWindow).toHaveLength(2);
		const byBand = new Map(allInWindow.map((e) => [e.band, e]));
		expect(byBand.get("act")?.status).toBe("done");
		expect(byBand.get("notify-then-act")?.status).toBe("executed");
		const open = await ledger.listOpen();
		expect(open).toHaveLength(0);
	});
});

describe("Action policy app integration: counters update after a tool runs", () => {
	let app: Express;
	let shutdown: () => Promise<void>;
	let tmpDir: string;
	let prevDbPath: string | undefined;
	let prevAnthropicKey: string | undefined;

	beforeAll(async () => {
		tmpDir = mkdtempSync(join(tmpdir(), "cc-e2e-"));
		prevDbPath = process.env.DB_PATH;
		prevAnthropicKey = process.env.ANTHROPIC_API_KEY;
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

	it("counters start at zero and headline matches the contract", async () => {
		const res = await request(app).get("/api/digest/counters");
		expect(res.status).toBe(200);
		expect(res.body.headline).toBe(
			"Yesterday: 0 acts, 0 notifies in-flight, 0 escalations need you.",
		);
		expect(res.body.counts.acts).toBe(0);
		expect(res.body.counts.notifies.inFlight).toBe(0);
		expect(res.body.counts.escalations.needsCsm).toBe(0);
		expect(res.body.counts.preps).toBe(0);
	});
});
