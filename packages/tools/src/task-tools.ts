import type {
	ActionBand,
	ActionLedger,
	TaskActivity,
	TaskSource,
	ToolDefinition,
} from "@cerebro-claw/shared";

/**
 * Context the task tools need.
 *
 * - source: the pluggable task backend (StubTaskSource in dev/tests).
 * - ledger: every task completion/block lands here, tagged with the task id, so
 *   the digest and dispatcher cover task work with no separate surface.
 * - now: clock — injectable for tests.
 */
export interface TaskToolsContext {
	source: TaskSource;
	ledger: ActionLedger;
	now?: () => Date;
}

const VALID_BANDS: ActionBand[] = ["act", "notify-then-act", "escalate", "prep"];

function coerceBand(value: unknown): ActionBand {
	return VALID_BANDS.includes(value as ActionBand) ? (value as ActionBand) : "act";
}

/** Parse the optional `custom_fields` param into a record, or undefined. */
function parseCustomFields(value: unknown): Record<string, unknown> | undefined {
	if (value && typeof value === "object" && !Array.isArray(value)) {
		return value as Record<string, unknown>;
	}
	return undefined;
}

/** Parse the optional `activity` param into a TaskActivity, or undefined. */
function parseActivity(value: unknown): TaskActivity | undefined {
	if (!value || typeof value !== "object") return undefined;
	const a = value as Record<string, unknown>;
	if (!a.type || !a.subject) return undefined;
	return {
		type: String(a.type),
		subject: String(a.subject),
		summary: a.summary != null ? String(a.summary) : undefined,
		sentiment: a.sentiment != null ? String(a.sentiment) : undefined,
		outcome: a.outcome != null ? String(a.outcome) : undefined,
		nextSteps: a.next_steps != null ? String(a.next_steps) : undefined,
	};
}

/** Shared schema for the structured-completion params (CSP templated tasks). */
const COMPLETION_PROPS = {
	custom_fields: {
		type: "object" as const,
		description:
			'Values for the task\'s required structured fields (from task_get\'s requiredFields), e.g. {"renewalSignal": "Renewing"}. Required to close templated CSP tasks.',
	},
	activity: {
		type: "object" as const,
		description:
			"The CSM activity to log for this task (required by templated tasks). Shape: {type: CALL|EMAIL|MEETING|ONSITE_VISIT|MESSAGE, subject, summary?, sentiment?: POSITIVE|NEUTRAL|NEGATIVE, outcome?, next_steps?}.",
	},
};

/**
 * Task tools — the agent's read/write interface to the CSM task queue.
 *
 *   - task_list_open   list the CSM's open tasks
 *   - task_get         fetch one task's full context
 *   - task_complete    mark a task done (write-back + ledger entry)
 *   - task_block       mark a task blocked (write-back + ledger entry)
 *
 * Write-back ordering mirrors the action-policy tools: record the ledger entry
 * first, then push to the backend; if the backend rejects, flip the entry to
 * `failed` so the digest surfaces it instead of dropping it.
 */
