import { InMemoryStore } from "@cerebro-claw/memory";
import type { RenewalRecord } from "@cerebro-claw/shared";
import { StubRenewalSource } from "@cerebro-claw/tools";
import { describe, expect, it, vi } from "vitest";
import { BrainLoop, type CycleSummary } from "../brain-loop.js";

const renewals: RenewalRecord[] = [
	{ id: "R-high", businessId: "b1", atRisk: true, daysToRenewal: 5, arr: 50_000 },
	{ id: "R-mid", businessId: "b2", daysToRenewal: 60, arr: 10_000 },
	{ id: "R-low", businessId: "b3", daysToRenewal: 200, arr: 1_000 },
];

function loop(triageMax = 0) {
	const prompt = vi.fn(async () => ({ text: "done", toolCalls: [{ name: "act" }] }));
	const l = new BrainLoop(
		new InMemoryStore(),
		{ prompt } as never,
		999_999,
		true,
		null,
		undefined,
		null,
		null,
		new StubRenewalSource({ renewals }),
		null,
		triageMax,
		0,
	);
	return { l, prompt };
}

describe("BrainLoop.runOnce", () => {
	it("defaults to a fan-out cap of 3 per sweep when no limit is given", async () => {
		const { l, prompt } = loop();
		const res = (await l.runOnce()) as CycleSummary;
		expect(res.ran).toBe(true);
		// 3 renewals available, cap 3 → all 3 (boundary), 0 accounts, 0 tasks
		expect(res.renewals.evaluated).toBe(3);
		expect(res.limit).toBe(3);
		expect(prompt).toHaveBeenCalledTimes(3);
	});

	it("caps the sweep at the requested limit", async () => {
		const { l, prompt } = loop();
		const res = (await l.runOnce({ limit: 1 })) as CycleSummary;
		expect(res.renewals.evaluated).toBe(1);
		expect(res.renewals.available).toBe(3);
		expect(prompt).toHaveBeenCalledTimes(1);
		expect(prompt.mock.calls[0][0] as string).toContain("R-high");
	});

	it("limit=0 means no cap — works all subjects", async () => {
		const { l, prompt } = loop();
		const res = (await l.runOnce({ limit: 0 })) as CycleSummary;
		expect(res.limit).toBe(0);
		expect(res.renewals.evaluated).toBe(3);
		expect(prompt).toHaveBeenCalledTimes(3);
	});

	it("tallies actionsTaken from tool calls", async () => {
		const { l } = loop();
		const res = (await l.runOnce({ limit: 0 })) as CycleSummary;
		expect(res.actionsTaken).toBe(3); // one tool call per renewal
	});

	it("returns a busy marker when a cycle is already running", async () => {
		const { l } = loop();
		(l as unknown as { running: boolean }).running = true;
		const res = await l.runOnce();
		expect(res).toEqual({ ran: false, reason: "cycle already running" });
	});
});

describe("BrainLoop boot cycle gate", () => {
	function loopWithRunOnStart(runOnStart: boolean) {
		const prompt = vi.fn(async () => ({ text: "done", toolCalls: [] }));
		const l = new BrainLoop(
			new InMemoryStore(),
			{ prompt } as never,
			999_999,
			true,
			null,
			undefined,
			null,
			null,
			new StubRenewalSource({ renewals }),
			null,
			0,
			0,
			runOnStart,
		);
		return { l, prompt };
	}

	it("does NOT run a cycle on start when runOnStart is false", async () => {
		const { l, prompt } = loopWithRunOnStart(false);
		l.start();
		await new Promise((r) => setTimeout(r, 10));
		expect(prompt).not.toHaveBeenCalled();
		l.stop();
	});

	it("runs a cycle on start when runOnStart is true", async () => {
		const { l, prompt } = loopWithRunOnStart(true);
		l.start();
		await new Promise((r) => setTimeout(r, 10));
		expect(prompt).toHaveBeenCalledTimes(3);
		l.stop();
	});
});
