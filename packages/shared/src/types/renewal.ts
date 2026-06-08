/**
 * RenewalSource — the agent's view of the CSM's upcoming/at-risk renewals as a
 * first-class input, swept directly (not only reached via an account or task).
 *
 * Domain hierarchy: Renewal → CTA → Task. A Renewal is the commercial object; a
 * task is a CTA sub-step that carries `cta.renewalId`. The renewal sweep works
 * the renewal itself; write-back reuses the renewal-writeback tools
 * (csp_update_renewal), so this source only needs read access.
 *
 * Implementations keep `listOpen`/`getContext` side-effect free.
 */

export interface RenewalRecord {
	/** Renewal UUID. */
	id: string;
	/** Account this renewal belongs to (CSP business id). */
	businessId: string;
	/** Account name, for digest/UI lines. */
	customerName?: string;
	/** Renewal's own status (CSP renewal/playbook status — distinct from any task status). */
	status?: string;
	/** Renewal date, when known. */
	renewalDate?: Date;
	/** Days until the renewal (negative = overdue). */
	daysToRenewal?: number;
	/** Annual contract value, when known. */
	arr?: number;
	/** Whether CSP/our signals flag this renewal at risk. */
	atRisk?: boolean;
	/** Raw backend payload for the agent's context. */
	raw?: Record<string, unknown>;
}

export interface RenewalSource {
	/** Short label for logs/banners. */
	label: string;
	/** List the CSM's open (upcoming or at-risk) renewals. Side-effect free. */
	listOpen(): Promise<RenewalRecord[]>;
	/** Fetch a single renewal's full context by id. Null if not found. */
	getContext(id: string): Promise<RenewalRecord | null>;
}
