import type { RenewalRecord } from "@cerebro-claw/shared";

/**
 * Render a renewal into a prompt context block for the renewal sweep. Mirrors
 * renderTaskContext/renderDecisionContext — states the salient renewal facts;
 * the agent makes the judgment. Open situations for the account are appended
 * separately by the work loop.
 */
export function renderRenewalContext(r: RenewalRecord): string {
	const lines: string[] = ["# Renewal (work this on its timeline)"];
	lines.push(`- Renewal id: ${r.id}`);
	lines.push(`- Account: ${r.customerName ?? r.businessId} (business id: ${r.businessId})`);
	if (r.status) lines.push(`- Renewal status: ${r.status}`);
	if (r.daysToRenewal != null) {
		lines.push(`- ${r.daysToRenewal} day(s) to renewal${r.daysToRenewal < 0 ? " (OVERDUE)" : ""}`);
	}
	if (r.arr != null) lines.push(`- ARR: $${r.arr.toLocaleString()}/yr`);
	if (r.atRisk) lines.push("- ⚠️ Flagged AT RISK");
	lines.push(
		"",
		"This is the RENEWAL level (Renewal → CTA → Task). Advance the renewal's own status with csp_update_renewal; do NOT write task status here. Fetch fresh detail with csp_get_renewal / csp_get_account / csp_get_health_score as needed.",
	);
	return lines.join("\n");
}
