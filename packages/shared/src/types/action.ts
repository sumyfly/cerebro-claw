/**
 * ActionLedger — the agent's daily work log.
 *
 * Every autonomous decision the agent makes lands here. The CSM's daily digest
 * counts entries by band ("Yesterday: 47 acts, 12 notifies in-flight, 2 escalations").
 *
 * This is operational data, distinct from per-customer memory (profile/state/
 * history/instinct). Keeping the schema flat and append-only keeps the
 * dispatcher logic obvious.
 */

/** Which of the four action-policy bands an entry belongs to. */
export type ActionBand = "act" | "notify-then-act" | "escalate" | "prep";

/**
 * A registered action band. The policy is an enumerable SET, not hardcoded
 * prose — so a new band can be added via the extension seam (ExtensionAPI.
 * registerBand) without editing the core. The default set is the four bands,
 * with identical behavior.
 */
export interface ActionBandDef {
	/** Band id (e.g. "act"). */
	id: string;
	/** One-line description of when to use it. */
	description: string;
	/** The tool the agent calls to use this band. */
	toolName: string;
}

/** The default policy set — the canonical four bands. */
export const DEFAULT_BANDS: ActionBandDef[] = [
	{
		id: "act",
		description: "Reversible, low-stakes, fact-based work — just do it and log it.",
		toolName: "act",
	},
	{
		id: "notify-then-act",
		description: "Routine customer touch — heads-up to the CSM, send after a pause window.",
		toolName: "notify_then_send_to_customer",
	},
	{
		id: "escalate",
		description: "Irreversible / high-stakes / ambiguous — brief the CSM, they decide.",
		toolName: "escalate",
	},
	{ id: "prep", description: "Ship a finished v1 for a CSM-owned conversation.", toolName: "prep" },
];

/** Lifecycle of an action. */
export type ActionStatus =
	/** Act / prep — finished immediately, nothing to wait on. */
	| "done"
	/** Notify-then-act — heads-up sent, pause window not yet elapsed. */
	| "in-flight"
	/** Notify-then-act — a dispatcher worker has claimed this row (CAS lease). */
	| "claimed"
	/** Notify-then-act — heads-up sent + send dispatched after pause window. */
	| "executed"
	/** CSM cancelled the action during the pause window. */
	| "cancelled"
	/** Escalate — CSM has not yet decided. */
	| "needs-csm"
	/** Escalate — CSM has decided + the agent has been told the outcome. */
	| "resolved"
	/** Dispatcher tried to execute and failed (will retry until max attempts). */
	| "failed"
	/** Dispatcher gave up after the retry budget; needs CSM attention. */
	| "dead-letter";

export interface ActionLedgerEntry {
	id: string;
	band: ActionBand;
	customerId: string;
	customerName?: string;
	/** One-line summary the CSM sees in the digest. */
	summary: string;
	/** Why the agent thought this action was warranted. */
	reason: string;
	status: ActionStatus;
	/** When the entry was first created. */
	createdAt: Date;
	/** For notify-then-act: dispatch the customer send after this timestamp. */
	executeAt?: Date;
	/** When the action actually ran (notify-then-act) or was resolved (escalate). */
	executedAt?: Date;
	/** Free-form payload for notify-then-act (message text, recipient) or escalate (recommendation). */
	payload?: Record<string, unknown>;
	/** If failed/cancelled, what happened. */
	note?: string;
	/** Links this action into a Situation storyline (when worked as part of one). */
	situationId?: string;
	/** Renewal this action concerns (UUID), when renewal-scoped — the CTA join. */
	renewalId?: string;

	// --- Harness-pipeline fields (v2) ----------------------------------------

	/** Agent turn that produced this entry. NULL for legacy / system-injected rows. */
	turnId?: string;
	/** Task this entry concerns (CSP task id). Indexed for mid-flight dedup. */
	taskId?: string;
	/** Tool that produced this entry (e.g. "csp_create_note", "notify_then_send_to_customer"). */
	toolName?: string;
	/** Blast radius declared by the tool. Same vocabulary as ToolDefinition.blastRadius. */
	blastRadius?: string;

