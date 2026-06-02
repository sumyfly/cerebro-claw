import { InMemoryActionLedger } from "@cerebro-claw/memory";
import type { ToolDefinition } from "@cerebro-claw/shared";
import { StubCustomerChannel } from "@cerebro-claw/tools";
import { createActionPolicyTools } from "@cerebro-claw/tools";
import { describe, expect, it, vi } from "vitest";
import { computeDigestCounts } from "../digest.js";

/**
 * End-to-end of the human-in-the-loop CSM decision cycle — the product's bright
 * line: the agent escalates / queues, the CSM decides, and the daily digest
 * reflects each transition. Proves the loop, not just the individual tools.
 */
function tools(ledger: InMemoryActionLedger, now: () => Date) {
	const map = new Map<string, ToolDefinition>(
		createActionPolicyTools({
			ledger,
			customerChannel: new StubCustomerChannel(),
			sendToCsm: vi.fn().mockResolvedValue(undefined),
			defaultCsmRecipientId: "csm",
			now,
		}).map((t) => [t.name, t]),
	);
	return map;
}

describe("CSM decision lifecycle → digest", () => {
	const NOW = new Date("2026-06-02T12:00:00Z");

	it("escalate → CSM resolves: moves out of 'needs you' in the digest", async () => {
		const ledger = new InMemoryActionLedger();
		const t = tools(ledger, () => NOW);

		const res = await t.get("escalate")!.execute({
			customer_id: "acme",
			customer_name: "Acme",
			situation: "Renewal at risk",
			options: "1) discount 2) exec save",
			recommendation: "exec save",
		});
		const id = res.details!.actionId as string;

		let counts = await computeDigestCounts(ledger, NOW);
		expect(counts.escalations.needsCsm).toBe(1);

		// CSM decided — agent records the outcome.
		await t.get("resolve_escalation")!.execute({ action_id: id, outcome: "CSM chose exec save" });

		counts = await computeDigestCounts(ledger, NOW);
		expect(counts.escalations.needsCsm).toBe(0);
		expect(counts.escalations.resolved).toBe(1);
	});

	it("notify → CSM cancels: drops out of 'in-flight' in the digest", async () => {
		const ledger = new InMemoryActionLedger();
		const t = tools(ledger, () => NOW);

		const res = await t.get("notify_then_send_to_customer")!.execute({
			customer_id: "globex",
			recipient: "x@globex.com",
			text: "Quick check-in",
			reason: "30d silent",
		});
		const id = res.details!.actionId as string;

		let counts = await computeDigestCounts(ledger, NOW);
		expect(counts.notifies.inFlight).toBe(1);

		// CSM disagreed and cancelled before the pause window elapsed.
		await t
			.get("cancel_pending_action")!
			.execute({ action_id: id, reason: "CSM handling personally" });

		counts = await computeDigestCounts(ledger, NOW);
		expect(counts.notifies.inFlight).toBe(0);
		expect(counts.notifies.cancelled).toBe(1);
	});
});
