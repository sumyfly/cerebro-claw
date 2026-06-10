import { InMemoryActionLedger } from "@cerebro-claw/memory";
import type { ToolDefinition } from "@cerebro-claw/shared";
import { beforeEach, describe, expect, it } from "vitest";
import { StubTaskSource } from "../stub-task-source.js";
import { createTaskTools } from "../task-tools.js";

function asMap(tools: ToolDefinition[]): Map<string, ToolDefinition> {
	return new Map(tools.map((t) => [t.name, t]));
}

/** A task source whose writeBack always rejects — exercises the failed path. */
function failingSource(base: StubTaskSource): StubTaskSource {
	const s = base as unknown as { writeBack: () => Promise<never> };
	s.writeBack = () => Promise.reject(new Error("backend down"));
	return base;
}

describe("task tools", () => {
	let ledger: InMemoryActionLedger;
	let source: StubTaskSource;
	let tools: Map<string, ToolDefinition>;
	const fixedNow = new Date("2026-06-04T08:00:00Z");

	beforeEach(() => {
		ledger = new InMemoryActionLedger();
		source = new StubTaskSource({
			seed: [
				{
					id: "t1",
					title: "Renewal nudge",
					status: "open",
					businessId: "abc",
					customerName: "Acme",
				},
				{ id: "t2", title: "Discount ask", status: "open" },
			],
		});
		tools = asMap(createTaskTools({ source, ledger, now: () => fixedNow }));
	});

	it("registers the four task tools", () => {
		expect([...tools.keys()].sort()).toEqual([
			"task_block",
			"task_complete",
			"task_get",
			"task_list_open",
		]);
	});

	it("task_list_open returns open tasks", async () => {
		const res = await tools.get("task_list_open")?.execute({});
		expect(res?.success).toBe(true);
		expect(res?.details?.count).toBe(2);
	});

	it("task_get rejects a missing id", async () => {
		const res = await tools.get("task_get")?.execute({ task_id: "  " });
		expect(res?.success).toBe(false);
	});

	it("task_get returns a task's context", async () => {
		const res = await tools.get("task_get")?.execute({ task_id: "t1" });
		expect(res?.success).toBe(true);
		expect(res?.content).toContain("Renewal nudge");
	});

	it("task_complete writes back and records a ledger entry tagged with the task id", async () => {
		const res = await tools
			.get("task_complete")
			?.execute({ task_id: "t1", result: "nudge queued", band: "notify-then-act" });
		expect(res?.success).toBe(true);

		// ledger entry exists, tagged with the task id, on the linked account
		const entries = await ledger.listByWindow(
			new Date("2026-06-04T00:00:00Z"),
			new Date("2026-06-04T23:00:00Z"),
		);
		expect(entries).toHaveLength(1);
		expect(entries[0].band).toBe("notify-then-act");
		expect(entries[0].customerId).toBe("abc");
		expect(entries[0].payload?.taskId).toBe("t1");

		// task dropped from the open queue
		const open = await source.listOpen();
		expect(open.map((t) => t.id)).toEqual(["t2"]);
	});

	it("task_complete defaults the band to act and uses the task id as customer when unlinked", async () => {
		await tools.get("task_complete")?.execute({ task_id: "t2", result: "logged" });
		const entries = await ledger.listByWindow(
			new Date("2026-06-04T00:00:00Z"),
			new Date("2026-06-04T23:00:00Z"),
		);
		expect(entries[0].band).toBe("act");
		expect(entries[0].customerId).toBe("t2");
	});

	it("task_complete on a missing task fails without recording", async () => {
		const res = await tools.get("task_complete")?.execute({ task_id: "nope", result: "x" });
		expect(res?.success).toBe(false);
		const open = await ledger.listOpen();
		expect(open).toHaveLength(0);
	});

	it("task_complete surfaces a write-back failure as a failed ledger entry", async () => {
		const tools2 = asMap(
			createTaskTools({ source: failingSource(source), ledger, now: () => fixedNow }),
		);
		const res = await tools2.get("task_complete")?.execute({ task_id: "t1", result: "x" });
		expect(res?.success).toBe(false);
		const entry = await ledger.get(String(res?.details?.actionId));
		expect(entry?.status).toBe("failed");
		expect(entry?.note).toContain("backend down");
	});

	it("task_block records a block tagged with the task id", async () => {
		const res = await tools.get("task_block")?.execute({ task_id: "t1", reason: "needs CSM" });
		expect(res?.success).toBe(true);
		const entries = await ledger.listByWindow(
			new Date("2026-06-04T00:00:00Z"),
			new Date("2026-06-04T23:00:00Z"),
		);
		expect(entries[0].payload?.blocked).toBe(true);
		expect(entries[0].payload?.taskId).toBe("t1");
		expect((await source.getContext("t1"))?.status).toBe("blocked");
	});
});
