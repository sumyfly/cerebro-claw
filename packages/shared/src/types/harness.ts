import type { ToolBlastRadius, ToolDefinition, ToolKind } from "./tool.js";

/**
 * Harness contract — the part of the runtime that is structural law, not prompt
 * convention. Everything in here is consulted by the MCP server pipeline on
 * every tool call. Adding a new band or radius means updating these tables;
 * adding a new tool means declaring kind+blastRadius so the tables can find it.
 *
 * Vocabulary:
 *  - kind          : what flavour of decision this tool is (observe/act/notify/escalate/prep)
 *  - blastRadius   : how far the side effects reach (none → customer-irreversible)
 *  - capability    : a grant the CSM issues by resolving an escalate, unlocking
 *                    a normally-hidden tool for one bounded use
 *  - turn          : one `agent.prompt()` invocation. The MCP server attaches all
 *                    pipeline state (account scope, capabilities, budget) to this.
 */

/**
 * Legality matrix — which (kind, blastRadius) pairs are allowed. Reading row by row:
 *
 *  observe   : may touch nothing or read internal state. Never csm/customer.
 *  act       : may write internal, ping CSM, or reversibly touch the customer.
 *              MAY NOT do customer-irreversible work — that must go through escalate.
 *  notify    : MUST be customer-reversible. A notify with blast=internal is a misuse
 *              (it's an act); blast=customer-irreversible is illegal (escalate first).
 *  escalate  : briefing the CSM — may concern any csm-or-customer level decision.
 *  prep      : artifact for the CSM — internal write + csm-only delivery. Never
 *              reaches the customer (that would be a notify, not a prep).
 */
const LEGAL_MATRIX: Record<ToolKind, ReadonlySet<ToolBlastRadius>> = {
	observe: new Set<ToolBlastRadius>(["none", "internal"]),
	act: new Set<ToolBlastRadius>(["internal", "csm-only", "customer-reversible"]),
	notify: new Set<ToolBlastRadius>(["customer-reversible"]),
	escalate: new Set<ToolBlastRadius>([
		"csm-only",
		"customer-reversible",
		"customer-irreversible",
	]),
	prep: new Set<ToolBlastRadius>(["internal", "csm-only"]),
};

/** Result of a legality check. `ok=false` carries a human-readable reason. */
export type LegalityResult = { ok: true } | { ok: false; reason: string };

/**
 * Check whether (kind, blastRadius) is structurally legal. Called at:
 *   1. extension load time — registration of a new tool;
 *   2. every MCP tools/call — defense in depth against runtime mutation.
 */
export function checkLegality(kind: ToolKind, blastRadius: ToolBlastRadius): LegalityResult {
	const allowed = LEGAL_MATRIX[kind];
	if (!allowed.has(blastRadius)) {
		return {
			ok: false,
			reason: `Illegal kind/blastRadius pair: kind=${kind} cannot have blastRadius=${blastRadius}. Allowed for ${kind}: ${[...allowed].join(", ")}.`,
		};
	}
	return { ok: true };
}

/**
 * Full structural validation of a ToolDefinition. Catches:
 *   - illegal (kind, blastRadius) combinations
 *   - notify without an idempotencyKey extractor (would lose the dispatcher's
 *     at-most-once guarantee)
 *   - customer-irreversible tools that are neither escalate nor capability-gated
 *     (the rule that locks discount/contract changes behind CSM approval)
 */
export function validateToolDefinition(tool: ToolDefinition): LegalityResult {
	const kind = tool.kind ?? "observe";
	const blast = tool.blastRadius ?? "none";
	const legality = checkLegality(kind, blast);
	if (!legality.ok) return legality;

	if (kind === "notify" && typeof tool.idempotencyKey !== "function") {
		return {
			ok: false,
			reason: `Tool "${tool.name}" is kind=notify but has no idempotencyKey(params) extractor. Notify tools MUST be at-most-once.`,
		};
	}

	if (
		blast === "customer-irreversible" &&
		kind !== "escalate" &&
		!tool.requiresCapability
	) {
		return {
			ok: false,
			reason: `Tool "${tool.name}" has blastRadius=customer-irreversible but is neither an escalate nor capability-gated. Customer-irreversible work must be performed AFTER CSM approves an escalation (requiresCapability=...).`,
		};
	}

	return { ok: true };
}

/**
 * The scope a capability is bound to. A grant carries a scope; the harness
 * matches the turn's scope against it before unlocking the tool.
 */
export interface CapabilityScope {
	/** Account this capability concerns (CSP business id). */
	accountId: string;
}

/**
 * A grant the CSM hands the agent by resolving an escalation. The harness reads
 * the unconsumed grants matching the turn's scope and uses them to unlock
 * `requiresCapability` tools in `tools/list`. One use, time-boxed, account-scoped.
 */
export interface CapabilityGrant {
	id: string;
	/** What this grant unlocks — must match a tool's `requiresCapability`. */
	grants: string;
	scope: CapabilityScope;
	/** Escalation entry whose resolution issued this grant. */
	parentEscalationId: string;
	/** Default 1 — unlocks one tool call. Increment only if the playbook truly needs N. */
	usesRemaining: number;
	/** Hard expiry; ignored after this even if uses remain. */
	expiresAt: Date;
	createdAt: Date;
	/** Filled in when consumed by a tool call. */
	consumedAt?: Date;
	consumedByTurnId?: string;
}

/**
 * Turn context — everything the harness needs to evaluate one tool call.
 * Created when the runtime starts an `agent.prompt()`, lives until the
 * subprocess exits, looked up by the MCP server on every request.
 *
 * Identity. `id` is what the runtime puts into the MCP URL path. It is also the
 * dedup key in the ledger (every entry this turn produces carries turn_id=id).
 *
 * Scope. `accountId`/`taskId`/`renewalId` describe WHICH subject this turn is
 * working. They become the default scope on every ledger entry, so the
 * dispatcher and dedup index do not depend on the agent populating them.
 *
 * Capabilities. The harness loads matching unconsumed grants into this object
 * when it filters `tools/list`. A tool call that consumes one updates the
 * store; the next request sees one fewer use.
 */
export interface TurnContext {
	id: string;
	subject:
		| { kind: "account"; accountId: string }
		| { kind: "task"; taskId: string; accountId?: string }
		| { kind: "renewal"; renewalId: string; accountId?: string }
		| { kind: "ad-hoc"; accountId?: string };
	situationId?: string;
	startedAt: Date;
	/** Capabilities visible to this turn at filter time. Refreshed lazily. */
	capabilities?: CapabilityGrant[];
}

/**
 * Store of capability grants. SQLite-backed in production; an in-memory shim
 * is fine for tests. The store is responsible for atomic consume — two
 * concurrent tool calls cannot both claim the last use of one grant.
 */
export interface CapabilityStore {
	/** Issue a new grant. Returns the persisted record. */
	grant(
		input: Omit<CapabilityGrant, "id" | "createdAt"> & {
			id?: string;
			createdAt?: Date;
		},
	): Promise<CapabilityGrant>;
	/** All unconsumed, unexpired grants matching the scope. */
	listActiveForScope(scope: CapabilityScope, now: Date): Promise<CapabilityGrant[]>;
	/** Atomically decrement uses on a grant. Returns the updated record, or null if it could not be consumed. */
	consume(grantId: string, turnId: string, now: Date): Promise<CapabilityGrant | null>;
	/** Lookup by id (debug / replay). */
	get(id: string): Promise<CapabilityGrant | null>;
}
