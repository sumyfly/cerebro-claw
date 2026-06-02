import type { ActionLedger } from "@cerebro-claw/shared";

/**
 * MCP tool-call observer that keeps the action ledger honest.
 *
 * The agent's Act-band work is supposed to land in the ledger via the `act`
 * tool, but the model sometimes logs a team-visible CSP note (csp_create_note)
 * directly without also calling `act`. Since the claude-code runtime reports
 * toolCalls:[], the server would otherwise never see that work and the daily
 * digest would undercount. This observer records an implicit Act for such a
 * note — deduped so it never double-counts when a band tool already fired for
 * the same customer in the same review.
 */
const DEDUP_WINDOW_MS = 2 * 60 * 1000;

export function createActionObserver(ledger: ActionLedger, now: () => Date = () => new Date()) {
	return async (
		name: string,
		params: Record<string, unknown>,
		result: { success: boolean },
	): Promise<void> => {
		if (!result.success) return;
		if (name !== "csp_create_note") return;
		const customerId = String(params.business_id ?? params.customer_id ?? "");
		if (!customerId) return;

		// Dedup: if any band entry for this customer already exists in the recent
		// window (an explicit act/notify/escalate/prep, or a prior auto-note),
		// don't add another — the explicit record wins and one note ≠ many acts.
		// Symmetric window so an explicit band entry recorded at the same instant
		// (same review turn) is seen regardless of listByWindow boundary handling.
		const t = now();
		const recent = await ledger.listByWindow(
			new Date(t.getTime() - DEDUP_WINDOW_MS),
			new Date(t.getTime() + DEDUP_WINDOW_MS),
		);
		if (recent.some((e) => e.customerId === customerId)) return;

		await ledger.record({
			band: "act",
			customerId,
			summary: "Logged a CSP note",
			reason: "csp_create_note (observed; recorded so the digest reflects the work)",
			status: "done",
			createdAt: t,
			executedAt: t,
		});
	};
}
