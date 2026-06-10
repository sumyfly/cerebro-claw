import type { ActionBand } from "./action.js";

/**
 * TaskSource — the agent's view of the CSM's task queue on Cerebro.
 *
 * A task is the actual unit of CSM work (renewal follow-up, churn check-in,
 * onboarding nudge, …). The brain loop iterates open tasks the same way it
 * iterates accounts, and the agent works each one end-to-end through the
 * four-band action policy, then writes the outcome back here.
 *
 * This interface decouples the brain loop from any specific backend. The
 * concrete source is selected by configuration:
 *   - StubTaskSource (built-in) — in-memory seed tasks for dev/tests.
 *   - Future: a real connector to the CSP task endpoints or a standalone
 *     Cerebro task system, bound behind this same interface.
 */

/** Lifecycle of a task in the backend. */
export type TaskStatus = "open" | "in-progress" | "done" | "blocked";

/**
 * A single CSM task. `businessId` links it to a CSP account (so the brain loop
 * can attach account signals); `renewalId` links it to a renewal. Both are
 * optional — some tasks are account-less.
 */
export interface TaskRecord {
	/** Backend task id. */
	id: string;
	/** Short human title shown in the digest / console. */
	title: string;
	status: TaskStatus;
	/** Full task body / instructions, when the backend provides it. */
	description?: string;
	/** CSP account this task belongs to (24-char hex), when linked. */
	businessId?: string;
	/** Account name for display, when known. */
	customerName?: string;
	/** Renewal this task relates to (UUID), when linked. */
	renewalId?: string;
	/** ISO due date, when set. */
	dueDate?: Date;
	/** Backend priority label (e.g. LOW / NORMAL / HIGH / URGENT). */
	priority?: string;
	/**
	 * Structured fields the backend REQUIRES filled before the task can close
	 * (e.g. CSP's templated `renewalSignal`). The agent must supply values for
	 * the required ones in its outcome. Empty when the task has no template.
	 */
	requiredFields?: TaskFieldSpec[];
	/** Current values of the task's structured fields, if any. */
	customFields?: Record<string, unknown>;
	/** Whether the backend requires a logged activity to close the task. */
	activityRequired?: boolean;
	/** Anything backend-specific the agent may find useful. */
	meta?: Record<string, unknown>;
}

/** A structured field a task template requires (mirrors CSP template fields). */
export interface TaskFieldSpec {
	name: string;
	label?: string;
	type?: string;
	/** Allowed values for select fields. */
	options?: string[];
	required?: boolean;
}

/** How a task was resolved by the agent. */
export type TaskOutcomeKind = "completed" | "blocked";

/**
 * A CSM activity the agent logged while working a task (CSP requires one to
 * close templated tasks). Mirrors the CSP csm-activities shape.
 */
export interface TaskActivity {
	/** CALL | EMAIL | MEETING | ONSITE_VISIT | MESSAGE. */
	type: string;
	subject: string;
	summary?: string;
	/** POSITIVE | NEUTRAL | NEGATIVE. */
	sentiment?: string;
	outcome?: string;
	nextSteps?: string;
}

/**
 * The result the agent writes back when it finishes (or gives up on) a task.
 * `band` records which action-policy band the agent used to do the work, so the
 * ledger and digest stay consistent with the rest of the action policy.
 */
export interface TaskOutcome {
	kind: TaskOutcomeKind;
	/** One-line summary of what was done (or why it's blocked). */
	result: string;
	/** Which band the agent used (act / notify-then-act / escalate / prep). */
	band?: ActionBand;
	/** For blocked outcomes: what stopped the agent. */
	blockedReason?: string;
	/** Values for the task's required structured fields (e.g. {renewalSignal: "Renewing"}). */
	customFields?: Record<string, unknown>;
	/** The activity the agent logged for this task (required by some templates). */
	activity?: TaskActivity;
	/** Anything backend-specific to persist with the outcome. */
	meta?: Record<string, unknown>;
}

/**
 * The pluggable task backend. Implementations MUST keep `listOpen` and
 * `getContext` side-effect free; `writeBack` is the only mutating call.
 */
export interface TaskSource {
	/** Short label for logs/banners. */
	label: string;
	/** List the CSM's currently-open tasks. Should be cheap. */
	listOpen(): Promise<TaskRecord[]>;
	/** Fetch a single task's full context by id. Null if not found. */
	getContext(id: string): Promise<TaskRecord | null>;
	/**
	 * Persist a task outcome to the backend and return the updated record.
	 * Throws if the backend rejects the write — callers record a failed ledger
	 * entry and surface it in the digest.
	 */
	writeBack(id: string, outcome: TaskOutcome): Promise<TaskRecord>;
}
