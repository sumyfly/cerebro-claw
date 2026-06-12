import type { RenewalRecord, RenewalSource } from "@cerebro-claw/shared";

/**
 * CspRenewalSource — binds the pluggable RenewalSource to CSP's real renewal
 * API. CSP exposes renewals ONLY per account (GET /accounts/:id/renewals),
 * with no portfolio-wide endpoint — so per decision D6, listOpen() derives its
 * queue by iterating the CSM's accounts and collecting renewals that are within
 * a due-window (RENEWAL_WINDOW_DAYS, default 90) or already flagged at-risk.
 *
 * Write-back is NOT here: the agent advances a renewal through the existing
 * renewal-writeback tool (csp_update_renewal), so this source is read-only.
 */
export interface CspRenewalSourceOptions {
	baseUrl: string;
	token: string;
	csmEmail: string;
	timeoutMs?: number;
	/** Max accounts scanned per cycle. */
	maxAccounts?: number;
	/** Only include renewals due within this many days (or at-risk regardless). Default 90. */
	windowDays?: number;
	/** Clock override (tests). */
	now?: () => Date;
}

/**
 * Field names that match CSP's real response (per the live API probe):
 *   - `renewalPeriodEnd`  ISO date the contract period ends.
 *   - `currentMrr`        monthly recurring revenue; ARR = currentMrr × 12.
 *   - `probability`       deal probability 0-100 (or null); low values flag risk.
 *   - `status`            NOT_STARTED | IN_PROGRESS | CLOSED_WON | CLOSED_LOST | ...
 *
 * There's no `atRisk` boolean — we derive it from `probability` (≤ 30 = at risk)
 * since the engineered triage score cares about that signal.
 */
interface CspRenewalRow {
	id?: string;
	businessId?: string;
	businessName?: string;
	status?: string;
	renewalPeriodEnd?: string;
	currentMrr?: number;
	probability?: number | null;
	[k: string]: unknown;
}

/** Renewals in these statuses are still open work. Closed/lost are done. */
const OPEN_RENEWAL_STATUSES = new Set([
	"NOT_STARTED",
	"IN_PROGRESS",
	"AT_RISK",
	"NEGOTIATING",
	"PENDING",
]);

const AT_RISK_PROBABILITY_THRESHOLD = 30;

/**
 * Pull the renewal array out of the `/accounts/:id/renewals` response. CSP
 * wraps it as `{renewals: [...], total, page, pageSize, hasMore}`. Tolerate
 * a bare-array response too (older / mocked variants) so the sweep stays
 * robust to upstream shape drift.
 */
function extractRenewalRows(payload: unknown): CspRenewalRow[] {
	if (Array.isArray(payload)) return payload as CspRenewalRow[];
	if (payload && typeof payload === "object") {
		const wrapped = (payload as { renewals?: unknown }).renewals;
		if (Array.isArray(wrapped)) return wrapped as CspRenewalRow[];
	}
	return [];
}

export function createCspRenewalSource(opts: CspRenewalSourceOptions): RenewalSource {
	const baseUrl = opts.baseUrl.replace(/\/$/, "");
	const timeoutMs = opts.timeoutMs ?? 10_000;
	const maxAccounts = opts.maxAccounts ?? 25;
	const windowDays = opts.windowDays ?? 90;
	const clock = () => opts.now?.() ?? new Date();

	async function getData<T = Record<string, unknown>>(path: string): Promise<T | undefined> {
		const ac = new AbortController();
		const t = setTimeout(() => ac.abort(), timeoutMs);
		try {
			const res = await fetch(`${baseUrl}${path}`, {
				headers: { Authorization: `Bearer ${opts.token}`, Accept: "application/json" },
				signal: ac.signal,
			});
			if (!res.ok) return undefined;
			const body = (await res.json()) as { data?: unknown };
			return body.data as T;
		} catch {
			return undefined;
		} finally {
			clearTimeout(t);
		}
	}

	function toRecord(row: CspRenewalRow, accountName?: string): RenewalRecord {
		const renewalDate = row.renewalPeriodEnd ? new Date(row.renewalPeriodEnd) : undefined;
		const daysToRenewal = renewalDate
			? Math.round((renewalDate.getTime() - clock().getTime()) / 86_400_000)
			: undefined;
		// ARR derived from MRR — CSP stores monthly only on the renewal record.
		const arr = typeof row.currentMrr === "number" ? row.currentMrr * 12 : undefined;
		// At-risk = low probability OR overdue (past the renewal date).
		const atRisk =
			(typeof row.probability === "number" && row.probability <= AT_RISK_PROBABILITY_THRESHOLD) ||
			(daysToRenewal != null && daysToRenewal < 0);
		return {
			id: String(row.id),
			businessId: String(row.businessId ?? ""),
			customerName: accountName ?? (typeof row.businessName === "string" ? row.businessName : undefined),
			status: row.status,
			renewalDate,
			daysToRenewal,
			arr,
			atRisk,
			raw: row,
		};
	}

	/** In-window when at-risk regardless of date, or due within windowDays (and not already past long ago). */
	function inWindow(r: RenewalRecord): boolean {
		if (r.atRisk) return true;
		if (r.daysToRenewal == null) return false;
		return r.daysToRenewal <= windowDays;
	}

	return {
		label: `CSP renewals (${opts.csmEmail}, window ${windowDays}d)`,
		async listOpen(): Promise<RenewalRecord[]> {
			const accounts =
				(await getData<{ id: string; name: string }[]>(
					`/api/v1/accounts?assignedCsmId=${encodeURIComponent(opts.csmEmail)}&limit=${maxAccounts}`,
				)) ?? [];
			const out: RenewalRecord[] = [];
			for (const a of accounts) {
				// CSP returns the renewals endpoint as a paginated wrapper:
				//   { data: { renewals: [...], total, page, pageSize, hasMore } }
				// not a bare array. Pull the array out; tolerate either shape so a
				// future API tweak (or a different endpoint shape elsewhere) doesn't
				// silently break the sweep.
				const payload = await getData<unknown>(`/api/v1/accounts/${a.id}/renewals`);
				const rows = extractRenewalRows(payload);
				for (const row of rows) {
					if (!row.id) continue;
					// Drop terminally-closed renewals — CLOSED_WON / CLOSED_LOST are
					// done work, not open work; surfacing them would re-action a
					// completed renewal. Allowlist matches CSP's known open statuses.
					if (row.status && !OPEN_RENEWAL_STATUSES.has(row.status)) continue;
					const rec = toRecord({ ...row, businessId: row.businessId ?? a.id }, a.name);
					if (inWindow(rec)) out.push(rec);
				}
			}
			return out;
		},
		async getContext(id: string): Promise<RenewalRecord | null> {
			const row = await getData<CspRenewalRow>(`/api/v1/renewals/${id}`);
			return row?.id ? toRecord(row) : null;
		},
	};
}
