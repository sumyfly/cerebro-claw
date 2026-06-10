/**
 * Tool kinds — the harness's structural classification of what a tool does.
 *
 *  - observe   read-only perceive tools (csp_get_*, memory reads). No ledger entry.
 *  - act       does something internal or low-blast right now; ledger row status=done.
 *  - notify    schedules a customer-facing send after a pause window; pending → dispatcher.
 *  - escalate  briefs the CSM and waits for decision; status=needs-csm → resolve.
 *  - prep      delivers a finished artifact to the CSM for them to use. No customer send.
 */
export type ToolKind = "observe" | "act" | "notify" | "escalate" | "prep";

/**
 * Blast radius — how far the side effects of this tool can reach. The harness
 * pairs this with `kind` to enforce what's structurally legal (e.g. nothing
 * marked customer-irreversible can be an `act` band — must go through escalate).
 *
 *  - none                  pure read / observation
 *  - internal              writes to agent-private state (instinct memory, ledger)
 *  - csm-only              reaches the CSM channel (heads-up, brief, artifact)
 *  - customer-reversible   reaches the customer but can be retracted (message, note)
 *  - customer-irreversible reaches the customer in a way that cannot be undone
 *                          (discount, contract change, refund, paused account)
 */
export type ToolBlastRadius =
	| "none"
	| "internal"
	| "csm-only"
	| "customer-reversible"
	| "customer-irreversible";

/**
 * Harness-level metadata every tool declares. The `ToolDefinition.kind` and
 * `blastRadius` fields are READ by the harness pipeline (legality matrix,
 * capability filter, critic routing, dispatcher) — they are NOT advisory.
 *
 * Tools without `kind`/`blastRadius` are treated as legacy observe/none by the
 * harness and may not be allowed to perform side-effectful work in future
 * releases. New tools MUST declare both.
 */
export interface ToolDefinition {
	name: string;
	description: string;
	parameters: ToolParameters;
	execute: (params: Record<string, unknown>) => Promise<ToolResult>;

	/** Structural classification — see `ToolKind`. Defaults to "observe" if unset. */
	kind?: ToolKind;
	/** How far the side effects can reach — see `ToolBlastRadius`. Defaults to "none" if unset. */
	blastRadius?: ToolBlastRadius;

	/**
	 * If set, the tool is hidden from the agent's `tools/list` unless the active
	 * turn holds a matching capability. The harness consults the capability store
	 * (issued when CSM resolves an escalate) and only surfaces this tool when
	 * one is present, scoped to the turn's account and not yet consumed.
	 *
	 * Use this for customer-irreversible actions (discount, contract change) that
	 * may only be performed AFTER a CSM has approved a specific escalation. The
	 * tool does not need its own runtime check — the harness filters it out.
	 */
	requiresCapability?: string;

	/**
	 * Required for `kind: "notify"`. Returns a stable string that uniquely
	 * identifies the work this tool call represents. The harness writes it to the
	 * ledger's `idempotency_key` UNIQUE column so:
	 *   1. parallel turns proposing the same send collide at the DB layer.
	 *   2. dispatcher retries cannot send twice (the CustomerChannel also gets
	 *      this key for at-most-once semantics at the channel layer).
	 *
	 * Good keys: `notify:<customerId>:<contentHash>` or
	 * `notify:<customerId>:<taskId>`. Bad keys: timestamps, UUIDs, anything
	 * the agent could vary unintentionally.
	 */
	idempotencyKey?: (params: Record<string, unknown>) => string;
}

export interface ToolParameters {
	type: "object";
	properties: Record<string, ToolParameterProperty>;
	required?: string[];
}

export interface ToolParameterProperty {
	type: "string" | "number" | "boolean" | "array" | "object";
	description: string;
	enum?: string[];
}

export interface ToolResult {
	content: string;
	success: boolean;
	details?: Record<string, unknown>;
}
