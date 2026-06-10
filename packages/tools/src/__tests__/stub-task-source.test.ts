import type { TaskRecord } from "@cerebro-claw/shared";
import { beforeEach, describe, expect, it } from "vitest";
import { StubTaskSource } from "../stub-task-source.js";

const SEED: TaskRecord[] = [
	{ id: "t1", title: "Renewal nudge", status: "open", businessId: "abc" },
	{ id: "t2", title: "Check-in", status: "in-progress" },
	{ id: "t3", title: "Already closed", status: "done" },
];

describe("StubTaskSource", () => {
	let source: StubTaskSource;

	beforeEach(() => {
		source = new StubTaskSource({ seed: SEED });
	});

	it("lists only open / in-progress tasks", async () => {
		const open = await source.listOpen();
		expect(open.map((t) => t.id).sort()).toEqual(["t1", "t2"]);
	});

	it("returns a copy from getContext (no aliasing)", async () => {
		const t = await source.getContext("t1");
		expect(t?.title).toBe("Renewal nudge");
		if (t) t.title = "mutated";
		const again = await source.getContext("t1");
		expect(again?.title).toBe("Renewal nudge");
	});

	it("returns null for an unknown id", async () => {
		expect(await source.getContext("nope")).toBeNull();
	});

	it("writeBack completed drops the task from listOpen", async () => {
		await source.writeBack("t1", {
			kind: "completed",
			result: "nudge sent",
			band: "notify-then-act",
		});
		const open = await source.listOpen();
		expect(open.map((t) => t.id)).toEqual(["t2"]);
		const closed = await source.getContext("t1");
		expect(closed?.status).toBe("done");
		expect(closed?.meta?.outcome).toBe("nudge sent");
	});

	it("writeBack blocked marks the task blocked and drops it from listOpen", async () => {
		await source.writeBack("t2", { kind: "blocked", result: "waiting", blockedReason: "no info" });
		const open = await source.listOpen();
		expect(open.map((t) => t.id)).toEqual(["t1"]);
		const blocked = await source.getContext("t2");
		expect(blocked?.status).toBe("blocked");
	});

	it("throws when writing back an unknown task", async () => {
		await expect(source.writeBack("nope", { kind: "completed", result: "x" })).rejects.toThrow();
	});

	it("fires the onWriteBack hook", async () => {
		const calls: string[] = [];
		const s = new StubTaskSource({ seed: SEED, onWriteBack: (id) => void calls.push(id) });
		await s.writeBack("t1", { kind: "completed", result: "done" });
		expect(calls).toEqual(["t1"]);
	});

	it("falls back to a built-in demo seed when none provided", async () => {
		const s = new StubTaskSource();
		const open = await s.listOpen();
		expect(open.length).toBeGreaterThan(0);
	});
});
