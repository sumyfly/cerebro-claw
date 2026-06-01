import { describe, expect, it } from "vitest";
import { StubCsmChannel } from "../stub-csm-channel.js";

describe("StubCsmChannel", () => {
	it("captures sends and cards into an inbox", async () => {
		const ch = new StubCsmChannel();
		await ch.start(async () => null);
		await ch.send("csm-1", "Heads up: renewal call queued for Acme.");
		await ch.sendCard("csm-1", { kind: "escalation", customer: "Acme" });
		const inbox = ch.getInbox();
		expect(inbox).toHaveLength(2);
		expect(inbox[0]).toMatchObject({ kind: "text", recipientId: "csm-1" });
		expect(inbox[1]).toMatchObject({ kind: "card", recipientId: "csm-1" });
	});
});
