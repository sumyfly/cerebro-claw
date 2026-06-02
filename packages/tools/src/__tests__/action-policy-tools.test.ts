import { InMemoryActionLedger } from "@cerebro-claw/memory";
import type { ToolDefinition } from "@cerebro-claw/shared";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createActionPolicyTools } from "../action-policy-tools.js";
import { StubCustomerChannel } from "../stub-customer-channel.js";

function asMap(tools: ToolDefinition[]): Map<string, ToolDefinition> {
	return new Map(tools.map((t) => [t.name, t]));
}

describe("action-policy tools", () => {
	let ledger: InMemoryActionLedger;
	let channel: StubCustomerChannel;
	let sendToCsm: ReturnType<typeof vi.fn>;
	let tools: Map<string, ToolDefinition>;
	let fixedNow: Date;

	beforeEach(() => {
		ledger = new InMemoryActionLedger();
		channel = new StubCustomerChannel();
		sendToCsm = vi.fn().mockResolvedValue(undefined);
		fixedNow = new Date("2026-05-29T08:00:00Z");
		tools = asMap(
			createActionPolicyTools({
				ledger,
				customerChannel: channel,
				sendToCsm,
				defaultCsmRecipientId: "csm:andrew",
				defaultPauseMinutes: 60,
				now: () => fixedNow,
			}),
		);
	});

	it("registers all six tools", () => {
		expect([...tools.keys()].sort()).toEqual(
			[
				"act",
				"cancel_pending_action",
				"escalate",
				"notify_then_send_to_customer",
				"prep",
				"resolve_escalation",
			].sort(),
		);
	});

	describe("act", () => {
		it("records a done entry without notifying the CSM", async () => {
			const res = await tools.get("act")!.execute({
				customer_id: "biz-1",
				customer_name: "Acme",
				summary: "Created CSP note about usage drop",
				reason: "Engagement down 35%",
			});
			expect(res.success).toBe(true);
			const open = await ledger.listOpen();
			expect(open).toHaveLength(0);
			const window = await ledger.listByWindow(
				new Date("2026-05-29T00:00:00Z"),
				new Date("2026-05-30T00:00:00Z"),
			);
			expect(window).toHaveLength(1);
			expect(window[0].band).toBe("act");
			expect(window[0].status).toBe("done");
			expect(sendToCsm).not.toHaveBeenCalled();
		});
	});

	describe("notify_then_send_to_customer", () => {
		it("notifies CSM, queues in-flight entry, computes executeAt from pause window", async () => {
			const res = await tools.get("notify_then_send_to_customer")!.execute({
				customer_id: "biz-1",
				customer_name: "Acme",
				recipient: "alice@acme.com",
				text: "Quick check-in about your recent usage.",
				reason: "30d silent",
				pause_minutes: 30,
			});
			expect(res.success).toBe(true);
			expect(sendToCsm).toHaveBeenCalledOnce();
			const [recipient, body] = sendToCsm.mock.calls[0];
			expect(recipient).toBe("csm:andrew");
			expect(body).toContain("About to send to Acme");
			expect(body).toContain("30m");
			expect(body).toContain("Cancel with: cancel_pending_action");

			const open = await ledger.listOpen();
			expect(open).toHaveLength(1);
			expect(open[0].band).toBe("notify-then-act");
			expect(open[0].executeAt?.toISOString()).toBe("2026-05-29T08:30:00.000Z");
			expect(open[0].payload).toMatchObject({
				recipient: "alice@acme.com",
				text: "Quick check-in about your recent usage.",
			});
		});

		it("uses defaultPauseMinutes when pause_minutes is not provided", async () => {
			await tools.get("notify_then_send_to_customer")!.execute({
				customer_id: "biz-1",
				recipient: "alice@acme.com",
				text: "x",
				reason: "y",
			});
			const open = await ledger.listOpen();
			// 60 minute default in test
			expect(open[0].executeAt?.toISOString()).toBe("2026-05-29T09:00:00.000Z");
		});

		it("clamps pause to [1, 1440]", async () => {
			await tools.get("notify_then_send_to_customer")!.execute({
				customer_id: "biz-1",
				recipient: "a",
				text: "x",
				reason: "y",
				pause_minutes: 99999,
			});
			const open = await ledger.listOpen();
			// 1440 minutes (24h) cap
			expect(open[0].executeAt?.toISOString()).toBe("2026-05-30T08:00:00.000Z");
		});

		it("marks entry failed when the CSM heads-up throws", async () => {
			sendToCsm.mockRejectedValueOnce(new Error("Lark down"));
			await expect(
				tools.get("notify_then_send_to_customer")!.execute({
					customer_id: "biz-1",
					recipient: "alice@acme.com",
					text: "hi",
					reason: "y",
				}),
			).rejects.toThrow("Lark down");
			const window = await ledger.listByWindow(
				new Date("2026-05-29T00:00:00Z"),
				new Date("2026-05-30T00:00:00Z"),
			);
			expect(window).toHaveLength(1);
			expect(window[0].status).toBe("failed");
			expect(window[0].note).toContain("Lark down");
		});

		it("falls back to the stub CSM recipient when none is configured (graceful degrade)", async () => {
			const noCsm = asMap(
				createActionPolicyTools({
					ledger,
					customerChannel: channel,
					sendToCsm,
					now: () => fixedNow,
				}),
			);
			const res = await noCsm.get("notify_then_send_to_customer")!.execute({
				customer_id: "biz-1",
				recipient: "alice@acme.com",
				text: "hi",
				reason: "y",
			});
			expect(res.success).toBe(true);
			expect(sendToCsm).toHaveBeenCalledWith("stub-csm", expect.any(String));
			const open = await ledger.listOpen();
			expect(open).toHaveLength(1);
			expect(open[0].status).toBe("in-flight");
		});
	});

	describe("escalate", () => {
		it("delivers a structured brief and records needs-csm entry", async () => {
			await tools.get("escalate")!.execute({
				customer_id: "biz-1",
				customer_name: "Acme",
				situation: "Renewal in 7d, health red, no exec sponsor",
				options: "1. Discount 10%\n2. Pause + executive escalation\n3. Let it churn",
				recommendation: "Option 2 — exec sponsor missing, discount won't fix relationship",
				urgency: "Contract expires 2026-06-05",
			});
			expect(sendToCsm).toHaveBeenCalledOnce();
			const brief = sendToCsm.mock.calls[0][1];
			expect(brief).toContain("Escalation: Acme");
			expect(brief).toContain("Situation:");
			expect(brief).toContain("Options:");
			expect(brief).toContain("Recommendation:");
			expect(brief).toContain("Urgency:");

			const open = await ledger.listOpen();
			expect(open).toHaveLength(1);
			expect(open[0].band).toBe("escalate");
			expect(open[0].status).toBe("needs-csm");
		});
	});

	describe("prep", () => {
		it("delivers an artifact and records done", async () => {
			await tools.get("prep")!.execute({
				customer_id: "biz-1",
				customer_name: "Acme",
				artifact_type: "Pre-call brief",
				body: "Talking points: ...",
			});
			expect(sendToCsm).toHaveBeenCalledOnce();
			expect(sendToCsm.mock.calls[0][1]).toContain("Pre-call brief");
			expect(sendToCsm.mock.calls[0][1]).toContain("Acme");
			const window = await ledger.listByWindow(
				new Date("2026-05-29T00:00:00Z"),
				new Date("2026-05-30T00:00:00Z"),
			);
			expect(window).toHaveLength(1);
			expect(window[0].band).toBe("prep");
			expect(window[0].status).toBe("done");
		});
	});

	describe("cancel_pending_action", () => {
		it("flips a notify-then-act entry to cancelled", async () => {
			const created = await tools.get("notify_then_send_to_customer")!.execute({
				customer_id: "biz-1",
				recipient: "a@b.com",
				text: "x",
				reason: "y",
			});
			const id = created.details!.actionId as string;
			const res = await tools.get("cancel_pending_action")!.execute({
				action_id: id,
				reason: "Customer self-served",
			});
			expect(res.success).toBe(true);
			const entry = await ledger.get(id);
			expect(entry?.status).toBe("cancelled");
			expect(entry?.note).toBe("Customer self-served");
		});

		it("refuses to cancel an act", async () => {
			const created = await tools.get("act")!.execute({
				customer_id: "biz-1",
				summary: "did x",
				reason: "y",
			});
			const id = created.details!.actionId as string;
			const res = await tools.get("cancel_pending_action")!.execute({
				action_id: id,
				reason: "z",
			});
			expect(res.success).toBe(false);
			expect(res.content).toMatch(/already happened/);
		});

		it("returns failure for unknown id", async () => {
			const res = await tools.get("cancel_pending_action")!.execute({
				action_id: "missing",
				reason: "z",
			});
			expect(res.success).toBe(false);
		});
	});

	describe("resolve_escalation", () => {
		it("flips a needs-csm entry to resolved with outcome note", async () => {
			const created = await tools.get("escalate")!.execute({
				customer_id: "biz-1",
				situation: "x",
				options: "1. y",
				recommendation: "z",
			});
			const id = created.details!.actionId as string;
			const res = await tools.get("resolve_escalation")!.execute({
				action_id: id,
				outcome: "CSM approved 10% discount",
			});
			expect(res.success).toBe(true);
			const entry = await ledger.get(id);
			expect(entry?.status).toBe("resolved");
			expect(entry?.note).toBe("CSM approved 10% discount");
		});
	});

	describe("override hard gate", () => {
		function toolsWithOverride(forcedFor: Record<string, string>) {
			return asMap(
				createActionPolicyTools({
					ledger,
					customerChannel: channel,
					sendToCsm,
					defaultCsmRecipientId: "csm:andrew",
					now: () => fixedNow,
					resolveOverride: (customerId) =>
						forcedFor[customerId] ? { forcesBand: forcedFor[customerId] } : null,
				}),
			);
		}

		it("blocks act on an account whose override forces escalate", async () => {
			const t = toolsWithOverride({ acme: "escalate" });
			const res = await t.get("act")!.execute({
				customer_id: "acme",
				summary: "logged a note",
				reason: "usage dip",
			});
			expect(res.success).toBe(false);
			expect(res.content).toContain('requires the "escalate" band');
			expect(res.details?.requiredBand).toBe("escalate");
			// Nothing was written to the ledger.
			expect((await ledger.listByWindow(new Date(0), fixedNow)).length).toBe(0);
		});

		it("blocks notify-then-act on a forced-escalate account", async () => {
			const t = toolsWithOverride({ acme: "escalate" });
			const res = await t.get("notify_then_send_to_customer")!.execute({
				customer_id: "acme",
				recipient: "a@acme.com",
				text: "hi",
				reason: "routine touch",
			});
			expect(res.success).toBe(false);
			expect(res.details?.requiredBand).toBe("escalate");
			expect(channel.getSent()).toHaveLength(0);
		});

		it("does NOT block prep — a CSM-facing artifact is exempt from the override gate", async () => {
			const t = toolsWithOverride({ acme: "escalate" });
			const res = await t.get("prep")!.execute({
				customer_id: "acme",
				artifact_type: "renewal brief",
				body: "...",
			});
			expect(res.success).toBe(true);
		});

		it("still ALLOWS escalate on a forced-escalate account", async () => {
			const t = toolsWithOverride({ acme: "escalate" });
			const res = await t.get("escalate")!.execute({
				customer_id: "acme",
				situation: "churn risk",
				options: "1) save 2) let go",
				recommendation: "save",
			});
			expect(res.success).toBe(true);
		});

		it("does NOT block a customer with no override", async () => {
			const t = toolsWithOverride({ acme: "escalate" });
			const res = await t.get("act")!.execute({
				customer_id: "globex",
				summary: "logged a note",
				reason: "fyi",
			});
			expect(res.success).toBe(true);
		});

		it("does not block when the override forces a band <= the attempted band", async () => {
			// An override forcing 'act' should not block an 'act'.
			const t = toolsWithOverride({ acme: "act" });
			const res = await t.get("act")!.execute({
				customer_id: "acme",
				summary: "note",
				reason: "fyi",
			});
			expect(res.success).toBe(true);
		});
	});
});
