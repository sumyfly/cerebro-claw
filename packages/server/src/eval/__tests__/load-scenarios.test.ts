import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { loadScenarios } from "../load-scenarios.js";

const badFixturesDir = fileURLToPath(new URL("fixtures-bad", import.meta.url));

describe("loadScenarios", () => {
	it("loads and validates fixtures from the scenarios dir", async () => {
		const scenarios = await loadScenarios();
		expect(scenarios.length).toBeGreaterThan(0);
		for (const s of scenarios) {
			expect(s.id).toBeTruthy();
			expect(["act", "notify-then-act", "escalate", "prep", "none"]).toContain(s.expect.band);
		}
	});

	it("throws on a scenario with an invalid band", async () => {
		await expect(loadScenarios(badFixturesDir)).rejects.toThrow(/invalid expect.band/);
	});
});
