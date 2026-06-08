/**
 * Situation — a persistent storyline the agent works over time.
 *
 * Where the action ledger is an append-only log of point-in-time actions, a
 * Situation is mutable, lifecycle-bearing state: it groups related ledger
 * actions into one thread, survives across work-loop cycles, knows when it next
 * needs attention (`nextCheckpoint`), and closes when resolved. This is what
 * stops the agent re-discovering the same risk every cycle.
 *
 * Identity while unresolved:
 *  - account-level kinds: (businessId, kind)
 *  - renewal-scoped kind (`renewal-risk`): (businessId, kind, renewalId)
 * At most one non-`resolved` Situation may exist per identity.
 */

/** Closed enum of situation kinds. `renewal-risk` is renewal-scoped (keyed by renewalId too). */
export type SituationKind =
	| "renewal-risk"
	| "adoption-gap"
	| "support-escalation"
	| "relationship-change"
	| "billing-issue"
	| "other";

/** Lifecycle of a situation. */
export type SituationStatus =
	/** Just opened; the agent is acting on it. */
	| "open"
	/** Acted on; waiting for a signal/checkpoint before revisiting. */
	| "watching"
	/** Handed to the CSM to decide; owned by them until resolved. */
	| "escalated"
	/** Condition no longer holds (recovered / renewed / churned / decided). */
	| "resolved";

export interface Situation {
	id: string;
	/** Account this concerns (CSP business id). */
	businessId: string;
	/** Account name, for digest/UI lines. */
	customerName?: string;
	kind: SituationKind;
	/** Set for renewal-scoped situations — the join through which a CTA's tasks and the renewal converge. */
	renewalId?: string;
	/** Human-readable storyline title. */
	title: string;
	status: SituationStatus;
	openedAt: Date;
	/** Last time the situation was touched (status change / advance). */
	updatedAt: Date;
	/** When to revisit a `watching` situation (agent-chosen; default 72h, clamped [1h, 30d]). */
	nextCheckpoint?: Date;
	/** What the agent is waiting on before the situation can advance. */
	waitingFor?: string;
	/** Marks an open/watching situation the CSM should look at even though it is not yet escalated. */
	needsAttention: boolean;
	/** If resolved, optional closing note. */
	note?: string;
}

/** Fields accepted when opening a situation. */
export interface SituationOpenInput {
	businessId: string;
	customerName?: string;
	kind: SituationKind;
	renewalId?: string;
	title: string;
	/** Initial status (default `open`). */
	status?: SituationStatus;
	nextCheckpoint?: Date;
	waitingFor?: string;
	needsAttention?: boolean;
}

/** Mutable fields patchable on an existing situation. */
export interface SituationPatch {
	status?: SituationStatus;
	title?: string;
	nextCheckpoint?: Date;
	waitingFor?: string;
	needsAttention?: boolean;
	note?: string;
}

/**
 * Persistence for Situations. Implementations enforce the "at most one open per
 * identity" invariant: `open()` is idempotent — it returns the existing open
 * situation for the same identity rather than creating a duplicate.
 */
export interface SituationStore {
	/** Open a new situation, or return the existing non-resolved one for the same identity. */
	open(input: SituationOpenInput): Promise<Situation>;
	/** Fetch one situation by id. */
	get(id: string): Promise<Situation | null>;
	/** The open (non-resolved) situation matching the identity, if any. */
	findOpen(businessId: string, kind: SituationKind, renewalId?: string): Promise<Situation | null>;
	/** All non-resolved situations for an account. */
	listOpen(businessId: string): Promise<Situation[]>;
	/** All non-resolved situations that need the CSM (status `escalated` OR `needsAttention`). */
	listNeedingCsm(): Promise<Situation[]>;
	/** All non-resolved situations in `watching` status (tracked, no action needed). */
	listWatching(): Promise<Situation[]>;
	/** Patch mutable fields; `null` if not found. */
	update(id: string, patch: SituationPatch): Promise<Situation | null>;
	/** Mark a situation resolved; `null` if not found. */
	resolve(id: string, note?: string): Promise<Situation | null>;
}

/** Default revisit window when the agent doesn't choose one. */
export const DEFAULT_CHECKPOINT_MS = 72 * 60 * 60 * 1000; // 72h
const MIN_CHECKPOINT_MS = 60 * 60 * 1000; // 1h
const MAX_CHECKPOINT_MS = 30 * 24 * 60 * 60 * 1000; // 30d

/**
 * Resolve a situation's nextCheckpoint per decision D3: agent-chosen when given,
 * else default 72h, always clamped to [1h, 30d] from `now`.
 */
export function resolveNextCheckpoint(requested: Date | undefined, now: Date): Date {
	const min = now.getTime() + MIN_CHECKPOINT_MS;
	const max = now.getTime() + MAX_CHECKPOINT_MS;
	const target = requested ? requested.getTime() : now.getTime() + DEFAULT_CHECKPOINT_MS;
	return new Date(Math.min(Math.max(target, min), max));
}

/** True when a situation needs the CSM: escalated, or flagged needs-attention. */
export function situationNeedsCsm(s: Pick<Situation, "status" | "needsAttention">): boolean {
	return s.status === "escalated" || s.needsAttention;
}
