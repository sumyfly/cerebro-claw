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
		expect(inbox[0]).toMatchObject({
			kind: "text",
			recipientId: "csm-1",
			text: "Heads up: renewal call queued for Acme.",
		});
		expect(inbox[0].at).toBeInstanceOf(Date);
		expect(inbox[1]).toMatchObject({
			kind: "card",
			recipientId: "csm-1",
			card: { kind: "escalation", customer: "Acme" },
		});
	});

	it("routes inject() to the registered handler", async () => {
		const ch = new StubCsmChannel();
		const received: string[] = [];
		await ch.start(async (msg) => {
			received.push(msg.text);
			return "ack";
		});
		const reply = await ch.inject("csm-1", "Looks good, proceed.");
		expect(reply).toBe("ack");
		expect(received).toEqual(["Looks good, proceed."]);
	});

	it("clear() empties the inbox", async () => {
		const ch = new StubCsmChannel();
		await ch.send("csm-1", "hi");
		expect(ch.getInbox()).toHaveLength(1);
		ch.clear();
		expect(ch.getInbox()).toHaveLength(0);
	});
});
