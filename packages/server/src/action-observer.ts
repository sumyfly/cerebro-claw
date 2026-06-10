import type { ActionLedger } from "@cerebro-claw/shared";

/**
 * MCP tool-call observer that keeps the action ledger honest.
 *
 * The agent's Act-band work is supposed to land in the ledger via the `act`
 * tool, but the model sometimes performs the real CSP write (csp_create_note,
 * csp_update_renewal) directly without also calling `act`. Since the
 * claude-code runtime reports toolCalls:[], the server would otherwise never
 * see that work and the daily digest would undercount. This observer records
 * an implicit Act for such a write — carrying the CSP object id as evidence,
 * and deduped so it never double-counts when a band tool already fired for
 * the same customer in the same review.
 */
const DEDUP_WINDOW_MS = 2 * 60 * 1000;

/** The CSP write-back tools whose successful calls are auto-ledgered. */
const OBSERVED_WRITES: Record<string, { kind: "note" | "renewal"; summary: string }> = {
	csp_create_note: { kind: "note", summary: "Logged a CSP note" },
	csp_update_renewal: { kind: "renewal", summary: "Advanced a CSP renewal" },
};

/** Best-effort extraction of the created object's id from the tool result content. */
function extractObjectId(name: string, params: Record<string, unknown>, content?: string): string {
	// Renewal updates carry the id in the params — no parsing needed.
	if (name === "csp_update_renewal" && params.renewal_id) return String(params.renewal_id);
	// Note creation echoes the CSP response JSON; pull the first "id" field.
	const m = content?.match(/"id"\s*:\s*"([^"]+)"/);
	return m?.[1] ?? "unknown";
}

/**
 * Best-effort extraction of the account's business id from the echoed CSP
 * response (csp_update_renewal takes only a renewal UUID, but the updated
 * renewal record it echoes carries its businessId). Keying the ledger entry by
 * business id keeps it joinable with explicit band entries and visible to
 * listRecentByCustomer (the closed-loop context block).
 */
function extractBusinessId(content?: string): string {
	const m = content?.match(/"businessId"\s*:\s*"([a-f\d]{24})"/i);
	return m?.[1] ?? "";
}

export function createActionObserver(ledger: ActionLedger, now: () => Date = () => new Date()) {
	return async (
		name: string,
		params: Record<string, unknown>,
		result: { content?: string; success: boolean },
	): Promise<void> => {
		if (!result.success) return;
		const observed = OBSERVED_WRITES[name];
		if (!observed) return;
		const renewalId = params.renewal_id ? String(params.renewal_id) : "";
		const customerId =
			String(params.business_id ?? params.customer_id ?? "") || extractBusinessId(result.content);
		// Last resort: key by the renewal UUID so the entry still lands somewhere
		// joinable (its renewal_id column is set either way).
		const subjectId = customerId || renewalId;
		if (!subjectId) return;

		// Dedup: if any band entry for this customer (or this renewal) already
		// exists in the recent window (an explicit act/notify/escalate/prep, or a
		// prior auto-record), don't add another — the explicit record wins and one
		// write ≠ many acts. Symmetric window so an explicit band entry recorded
		// at the same instant (same review turn) is seen regardless of
		// listByWindow boundary handling.
		const t = now();
		const recent = await ledger.listByWindow(
			new Date(t.getTime() - DEDUP_WINDOW_MS),
			new Date(t.getTime() + DEDUP_WINDOW_MS),
		);
		const seen = recent.some(
			(e) => e.customerId === subjectId || (renewalId !== "" && e.renewalId === renewalId),
		);
		if (seen) return;

		const evidence = { kind: observed.kind, id: extractObjectId(name, params, result.content) };
		await ledger.record({
			band: "act",
			customerId: subjectId,
			summary: observed.summary,
			reason: `${name} (observed; recorded so the digest reflects the work)`,
			status: "done",
			createdAt: t,
			executedAt: t,
			payload: { evidence },
			...(renewalId ? { renewalId } : {}),
		});
	};
}
