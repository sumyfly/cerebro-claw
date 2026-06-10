import { InMemoryActionLedger, InMemoryStore } from "@cerebro-claw/memory";
import type { ToolDefinition } from "@cerebro-claw/shared";
import {
	StubCustomerChannel,
	StubTaskSource,
	createActionPolicyTools,
	createTaskTools,
} from "@cerebro-claw/tools";
import { describe, expect, it, vi } from "vitest";
import { BrainLoop } from "../brain-loop.js";

const NOW = new Date("2026-06-04T08:00:00Z");

/**
 * A scripted agent that stands in for the Claude Code subprocess: it inspects
 * the per-task prompt (keying off the specific task id, since the shared
 * TASK_GUIDANCE text mentions every band) and calls the same tools the real
 * LLM would call over MCP — so the test exercises the full loop → tools →
 * ledger plumbing.
 */
function scriptedAgent(tools: Map<string, ToolDefinition>) {
	const calls: string[] = [];
	async function run(name: string, params: Record<string, unknown>) {
		calls.push(name);
		return tools.get(name)?.execute(params);
	}
	const prompt = vi.fn(async (text: string) => {
		const before = calls.length;
		if (text.includes("task-discount-3")) {
			// High-stakes commercial → escalate, then block the task (CSM owns it).
			await run("escalate", {
				customer_id: "2123456789abcdef01234567",
				customer_name: "Acme Bistro",
				situation: "Customer wants 20% off to renew.",
				options: "1. Approve 2. Counter 3. Hold",
				recommendation: "Counter at 10%.",
			});
			await run("task_block", {
				task_id: "task-discount-3",
				reason: "Needs CSM decision on discount.",
			});
		} else if (text.includes("task-renewal-nudge-1")) {
			// Routine customer touch → notify-then-act, then complete the task.
			await run("notify_then_send_to_customer", {
				customer_id: "0123456789abcdef01234567",
				customer_name: "StorehubPay",
				recipient: "ap@storehubpay.com",
				text: "Quick heads-up your renewal is coming up — anything you need from us?",
				reason: "Renewal 30d out, normal health.",
			});
			await run("task_complete", {
				task_id: "task-renewal-nudge-1",
				result: "Renewal nudge queued",
				band: "notify-then-act",
			});
		} else if (text.includes("task-checkin-2")) {
			// Routine, low-stakes → act, then complete.
			await run("act", {
				customer_id: "1123456789abcdef01234567",
				customer_name: "16ChillGrill",
				summary: "Logged a check-in note.",
				reason: "60 days no contact, healthy.",
			});
			await run("task_complete", {
				task_id: "task-checkin-2",
				result: "Check-in logged",
				band: "act",
			});
		}
		return { text: "done", toolCalls: calls.slice(before).map((c) => ({ name: c })) };
	});
	return { agent: { prompt }, calls };
}

function wireTools(ledger: InMemoryActionLedger, source: StubTaskSource) {
	const channel = new StubCustomerChannel();
	const action = createActionPolicyTools({
		ledger,
		customerChannel: channel,
		sendToCsm: async () => {},
		now: () => NOW,
	});
	const task = createTaskTools({ source, ledger, now: () => NOW });
	return new Map([...action, ...task].map((t) => [t.name, t]));
}

const win = () => [new Date("2026-06-04T00:00:00Z"), new Date("2026-06-04T23:00:00Z")] as const;

