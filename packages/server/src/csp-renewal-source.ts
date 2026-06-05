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

interface CspRenewalRow {
	id?: string;
	businessId?: string;
	status?: string;
	renewalDate?: string;
	arr?: number;
	atRisk?: boolean;
	[k: string]: unknown;
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
		const renewalDate = row.renewalDate ? new Date(row.renewalDate) : undefined;
		const daysToRenewal = renewalDate
			? Math.round((renewalDate.getTime() - clock().getTime()) / 86_400_000)
			: undefined;
		return {
			id: String(row.id),
			businessId: String(row.businessId ?? ""),
			customerName: accountName,
			status: row.status,
			renewalDate,
			daysToRenewal,
			arr: typeof row.arr === "number" ? row.arr : undefined,
			atRisk: row.atRisk === true,
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
				const rows = (await getData<CspRenewalRow[]>(`/api/v1/accounts/${a.id}/renewals`)) ?? [];
				for (const row of rows) {
					if (!row.id) continue;
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
