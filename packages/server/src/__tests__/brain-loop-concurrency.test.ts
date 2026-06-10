import { InMemoryStore } from "@cerebro-claw/memory";
import { describe, expect, it, vi } from "vitest";
import { type AccountSource, BrainLoop } from "../brain-loop.js";
import { mapWithConcurrency } from "../engine/concurrency.js";

function manyAccounts(n: number): AccountSource {
	return {
		label: "test",
		async list() {
			return Array.from({ length: n }, (_, i) => ({ id: `a${i}`, companyName: `Co${i}` }));
		},
		async buildSummary(_id, companyName) {
			return `Context for ${companyName}`;
		},
	};
}

/** Agent stub that records how many prompts are in flight at once. */
function trackingAgent(delayMs: number) {
	let active = 0;
	let peak = 0;
	const prompt = vi.fn(async () => {
		active += 1;
		peak = Math.max(peak, active);
		await new Promise((r) => setTimeout(r, delayMs));
		active -= 1;
		return { text: "done", toolCalls: [] };
	});
	return { prompt, peak: () => peak };
}

function loop(
	source: AccountSource,
	agent: { prompt: ReturnType<typeof vi.fn> },
	concurrency: number,
) {
	return new BrainLoop(
		new InMemoryStore(),
		agent as never,
		999_999,
		true,
		null,
		source,
		null,
		null,
		null,
		null,
		0,
		0,
		false,
		{},
		concurrency,
	);
}

describe("mapWithConcurrency", () => {
	it("preserves order and applies the error fallback", async () => {
		const out = await mapWithConcurrency(
			[1, 2, 3, 4],
			2,
			async (n) => {
				if (n === 3) throw new Error("boom");
				return n * 10;
			},
			() => -1,
		);
		expect(out).toEqual([10, 20, -1, 40]);
	});

	it("degrades a NaN limit to serial instead of spawning zero workers", async () => {
		// Math.max(1, NaN) is NaN and Array.from({length: NaN}) is [] — a
		// non-numeric env var must not silently no-op the whole sweep.
		const out = await mapWithConcurrency([1, 2, 3], Number("three"), async (n) => n * 2);
		expect(out).toEqual([2, 4, 6]);
	});
});

describe("BrainLoop sweep concurrency", () => {
	it("concurrency 3 runs at most 3 agent turns at once and completes all", async () => {
		const agent = trackingAgent(20);
		const res = await loop(manyAccounts(6), agent, 3).runOnce({ limit: 0 });
		expect(res).toMatchObject({ ran: true });
		expect(agent.prompt).toHaveBeenCalledTimes(6);
		expect(agent.peak()).toBeLessThanOrEqual(3);
		expect(agent.peak()).toBeGreaterThan(1); // genuinely parallel
	});

	it("concurrency 1 is strictly serial", async () => {
		const agent = trackingAgent(10);
		await loop(manyAccounts(4), agent, 1).runOnce({ limit: 0 });
		expect(agent.prompt).toHaveBeenCalledTimes(4);
		expect(agent.peak()).toBe(1);
	});
});
