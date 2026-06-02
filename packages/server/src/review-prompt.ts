/**
 * Single source of truth for the per-account review instruction.
 *
 * This is the text that drives the agent's band choice — the thing the eval
 * measures. It MUST be identical between the production brain loop and the eval
 * runners, or a green eval would validate a different prompt than production
 * runs. Everything (brain-loop CSP source, run/live/portfolio) builds from here.
 */

/** The action-policy band menu + the "call the tool, don't draft" instruction. */
export const BAND_GUIDANCE = [
	"Pick the right band and CALL ITS TOOL so the work is recorded:",
	"- act — reversible, low-stakes, fact-based (log + watch). Don't escalate routine observations. Note: logging a CSP note IS your Act — it's recorded automatically, so don't also call the `act` tool for the same note (use `act` only for non-note observations like an instinct).",
	"- notify_then_send_to_customer — routine customer-facing touch (heads-up to CSM first).",
	"- escalate — genuinely high-stakes/irreversible/ambiguous; brief the CSM with situation + options + recommendation.",
	"- prep — finished v1 artifact for a CSM-owned conversation.",
	"",
	"If nothing needs doing, do not call any tool — just say so. Don't draft and wait — that's the bug, not the feature.",
].join("\n");

/**
 * The pointer block appended after the computed Decision-signals context, used
 * by the brain-loop CSP source's buildSummary. The band menu is NOT included —
 * the caller (evaluateCustomer, or a runner's user message) adds BAND_GUIDANCE
 * once so it's never listed twice.
 */
export function reviewPointer(name: string, id: string): string {
	return [
		`You are reviewing customer "${name}" (CSP business id: ${id}).`,
		"",
		"The Decision signals above are computed from live CSP data + memory. You may also fetch fresh detail with csp_get_account, csp_get_health_score, csp_get_engagement, csp_get_notes, csp_get_renewals.",
	].join("\n");
}

/**
 * The one-shot user message the eval runners send (the Decision-signals block is
 * passed separately as context).
 */
export function reviewMessage(name: string, id: string): string {
	return [
		`Review customer "${name}" (CSP business id: ${id}) now. Weigh the Decision signals above, optionally fetch fresh detail with the csp_* tools, then act.`,
		"",
		BAND_GUIDANCE,
	].join("\n");
}