describe("BrainLoop task iteration", () => {
	it("prompts the agent once per open task and auto-completes routine ones", async () => {
		const ledger = new InMemoryActionLedger();
		const source = new StubTaskSource();
		const tools = wireTools(ledger, source);
		const { agent } = scriptedAgent(tools);

		// no accounts (empty store) — tasks must still run
		const loop = new BrainLoop(
			new InMemoryStore(),
			agent as never,
			999_999,
			true,
			null,
			undefined,
			source,
			ledger,
		);
		await (loop as unknown as { cycle(): Promise<void> }).cycle();

		// 3 seed tasks → agent prompted 3 times
		expect((agent.prompt as ReturnType<typeof vi.fn>).mock.calls).toHaveLength(3);

		// routine renewal-nudge task → notify-then-act + completed + ledger tagged
		const entries = await ledger.listByWindow(...win());
		const nudge = entries.find((e) => e.payload?.taskId === "task-renewal-nudge-1");
		expect(nudge?.band).toBe("notify-then-act");
		expect((await source.getContext("task-renewal-nudge-1"))?.status).toBe("done");

		// routine check-in → act + completed
		const checkin = entries.find((e) => e.payload?.taskId === "task-checkin-2");
		expect(checkin?.band).toBe("act");
		expect((await source.getContext("task-checkin-2"))?.status).toBe("done");
	});

	it("leaves the escalation needs-csm and blocks (not silently completes) a high-stakes task", async () => {
		const ledger = new InMemoryActionLedger();
		const source = new StubTaskSource();
		const tools = wireTools(ledger, source);
		const { agent } = scriptedAgent(tools);
		const loop = new BrainLoop(
			new InMemoryStore(),
			agent as never,
			999_999,
			true,
			null,
			undefined,
			source,
			ledger,
		);

		await (loop as unknown as { cycle(): Promise<void> }).cycle();

		// escalation is open (needs-csm) — the CSM owns the decision
		const open = await ledger.listOpen();
		expect(open.find((e) => e.band === "escalate")?.status).toBe("needs-csm");

		// the discount task was blocked, not pretended-done
		expect((await source.getContext("task-discount-3"))?.status).toBe("blocked");
	});

	it("skips an open task that already has an in-flight action tagged with its id (ledger dedup)", async () => {
		const ledger = new InMemoryActionLedger();
		// A task that is still listed open but already has a mid-flight notify
		// recorded against its id from a prior cycle.
		const source = new StubTaskSource({
			seed: [
				{ id: "t-midflight", title: "Already in flight", status: "open" },
				{ id: "t-fresh", title: "Fresh task", status: "open" },
			],
		});
		await ledger.record({
			band: "notify-then-act",
			customerId: "t-midflight",
			summary: "Send pending",
			reason: "prior cycle",
			status: "in-flight",
			createdAt: NOW,
			executeAt: new Date(NOW.getTime() + 3600_000),
			payload: { taskId: "t-midflight" },
		});

		const prompted: string[] = [];
		const agent = {
			prompt: vi.fn(async (text: string) => {
				prompted.push(text.includes("t-midflight") ? "t-midflight" : "t-fresh");
				return { text: "ok", toolCalls: [] };
			}),
		};
		const loop = new BrainLoop(
			new InMemoryStore(),
			agent as never,
			999_999,
			true,
			null,
			undefined,
			source,
			ledger,
		);
		await (loop as unknown as { cycle(): Promise<void> }).cycle();

		// only the fresh task is evaluated; the mid-flight one is skipped
		expect(prompted).toEqual(["t-fresh"]);
	});

	it("an empty task source does not block account work", async () => {
		const ledger = new InMemoryActionLedger();
		const empty = new StubTaskSource({ seed: [] });
		const agent = { prompt: vi.fn().mockResolvedValue({ text: "ok", toolCalls: [] }) };
		const store = new InMemoryStore();
		await store.upsertProfile({
			id: "acme",
			companyName: "Acme",
			contacts: [],
			csmOwnerId: "sarah",
			createdAt: new Date(),
			updatedAt: new Date(),
		});
		const loop = new BrainLoop(
			store,
			agent as never,
			999_999,
			true,
			null,
			undefined,
			empty,
			ledger,
		);
		await (loop as unknown as { cycle(): Promise<void> }).cycle();
		// the one account was still evaluated
		expect(agent.prompt).toHaveBeenCalledTimes(1);
	});
});
