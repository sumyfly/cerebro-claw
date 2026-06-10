import { InMemoryStore } from "@cerebro-claw/memory";
import type { Extension } from "@cerebro-claw/shared";
import { describe, expect, it } from "vitest";
import { ExtensionHost } from "../extension-host.js";

function host() {
	return new ExtensionHost({ store: new InMemoryStore(), config: {} });
}

describe("ExtensionHost — action policy as a registered set", () => {
	it("enumerates exactly the default four bands by default", () => {
		const ids = host()
			.getBands()
			.map((b) => b.id);
		expect(ids).toEqual(["act", "notify-then-act", "escalate", "prep"]);
	});

	it("lets an extension register an additional band without core edits", async () => {
		const h = host();
		const ext: Extension = {
			id: "observe-band",
			factory: (api) => {
				api.registerBand({
					id: "observe",
					description: "Observe-only.",
					toolName: "observe",
				});
			},
		};
		await h.load([ext]);
		const ids = h.getBands().map((b) => b.id);
		expect(ids).toContain("observe");
		// default four are still present and unchanged
		expect(ids.slice(0, 4)).toEqual(["act", "notify-then-act", "escalate", "prep"]);
	});

	it("ignores a duplicate band id", async () => {
		const h = host();
		await h.load([
			{
				id: "dup",
				factory: (api) => api.registerBand({ id: "act", description: "dupe", toolName: "act" }),
			},
		]);
		expect(h.getBands().filter((b) => b.id === "act")).toHaveLength(1);
	});
});