	/**
	 * UNIQUE in storage for kind=notify rows. Two parallel turns that propose the
	 * same customer-facing send hit a UNIQUE-key violation at the DB layer, so
	 * dedup is enforced by the storage engine, not by the agent's discipline.
	 */
	idempotencyKey?: string;
	/** Dispatcher lease — when a worker CAS-claimed this row. NULL until claimed. */
	claimedAt?: Date;
	/** Dispatcher lease holder identity (e.g. "dispatcher@host:pid"). */
	claimedBy?: string;
	/** Send attempts tried so far (success or failure). Used for the retry budget. */
	attemptCount?: number;

	/** Escalate-only: CSM's chosen resolution string (matches one of the `options`). */
	resolution?: string;
	resolvedAt?: Date;
	/** Identifier of the CSM that resolved this escalation. */
	resolvedBy?: string;

	/** When the row is the consequence of a prior action, link back to it. */
	parentId?: string;
	/** Capability grant consumed to execute this row, if any. */
	capabilityId?: string;
}

/**
 * The agent's running log. Implementations are append-only with status
 * updates — never delete an entry, the digest depends on history.
 */
export interface ActionLedger {
	/**
	 * Record a new action. Returns the generated id. May throw if a UNIQUE
	 * constraint blocks the insert — currently, parallel attempts to create
	 * the same notify (same idempotencyKey) collide and only one wins.
	 */
	record(
		entry: Omit<ActionLedgerEntry, "id" | "createdAt"> & {
			id?: string;
			createdAt?: Date;
		},
	): Promise<ActionLedgerEntry>;

	/** Update a previously-recorded action (status change, executedAt, note). */
	update(
		id: string,
		patch: Partial<
			Pick<
				ActionLedgerEntry,
				| "status"
				| "executeAt"
				| "executedAt"
				| "note"
				| "payload"
				| "claimedAt"
				| "claimedBy"
				| "attemptCount"
				| "resolution"
				| "resolvedAt"
				| "resolvedBy"
			>
		>,
	): Promise<ActionLedgerEntry | null>;

	/** Fetch a single entry. */
	get(id: string): Promise<ActionLedgerEntry | null>;

	/** All entries in [since, until) — used by the digest. */
	listByWindow(since: Date, until: Date): Promise<ActionLedgerEntry[]>;

	/** Notify-then-act entries due to dispatch at or before `now`. */
	listDue(now: Date): Promise<ActionLedgerEntry[]>;

	/** All in-flight or needs-csm entries (for the live counter on the dashboard). */
	listOpen(): Promise<ActionLedgerEntry[]>;

	/** All entries linked to a situation, chronological — the situation's storyline. */
	listBySituation(situationId: string): Promise<ActionLedgerEntry[]>;

	/**
	 * The most recent entries for one customer, newest first — feeds the agent's
	 * per-account decision context so it observes its own past actions' outcomes.
	 */
	listRecentByCustomer(customerId: string, limit: number): Promise<ActionLedgerEntry[]>;

	/**
	 * Atomically claim a notify-then-act row for dispatch.
	 *
	 *   UPDATE action_ledger
	 *      SET status='claimed', claimed_at=?, claimed_by=?, attempt_count=attempt_count+1
	 *    WHERE id=? AND status='in-flight' AND execute_at <= ?
	 *
	 * Returns the post-claim entry if the CAS won; null if another worker beat
	 * us, the row was cancelled, or it's no longer due. The dispatcher MUST
	 * re-validate state on the returned row before sending.
	 */
	claimForDispatch(
		id: string,
		now: Date,
		workerId: string,
	): Promise<ActionLedgerEntry | null>;

	/**
	 * Whether a customer (and optional task) has any open or in-flight work — used
	 * by the brain loop for dedup. Counts statuses: in-flight, claimed, needs-csm.
	 * `taskId` narrows the check; omit to check customer-wide.
	 */
	hasOpenWork(customerId: string, taskId?: string): Promise<boolean>;
}
