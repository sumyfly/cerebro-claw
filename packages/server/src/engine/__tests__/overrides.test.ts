import type { InstinctEntry, MemoryStore } from "@cerebro-claw/shared";
import { describe, expect, it } from "vitest";
import { parseOverrideBand, resolveOverrideFromStore } from "../overrides.js";

describe("parseOverrideBand", () => {
	it("returns null when no note carries an override directive", () => {
		expect(parseOverrideBand(["Mike is the decision maker", "prefers email"])).toBeNull();
	});

	it("parses a conversational override directive", () => {
		expect(parseOverrideBand(["override: escalate — VIP, CSM owns every touch"])).toBe("escalate");
	});

	it("parses the BAND= form", () => {
		expect(parseOverrideBand(["OVERRIDE BAND=notify-then-act: clear nudges with me"])).toBe(
			"notify-then-act",
		);
	});

	it("returns the strongest band when several notes carry overrides", () => {
		expect(
			parseOverrideBand([
				"override: notify-then-act for routine",
				"override: escalate anything about pricing",
			]),
		).toBe("escalate");
	});

	it("ignores the word 'override' without a band", () => {
		expect(parseOverrideBand(["do not override their config"])).toBeNull();
	});
});

describe("resolveOverrideFromStore", () => {
	function storeWith(contents: string[]): MemoryStore {
		const instincts: InstinctEntry[] = contents.map((content, i) => ({
			id: `i${i}`,
			customerId: "acme",
			content,
			source: "csm",
			createdAt: new Date(),
		}));
		return {
			getInstincts: async (cid: string) => (cid === "acme" ? instincts : []),
		} as unknown as MemoryStore;
	}

	it("resolves the forced band from the customer's instincts", async () => {
		const res = await resolveOverrideFromStore(storeWith(["override: escalate — VIP"]), "acme");
		expect(res).toEqual({ forcesBand: "escalate" });
	});

	it("returns null for a customer with no override note", async () => {
		const res = await resolveOverrideFromStore(storeWith(["likes monthly check-ins"]), "acme");
		expect(res).toBeNull();
	});
});
