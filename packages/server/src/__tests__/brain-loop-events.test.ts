import { InMemoryStore } from "@cerebro-claw/memory";
import { describe, expect, it, vi } from "vitest";
import { BrainLoop, type EventEmitter } from "../brain-loop.js";

describe("BrainLoop events", () => {
	it("emits brain_loop_cycle_start and brain_loop_cycle_end", async () => {
		const store = new InMemoryStore();
		await store.upsertProfile({
			id: "acme",
			companyName: "Acme",
			contacts: [],
			csmOwnerId: "sarah",
			createdAt: new Date(),
			updatedAt: new Date(),
		});

		const events: string[] = [];
		const emitter: EventEmitter = {
			async emit(event) {
				events.push(event);
			},
		};

		const mockAgent = {
			prompt: vi.fn().mockResolvedValue({ text: "ok", toolCalls: [] }),
		};

		const loop = new BrainLoop(store, mockAgent as any, 999_999, true, emitter);
		// Manually trigger one cycle without start() to avoid the interval
		await (loop as any).cycle();

		expect(events).toContain("brain_loop_cycle_start");
		expect(events).toContain("brain_loop_cycle_end");
	});

	it("works without an emitter (backward compatible)", async () => {
		const store = new InMemoryStore();
		const mockAgent = {
			prompt: vi.fn().mockResolvedValue({ text: "ok", toolCalls: [] }),
		};
		const loop = new BrainLoop(store, mockAgent as any, 999_999, true);
		await expect((loop as any).cycle()).resolves.toBeUndefined();
	});
});
