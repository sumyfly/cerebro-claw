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
	/** Notify-then-act — heads-up sent + send dispatched after pause window. */
	| "executed"
	/** CSM cancelled the action during the pause window. */
	| "cancelled"
	/** Escalate — CSM has not yet decided. */
	| "needs-csm"
	/** Escalate — CSM has decided + the agent has been told the outcome. */
	| "resolved"
	/** Dispatcher tried to execute and failed. */
	| "failed";

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
}

/**
 * The agent's running log. Implementations are append-only with status
 * updates — never delete an entry, the digest depends on history.
 */
export interface ActionLedger {
	/** Record a new action. Returns the generated id. */
	record(
		entry: Omit<ActionLedgerEntry, "id" | "createdAt"> & {
			id?: string;
			createdAt?: Date;
		},
	): Promise<ActionLedgerEntry>;

	/** Update a previously-recorded action (status change, executedAt, note). */
	update(
		id: string,
		patch: Partial<Pick<ActionLedgerEntry, "status" | "executedAt" | "note" | "payload">>,
	): Promise<ActionLedgerEntry | null>;

	/** Fetch a single entry. */
	get(id: string): Promise<ActionLedgerEntry | null>;

	/** All entries in [since, until) — used by the digest. */
	listByWindow(since: Date, until: Date): Promise<ActionLedgerEntry[]>;

	/** Notify-then-act entries due to dispatch at or before `now`. */
	listDue(now: Date): Promise<ActionLedgerEntry[]>;

	/** All in-flight or needs-csm entries (for the live counter on the dashboard). */
	listOpen(): Promise<ActionLedgerEntry[]>;
}
