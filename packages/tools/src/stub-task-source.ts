import type { TaskOutcome, TaskRecord, TaskSource } from "@cerebro-claw/shared";

export interface StubTaskSourceOptions {
	/** Seed tasks. If omitted, a small built-in demo set is used. */
	seed?: TaskRecord[];
	/** Optional hook fired on every write-back — useful for tests/logging. */
	onWriteBack?: (id: string, outcome: TaskOutcome, record: TaskRecord) => void | Promise<void>;
}

/**
 * Default task source — an in-memory queue of CSM tasks. Mirrors
 * StubCustomerChannel: it lets the task-autopilot loop run end-to-end without a
 * real backend. `listOpen` returns only open/in-progress tasks; `writeBack`
 * flips a task to done/blocked so it drops out of `listOpen`.
 *
 * The real connector (CSP task endpoints or a standalone Cerebro task system)
 * drops in by implementing TaskSource and replacing this in the wiring.
 */
export class StubTaskSource implements TaskSource {
	readonly label = "stub task queue";
	private tasks = new Map<string, TaskRecord>();
	private onWriteBack: StubTaskSourceOptions["onWriteBack"];

	constructor(opts: StubTaskSourceOptions = {}) {
		this.onWriteBack = opts.onWriteBack;
		const seed = opts.seed ?? DEFAULT_SEED;
		for (const t of seed) this.tasks.set(t.id, { ...t });
	}

	async listOpen(): Promise<TaskRecord[]> {
		return [...this.tasks.values()]
			.filter((t) => t.status === "open" || t.status === "in-progress")
			.map((t) => ({ ...t }));
	}

	async getContext(id: string): Promise<TaskRecord | null> {
		const t = this.tasks.get(id);
		return t ? { ...t } : null;
	}

	async writeBack(id: string, outcome: TaskOutcome): Promise<TaskRecord> {
		const existing = this.tasks.get(id);
		if (!existing) throw new Error(`No task found with id ${id}`);
		const updated: TaskRecord = {
			...existing,
			status: outcome.kind === "completed" ? "done" : "blocked",
			meta: {
				...existing.meta,
				outcome: outcome.result,
				band: outcome.band,
				blockedReason: outcome.blockedReason,
			},
		};
		this.tasks.set(id, updated);
		if (this.onWriteBack) await this.onWriteBack(id, outcome, { ...updated });
		return { ...updated };
	}

	/** Test affordance — current full task set (including closed). */
	all(): TaskRecord[] {
		return [...this.tasks.values()].map((t) => ({ ...t }));
	}
}

/** A small demo queue so dev mode shows the loop doing real-shaped work. */
const DEFAULT_SEED: TaskRecord[] = [
	{
		id: "task-renewal-nudge-1",
		title: "Follow up on StorehubPay renewal — 30 days out",
		status: "open",
		description:
			"Renewal approaching in 30 days, normal health. Send the standard renewal nudge and log a renewal note.",
		businessId: "0123456789abcdef01234567",
		customerName: "StorehubPay",
		priority: "NORMAL",
	},
	{
		id: "task-checkin-2",
		title: "Quarterly check-in with 16ChillGrill",
		status: "open",
		description: "No contact in 60 days. Routine touch to confirm everything is on track.",
		businessId: "1123456789abcdef01234567",
		customerName: "16ChillGrill",
		priority: "LOW",
	},
	{
		id: "task-discount-3",
		title: "Customer requested 20% discount to renew",
		status: "open",
		description:
			"Account asked for a 20% discount as a renewal condition. High-stakes / commercial — needs the CSM to decide.",
		businessId: "2123456789abcdef01234567",
		customerName: "Acme Bistro",
		priority: "HIGH",
	},
];
