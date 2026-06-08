import { InMemoryStore } from "@cerebro-claw/memory";
import type { RenewalRecord } from "@cerebro-claw/shared";
import { StubRenewalSource } from "@cerebro-claw/tools";
import { describe, expect, it, vi } from "vitest";
import { BrainLoop } from "../brain-loop.js";

const renewals: RenewalRecord[] = [
	{ id: "R-high", businessId: "b1", atRisk: true, daysToRenewal: 5, arr: 50_000 },
	{ id: "R-mid", businessId: "b2", daysToRenewal: 60, arr: 10_000 },
	{ id: "R-low", businessId: "b3", daysToRenewal: 200, arr: 1_000 },
];

function loop(triageMax: number) {
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
		triageMax,
		0,
	);
	return { l, prompt };
}

describe("BrainLoop renewal triage", () => {
	it("with triageMax=1, works only the highest-scored renewal", async () => {
		const { l, prompt } = loop(1);
		await (l as unknown as { cycle(): Promise<void> }).cycle();
		expect(prompt).toHaveBeenCalledTimes(1);
		expect(prompt.mock.calls[0][0] as string).toContain("R-high");
	});

	it("with triage disabled (max=0), works all renewals", async () => {
		const { l, prompt } = loop(0);
		await (l as unknown as { cycle(): Promise<void> }).cycle();
		expect(prompt).toHaveBeenCalledTimes(3);
	});
});
