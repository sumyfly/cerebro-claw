import type {
	ActionLedger,
	ActionLedgerEntry,
	ToolBlastRadius,
	ToolDefinition,
} from "@cerebro-claw/shared";
import { currentTurn } from "./turn-registry.js";

/**
 * The auto-fields the harness injects on every ledger.record() call inside a
 * turn. They come from a combination of (turn context) + (the tool that is
 * currently executing). The pipeline sets the tool half via `setCurrentTool`
 * before calling execute().
 */
interface AutoFields {
	turnId: string;
	customerId?: string;
	taskId?: string;
	renewalId?: string;
	situationId?: string;
	toolName?: string;
	blastRadius?: ToolBlastRadius;
	idempotencyKey?: string;
}

/**
 * The currently-executing tool's metadata, scoped to the turn via the same
 * AsyncLocalStorage as the turn context. The pipeline pushes this before each
 * execute(); the wrapped ledger reads it.
 *
 * We store this on the same ALS frame to avoid a second ALS instance, but
 * since we mutate the per-turn object the assignment is safe — there is at
 * most one in-flight tool call per turn (the subprocess is single-threaded
 * from our perspective).
 */
interface TurnExtras {
	currentTool?: {
		name: string;
		blastRadius?: ToolBlastRadius;
		idempotencyKey?: string;
	};
}

const turnExtras = new WeakMap<object, TurnExtras>();

export function setCurrentTool(
	turnCtxObj: object,
	tool: TurnExtras["currentTool"] | undefined,
): void {
	const extras = turnExtras.get(turnCtxObj) ?? {};
	extras.currentTool = tool;
	turnExtras.set(turnCtxObj, extras);
}

function readAutoFields(): AutoFields | null {
	const turn = currentTurn.getStore();
	if (!turn) return null;
	const extras = turnExtras.get(turn) ?? {};
	const subject = turn.subject;
	return {
		turnId: turn.id,
		customerId:
			subject.kind === "account"
				? subject.accountId
				: (subject as { accountId?: string }).accountId,
		taskId: subject.kind === "task" ? subject.taskId : undefined,
		renewalId: subject.kind === "renewal" ? subject.renewalId : undefined,
		situationId: turn.situationId,
		toolName: extras.currentTool?.name,
		blastRadius: extras.currentTool?.blastRadius,
		idempotencyKey: extras.currentTool?.idempotencyKey,
	};
}

/**
 * Wraps an ActionLedger so every `record()` call inside a turn auto-inherits
 * the turn's subject, the executing tool, and (for notify) the harness-
 * computed idempotency key. The agent / tool code does not know — it just
 * calls ctx.ledger.record({ summary, reason, status, ... }) as before.
 *
 * Out-of-turn calls (dispatcher, brain loop, etc.) pass through unchanged.
 *
 * Design note: we do NOT override caller-provided values. If a tool
 * deliberately passes a customerId (e.g. from a parameter the harness can't
 * see — like `business_id` differing from the turn's account), that wins. The
 * harness only fills BLANKS.
 */
export function wrapLedgerForHarness(ledger: ActionLedger): ActionLedger {
	return {
		record: async (entry) => {
			const auto = readAutoFields();
			if (!auto) return ledger.record(entry);
			return ledger.record({
				...entry,
				customerId: entry.customerId ?? auto.customerId ?? "unknown",
				taskId: entry.taskId ?? auto.taskId,
				renewalId: entry.renewalId ?? auto.renewalId,
				situationId: entry.situationId ?? auto.situationId,
				turnId: entry.turnId ?? auto.turnId,
				toolName: entry.toolName ?? auto.toolName,
				blastRadius: entry.blastRadius ?? auto.blastRadius,
				idempotencyKey: entry.idempotencyKey ?? auto.idempotencyKey,
			});
		},
		update: (id, patch) => ledger.update(id, patch),
		get: (id) => ledger.get(id),
		listByWindow: (since, until) => ledger.listByWindow(since, until),
		listDue: (now) => ledger.listDue(now),
		listOpen: () => ledger.listOpen(),
		listBySituation: (sid) => ledger.listBySituation(sid),
		listRecentByCustomer: (cid, limit) => ledger.listRecentByCustomer(cid, limit),
		claimForDispatch: (id, now, workerId) => ledger.claimForDispatch(id, now, workerId),
		hasOpenWork: (cid, tid) => ledger.hasOpenWork(cid, tid),
		countByTurn: (tid) => ledger.countByTurn(tid),
	};
}

/**
 * Re-export the entry type so callers in this folder don't need a second import.
 */
export type { ActionLedgerEntry, ToolDefinition };