export function createTaskTools(ctx: TaskToolsContext): ToolDefinition[] {
	const now = () => ctx.now?.() ?? new Date();

	const listOpen: ToolDefinition = {
		name: "task_list_open",
		kind: "observe",
		blastRadius: "none",
		description:
			"List the CSM's currently-open tasks from Cerebro — the actual queue of work to do (renewal follow-ups, check-ins, churn touches). Use this at the start of a work cycle to see what needs doing, then drill into each with task_get and finish it through the action policy.",
		parameters: { type: "object", properties: {} },
		async execute() {
			const tasks = await ctx.source.listOpen();
			return {
				content: JSON.stringify(tasks, null, 2),
				success: true,
				details: { count: tasks.length },
			};
		},
	};

	const get: ToolDefinition = {
		name: "task_get",
		kind: "observe",
		blastRadius: "none",
		description:
			"Fetch the full context of a single task by id: title, description, linked account (businessId) and renewal, priority, due date. Use this before deciding how to handle a task.",
		parameters: {
			type: "object",
			properties: {
				task_id: { type: "string", description: "The task id from task_list_open." },
			},
			required: ["task_id"],
		},
		async execute(params) {
			const id = String(params.task_id ?? "").trim();
			if (!id) return { content: "task_id is required.", success: false };
			const task = await ctx.source.getContext(id);
			if (!task) return { content: `No task found with id ${id}.`, success: false };
			return { content: JSON.stringify(task, null, 2), success: true };
		},
	};

	const complete: ToolDefinition = {
		name: "task_complete",
		kind: "act",
		blastRadius: "csm-only",
		description:
			"Mark a task done after you've actually done the work (logged the note, queued the customer nudge, shipped the brief). Records the outcome to the action ledger tagged with the task id and writes it back to Cerebro. Do NOT complete a task you only escalated — use task_block (or leave it open) so the CSM still owns the open decision.",
		parameters: {
			type: "object",
			properties: {
				task_id: { type: "string", description: "The task id to close." },
				result: {
					type: "string",
					description: "One-line summary of what you did to finish this task.",
				},
				band: {
					type: "string",
					description: "Which action-policy band you used to do the work.",
					enum: [...VALID_BANDS],
				},
				...COMPLETION_PROPS,
			},
			required: ["task_id", "result"],
		},
		async execute(params) {
			const id = String(params.task_id ?? "").trim();
			if (!id) return { content: "task_id is required.", success: false };
			const task = await ctx.source.getContext(id);
			if (!task) return { content: `No task found with id ${id}.`, success: false };

			const band = coerceBand(params.band);
			const result = String(params.result);
			const customFields = parseCustomFields(params.custom_fields);
			const activity = parseActivity(params.activity);
			const customerId = task.businessId ?? id;
			const ts = now();
			const entry = await ctx.ledger.record({
				band,
				customerId,
				customerName: task.customerName ?? undefined,
				summary: `Task done: ${task.title} — ${result.slice(0, 100)}`,
				reason: `Completed Cerebro task ${id} via ${band}.`,
				status: "done",
				createdAt: ts,
				executedAt: ts,
				payload: { taskId: id, taskTitle: task.title, outcome: result, customFields },
			});

			try {
				await ctx.source.writeBack(id, { kind: "completed", result, band, customFields, activity });
			} catch (err) {
				await ctx.ledger.update(entry.id, {
					status: "failed",
					note: `Task write-back failed: ${(err as Error).message}`,
				});
				return {
					content: `Recorded the work but writing it back to Cerebro failed: ${(err as Error).message}. Surfaced in the digest as failed.`,
					success: false,
					details: { actionId: entry.id, taskId: id },
				};
			}

			return {
				content: `Task ${id} completed (#${entry.id.slice(0, 8)}): ${result}`,
				success: true,
				details: { actionId: entry.id, taskId: id, band },
			};
		},
	};

	const block: ToolDefinition = {
		name: "task_block",
		kind: "act",
		blastRadius: "csm-only",
		description:
			"Mark a task blocked when you can't finish it autonomously (waiting on the CSM's decision, missing info, external dependency). Records the block to the ledger tagged with the task id and writes it back. Typically pair this with an `escalate` call so the CSM has the situation in front of them.",
		parameters: {
			type: "object",
			properties: {
				task_id: { type: "string", description: "The task id to block." },
				reason: { type: "string", description: "Why this task can't be completed right now." },
				...COMPLETION_PROPS,
			},
			required: ["task_id", "reason"],
		},
		async execute(params) {
			const id = String(params.task_id ?? "").trim();
			if (!id) return { content: "task_id is required.", success: false };
			const task = await ctx.source.getContext(id);
			if (!task) return { content: `No task found with id ${id}.`, success: false };

			const reason = String(params.reason);
			const customFields = parseCustomFields(params.custom_fields);
			const activity = parseActivity(params.activity);
			const customerId = task.businessId ?? id;
			const ts = now();
			const entry = await ctx.ledger.record({
				band: "act",
				customerId,
				customerName: task.customerName ?? undefined,
				summary: `Task blocked: ${task.title} — ${reason.slice(0, 100)}`,
				reason: `Blocked Cerebro task ${id}: ${reason}`,
				status: "done",
				createdAt: ts,
				executedAt: ts,
				payload: { taskId: id, taskTitle: task.title, blocked: true, blockedReason: reason },
			});

			try {
				await ctx.source.writeBack(id, {
					kind: "blocked",
					result: reason,
					blockedReason: reason,
					customFields,
					activity,
				});
			} catch (err) {
				await ctx.ledger.update(entry.id, {
					status: "failed",
					note: `Task write-back failed: ${(err as Error).message}`,
				});
				return {
					content: `Recorded the block but writing it back to Cerebro failed: ${(err as Error).message}. Surfaced in the digest as failed.`,
					success: false,
					details: { actionId: entry.id, taskId: id },
				};
			}

			return {
				content: `Task ${id} blocked (#${entry.id.slice(0, 8)}): ${reason}`,
				success: true,
				details: { actionId: entry.id, taskId: id },
			};
		},
	};

	return [listOpen, get, complete, block];
}
