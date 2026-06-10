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
	"Decide whether anything actually needs doing. A steady account with NO material change needs NO action — don't log a 'reviewed, all good' note; just say no action is needed. But a notable ADVERSE signal — usage trending down, a health drop, a renewal approaching — IS worth acting on (log it and watch) even when the account still looks healthy overall. The line is change/risk, not the headline health number.",
	"",
	"If something warrants it, pick the band and CALL ITS TOOL:",
	"- act — a real, reversible, low-stakes observation worth recording and watching (e.g. usage trending down on an otherwise healthy account). If you record it as a CSP note or renewal update, that write IS the Act (recorded automatically) — don't also call the `act` tool for it. The `act` tool is only for OTHER verifiable work and requires evidence {kind, id} citing the artifact you created (e.g. the instinct id memory_instinct returns).",
	"- notify_then_send_to_customer — routine customer-facing touch (heads-up to CSM first).",
	"- escalate — genuinely high-stakes/irreversible/ambiguous; brief the CSM with situation + options + recommendation.",
	"- prep — finished v1 artifact for a CSM-owned conversation.",
	"",
	"",
	"Follow through on your own past work (the Recent agent actions block, when present): chase a customer touch that got no response, address a FAILED action (retry, or escalate if it keeps failing), close a Situation whose signal has recovered — and NEVER queue a touch that duplicates one already in flight.",
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

/**
 * Task-band guidance — the action-policy menu framed for a single CSM task.
 *
 * A task is the unit of CSM work on Cerebro. The agent works it end-to-end:
 * pick the band, do the work via that band's tool, then close the task with
 * task_complete (or task_block if it can't be finished autonomously). The key
 * rule is the "agent not assistant" bright line: don't draft and wait — Act and
 * Notify-then-act finish the task; only genuinely high-stakes/irreversible work
 * routes to Escalate, where the task stays open until the CSM decides.
 */
export const TASK_GUIDANCE = [
	"This is a task from the CSM's Cerebro queue — work it end-to-end like a human CSM would.",
	"",
	"1. Understand the task (and, when it names an account, weigh the Decision signals above / fetch fresh detail with the csp_* tools).",
	"2. Pick the band and CALL ITS TOOL to do the work:",
	"   - act — reversible, low-stakes work you can just do (log a CSP note, record an observation). The note IS the Act.",
	"   - notify_then_send_to_customer — routine customer touch (renewal nudge, check-in); heads-up to the CSM first, send after the pause window.",
	"   - escalate — high-stakes/irreversible/ambiguous (discount, churn save, contract change); brief the CSM with situation + options + recommendation. DOES NOT touch the customer.",
	"   - prep — ship a finished v1 artifact for a CSM-owned conversation (renewal brief, pre-call brief).",
	"3. Close the loop on the task:",
	"   - If you finished the work (act / notify / prep), call task_complete with a one-line result and the band you used.",
	"   - If the task lists required structured fields (e.g. renewalSignal) or requires an activity, you MUST pass `custom_fields` and `activity` to task_complete — the backend rejects the close otherwise. Base the field values on the account's real signals, not a guess.",
	"   - If it needs the CSM's decision (you escalated) or you're blocked, call task_block — leave the open decision with the CSM, don't mark it done.",
	"",
	"Don't draft and wait — that's the bug, not the feature. Finish what you can; escalate what you must.",
].join("\n");

/**
 * Renewal-band guidance — the action-policy menu framed for a single renewal.
 *
 * A Renewal is the commercial object (Renewal → CTA → Task). The renewal sweep
 * works the renewal itself on its timeline. Coordinate with task work through
 * the shared renewal-risk Situation: don't repeat a step a task already owns,
 * but DO act on renewal-level work no task covers, and open/advance the
 * renewal-risk Situation so the storyline is one thread.
 */
export const RENEWAL_GUIDANCE = [
	"This is a renewal from the CSM's portfolio — work it on the renewal timeline like a human CSM.",
	"",
	"1. First read the open situations above. If a renewal-risk Situation for THIS renewal is already in flight, advance it — don't re-discover. Otherwise open one (situation_open, kind 'renewal-risk', pass renewal_id) when the renewal warrants tracking.",
	"2. Advance the RENEWAL'S OWN status/playbook with csp_update_renewal when a transition is warranted. This is the renewal level — it is NOT a task; do not write task status here.",
	"3. If a step is already owned by an open task, leave it to the task sweep — don't double-work. Act only on renewal-level work no task covers.",
	"4. Pick the band and CALL ITS TOOL (pass renewal_id / situation_id so the action joins the storyline):",
	"   - act — reversible renewal-level observation/update (a CSP note, a renewal status nudge).",
	"   - notify_then_send_to_customer — routine renewal nudge to the customer (heads-up to CSM first).",
	"   - escalate — commercial concession / discount / churn save / contract change; brief the CSM.",
	"   - prep — a finished renewal brief for a CSM-owned conversation.",
	"",
	"If the renewal is steady and nothing needs doing, don't call any tool — just say so.",
].join("\n");
