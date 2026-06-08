import { InMemoryActionLedger } from "@cerebro-claw/memory";
import type { ToolDefinition, VerificationResult } from "@cerebro-claw/shared";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createActionPolicyTools } from "../action-policy-tools.js";
import { createNoopVerifier } from "../noop-verifier.js";
import { StubCustomerChannel } from "../stub-customer-channel.js";

const NOW = new Date("2026-06-08T08:00:00Z");

function build(verify?: (i: unknown) => Promise<VerificationResult>) {
	const ledger = new InMemoryActionLedger();
	const sendToCsm = vi.fn().mockResolvedValue(undefined);
	const tools = new Map(
		createActionPolicyTools({
			ledger,
			customerChannel: new StubCustomerChannel(),
			sendToCsm,
			defaultCsmRecipientId: "csm:andrew",
			now: () => NOW,
			verify: verify as never,
		}).map((t) => [t.name, t] as [string, ToolDefinition]),
	);
	return { ledger, sendToCsm, tools };
}

const win = () => [new Date(0), new Date(NOW.getTime() + 1000)] as const;

describe("noop verifier", () => {
	it("always passes", async () => {
		const r = await createNoopVerifier().verify({
			band: "escalate",
			customerId: "b1",
			summary: "s",
			reason: "r",
		});
		expect(r.pass).toBe(true);
	});
});

describe("action-policy verifier gate", () => {
	it("blocks a notify when the critic fails — no send scheduled, failed entry recorded", async () => {
		const verify = vi.fn(async () => ({ pass: false, reason: "thin justification" }));
		const { ledger, sendToCsm, tools } = build(verify);

		const res = await tools.get("notify_then_send_to_customer")!.execute({
			customer_id: "b1",
			customer_name: "Acme",
			recipient: "a@b.com",
			text: "hi",
			reason: "just because",
		});

		expect(res.success).toBe(false);
		expect(res.details?.blockedBy).toBe("verifier");
		expect(sendToCsm).not.toHaveBeenCalled(); // no heads-up / no schedule
		const entries = await ledger.listByWindow(...win());
		expect(entries).toHaveLength(1);
		expect(entries[0].status).toBe("failed");
		expect(entries[0].note).toContain("thin justification");
	});

	it("blocks an escalate when the critic fails", async () => {
		const verify = vi.fn(async () => ({ pass: false, reason: "not warranted" }));
		const { ledger, tools } = build(verify);
		const res = await tools.get("escalate")!.execute({
			customer_id: "b1",
			situation: "minor blip",
			options: "1. wait",
			recommendation: "wait",
		});
		expect(res.success).toBe(false);
		const entries = await ledger.listByWindow(...win());
		expect(entries[0].status).toBe("failed");
	});

	it("does NOT gate act or prep", async () => {
		const verify = vi.fn(async () => ({ pass: false, reason: "should not be called" }));
		const { tools } = build(verify);
		const act = await tools.get("act")!.execute({
			customer_id: "b1",
			summary: "logged a note",
			reason: "ok",
		});
		expect(act.success).toBe(true);
		expect(verify).not.toHaveBeenCalled();
	});

	it("lets the action proceed when the critic passes", async () => {
		const verify = vi.fn(async () => ({ pass: true, reason: "ok" }));
		const { ledger, sendToCsm, tools } = build(verify);
		const res = await tools.get("notify_then_send_to_customer")!.execute({
			customer_id: "b1",
			recipient: "a@b.com",
			text: "hi",
			reason: "renewal 30d out, usage down",
		});
		expect(res.success).toBe(true);
		expect(sendToCsm).toHaveBeenCalledTimes(1); // heads-up sent, pause window begins
		const entries = await ledger.listByWindow(...win());
		expect(entries[0].status).toBe("in-flight");
	});

	it("override gate runs before the verifier", async () => {
		const verify = vi.fn(async () => ({ pass: false, reason: "x" }));
		const ledger = new InMemoryActionLedger();
		const tools = new Map(
			createActionPolicyTools({
				ledger,
				customerChannel: new StubCustomerChannel(),
				sendToCsm: vi.fn().mockResolvedValue(undefined),
				now: () => NOW,
				verify: verify as never,
				// Account forced to escalate-only → notify is blocked by the override gate.
				resolveOverride: () => ({ forcesBand: "escalate" }),
			}).map((t) => [t.name, t] as [string, ToolDefinition]),
		);
		const res = await tools.get("notify_then_send_to_customer")!.execute({
			customer_id: "b1",
			recipient: "a@b.com",
			text: "hi",
			reason: "r",
		});
		expect(res.success).toBe(false);
		expect(res.details?.blockedBy).toBe("override");
		expect(verify).not.toHaveBeenCalled(); // override short-circuits before verify
	});

	it("with no verifier, everything proceeds (disabled path)", async () => {
		const { tools, sendToCsm } = build(undefined);
		const res = await tools.get("notify_then_send_to_customer")!.execute({
			customer_id: "b1",
			recipient: "a@b.com",
			text: "hi",
			reason: "r",
		});
		expect(res.success).toBe(true);
		expect(sendToCsm).toHaveBeenCalledTimes(1);
	});
});
