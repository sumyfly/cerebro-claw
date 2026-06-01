import { describe, it, expect, beforeEach, vi } from "vitest";
import { InMemoryActionLedger, StubCustomerChannel } from "@cerebro-claw/memory";
import { NotifyThenActDispatcher } from "../dispatcher.js";

// InMemoryActionLedger lives in @cerebro-claw/memory, StubCustomerChannel in
// @cerebro-claw/tools. Vitest hoists imports but the test file is a unit so
// we resolve the right packages here explicitly.
import { StubCustomerChannel as Stub } from "@cerebro-claw/tools";
import type { ActionLedger, CustomerChannel } from "@cerebro-claw/shared";

describe("NotifyThenActDispatcher", () => {
	let ledger: ActionLedger;
	let channel: CustomerChannel;
	let now: Date;

	beforeEach(() => {
		ledger = new InMemoryActionLedger();
		channel = new Stub();
		now = new Date("2026-05-29T12:00:00Z");
	});

	it("dispatches a due notify-then-act, marks executed, records messageId", async () => {
		const entry = await ledger.record({
			band: "notify-then-act",
			customerId: "biz-1",
			customerName: "Acme",
			summary: "send",
			reason: "y",
			status: "in-flight",
			executeAt: new Date("2026-05-29T11:00:00Z"),
			payload: { recipient: "alice@acme.com", text: "Hi Alice" },
		});
		const d = new NotifyThenActDispatcher({
			ledger,
			customerChannel: channel,
			now: () => now,
		});
		const { dispatched, failed } = await d.tick();
		expect(dispatched).toBe(1);
		expect(failed).toBe(0);
		const updated = await ledger.get(entry.id);
		expect(updated?.status).toBe("executed");
		expect((updated?.payload as { messageId?: string }).messageId).toBeDefined();
	});

	it("does not dispatch entries whose executeAt is still in the future", async () => {
		await ledger.record({
			band: "notify-then-act",
			customerId: "biz-1",
			summary: "send",
			reason: "y",
			status: "in-flight",
			executeAt: new Date("2026-05-29T13:00:00Z"),
			payload: { recipient: "a", text: "x" },
		});
		const d = new NotifyThenActDispatcher({
			ledger,
			customerChannel: channel,
			now: () => now,
		});
		const { dispatched } = await d.tick();
		expect(dispatched).toBe(0);
	});

	it("marks entry failed when the customer channel throws", async () => {
		const failingChannel: CustomerChannel = {
			id: "failing",
			send: vi.fn().mockRejectedValue(new Error("smtp 550")),
		};
		const entry = await ledger.record({
			band: "notify-then-act",
			customerId: "biz-1",
			summary: "send",
			reason: "y",
			status: "in-flight",
			executeAt: new Date("2026-05-29T11:00:00Z"),
			payload: { recipient: "a@b.com", text: "x" },
		});
		const d = new NotifyThenActDispatcher({
			ledger,
			customerChannel: failingChannel,
			now: () => now,
		});
		const { dispatched, failed } = await d.tick();
		expect(dispatched).toBe(0);
		expect(failed).toBe(1);
		const updated = await ledger.get(entry.id);
		expect(updated?.status).toBe("failed");
		expect(updated?.note).toContain("smtp 550");
	});

	it("marks entry failed when payload is incomplete", async () => {
		const entry = await ledger.record({
			band: "notify-then-act",
			customerId: "biz-1",
			summary: "send",
			reason: "y",
			status: "in-flight",
			executeAt: new Date("2026-05-29T11:00:00Z"),
			payload: { recipient: "a@b.com" }, // text missing
		});
		const d = new NotifyThenActDispatcher({
			ledger,
			customerChannel: channel,
			now: () => now,
		});
		const { dispatched, failed } = await d.tick();
		expect(dispatched).toBe(0);
		expect(failed).toBe(1);
		const updated = await ledger.get(entry.id);
		expect(updated?.status).toBe("failed");
		expect(updated?.note).toMatch(/payload missing/);
	});

	it("does not double-fire when ticks overlap", async () => {
		// First tick will be in flight while we trigger the second.
		let sendCalls = 0;
		const slowChannel: CustomerChannel = {
			id: "slow",
			send: async () => {
				sendCalls += 1;
				await new Promise((r) => setTimeout(r, 20));
				return { messageId: "m", deliveredAt: new Date() };
			},
		};
		await ledger.record({
			band: "notify-then-act",
			customerId: "biz-1",
			summary: "send",
			reason: "y",
			status: "in-flight",
			executeAt: new Date("2026-05-29T11:00:00Z"),
			payload: { recipient: "a", text: "x" },
		});
		const d = new NotifyThenActDispatcher({
			ledger,
			customerChannel: slowChannel,
			now: () => now,
		});
		const [r1, r2] = await Promise.all([d.tick(), d.tick()]);
		expect(sendCalls).toBe(1);
		const dispatched = r1.dispatched + r2.dispatched;
		expect(dispatched).toBe(1);
	});

	it("dispatches a call-channel entry via channel.call()", async () => {
		const stub = new Stub();
		await ledger.record({
			band: "notify-then-act",
			customerId: "c1",
			summary: "renewal call",
			reason: "renewal in 20 days",
			status: "in-flight",
			executeAt: new Date("2026-05-29T11:00:00Z"),
			payload: { recipient: "+15551234567", message: "Hi", channel: "call" },
		});
		const d = new NotifyThenActDispatcher({
			ledger,
			customerChannel: stub,
			now: () => now,
		});
		const res = await d.tick();
		expect(res.dispatched).toBe(1);
		expect(stub.getCalls()).toHaveLength(1);
		expect(stub.getSent()).toHaveLength(0);
	});

	it("onDispatch hook fires for each entry", async () => {
		await ledger.record({
			band: "notify-then-act",
			customerId: "biz-1",
			summary: "ok",
			reason: "y",
			status: "in-flight",
			executeAt: new Date("2026-05-29T11:00:00Z"),
			payload: { recipient: "a", text: "x" },
		});
		const seen: string[] = [];
		const d = new NotifyThenActDispatcher({
			ledger,
			customerChannel: channel,
			now: () => now,
			onDispatch: (e, outcome) => void seen.push(`${e.summary}:${outcome}`),
		});
		await d.tick();
		expect(seen).toEqual(["ok:executed"]);
	});
});
