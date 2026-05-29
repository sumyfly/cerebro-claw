import { describe, it, expect } from "vitest";
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
