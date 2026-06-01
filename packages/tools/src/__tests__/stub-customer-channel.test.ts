import { describe, expect, it } from "vitest";
import { StubCustomerChannel } from "../stub-customer-channel.js";

describe("StubCustomerChannel", () => {
	it("returns a deterministic delivery result and tracks sent records", async () => {
		const ch = new StubCustomerChannel();
		const res = await ch.send({
			customerId: "biz-1",
			recipient: "alice@acme.com",
			text: "Hi Alice",
		});
		expect(res.messageId).toBeDefined();
		expect(res.deliveredAt).toBeInstanceOf(Date);
		expect(ch.getSent()).toHaveLength(1);
		expect(ch.getSent()[0].recipient).toBe("alice@acme.com");
	});

	it("invokes onSend hook with the record", async () => {
		const seen: string[] = [];
		const ch = new StubCustomerChannel({ onSend: (r) => void seen.push(r.recipient) });
		await ch.send({ customerId: "b", recipient: "x@y", text: "hi" });
		await ch.send({ customerId: "b", recipient: "p@q", text: "hello" });
		expect(seen).toEqual(["x@y", "p@q"]);
	});
});

describe("StubCustomerChannel.call", () => {
	it("records a call intent and returns an id", async () => {
		const ch = new StubCustomerChannel();
		const res = await ch.call({
			customerId: "cust-1",
			recipient: "+15551234567",
			script: "Check in on the renewal.",
		});
		expect(res.callId).toBeTruthy();
		expect(res.placedAt).toBeInstanceOf(Date);
		const calls = ch.getCalls();
		expect(calls).toHaveLength(1);
		expect(calls[0].script).toBe("Check in on the renewal.");
		expect(calls[0].recipient).toBe("+15551234567");
	});
});
