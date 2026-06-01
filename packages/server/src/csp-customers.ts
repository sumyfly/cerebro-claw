/**
 * CSP-backed customer reader for the admin UI.
 *
 * The dashboard's Customers tab reads live from CSP — the source of truth for
 * accounts, health, engagement, and renewals — instead of a local seed store.
 * Agent-private data (history, instinct notes) still comes from the local DB;
 * this module only produces the profile + state the UI renders.
 *
 * Mirrors the plain-`fetch` approach used by the brain loop's CSP account
 * source, so TLS/auth behave identically to the existing CSP integration.
 *
 * Response shapes (verified live against cspapi.test.shub.us):
 *   GET /accounts?assignedCsmId= -> { data: [{ id, name, plan, healthScore, mrr, ... }], pagination }
 *   GET /accounts/:id            -> { data: { id, name, size, plan, contacts[], businessMetrics:{mrr}, assignedCsmName, ... } }
 *   GET /accounts/:id/health-score -> { data: { revenue, merchant, product, relationship, overall:{ score, category } } }
 *   GET /accounts/:id/engagement -> { data: [{ last_seen, ... }] }
 *   GET /accounts/:id/renewals   -> { data: { renewals: [...] } }
 */

export interface CspReaderConfig {
	baseUrl: string;
	token: string;
	csmEmail: string;
	timeoutMs: number;
}

/** Returns reader config when CSP is wired up, otherwise null (UI falls back to the local store). */
export function cspReaderFromEnv(): CspReaderConfig | null {
	const token = process.env.CSP_TOKEN;
	const csmEmail = process.env.CSP_CSM_EMAIL;
	if (!token || !csmEmail) return null;
	return {
		baseUrl: (process.env.CSP_BASE_URL ?? "http://localhost:5656").replace(/\/$/, ""),
		token,
		csmEmail,
		timeoutMs: Number(process.env.CSP_TIMEOUT_MS ?? 10_000),
	};
}

// Shapes the web Customers page renders. `health` is a free string so an
// unrecognized CSP category degrades to "unknown" in the UI rather than lying.
export interface CustomerSummaryView {
	profile: { id: string; companyName: string; plan?: string };
	state: { health: string; openIssues: number; usageTrend: string } | null;
}

export interface CustomerProfileView {
	id: string;
	companyName: string;
	companySize?: string;
	plan?: string;
	contractValue?: number;
	contacts: { name: string; role: string; email?: string; isDecisionMaker: boolean }[];
	csmOwnerId: string;
}

export interface CustomerStateView {
	health: string;
	openIssues: number;
	usageTrend: string;
	lastContactDate?: string;
	renewalDate?: string;
}

// biome-ignore lint/suspicious/noExplicitAny: CSP payloads are external, untyped JSON.
type Json = any;

/** GET a CSP endpoint and return its `data` envelope, or null on any failure. */
async function cspGet(cfg: CspReaderConfig, path: string): Promise<Json | null> {
	const ac = new AbortController();
	const t = setTimeout(() => ac.abort(), cfg.timeoutMs);
	try {
		const res = await fetch(`${cfg.baseUrl}/api/v1${path}`, {
			headers: { Authorization: `Bearer ${cfg.token}`, Accept: "application/json" },
			signal: ac.signal,
		});
		if (!res.ok) {
			console.error(`[csp-customers] ${path} -> HTTP ${res.status}`);
			return null;
		}
		const body = (await res.json()) as { data?: Json };
		return body?.data ?? null;
	} catch (err) {
		console.error(`[csp-customers] ${path} error: ${(err as Error).message}`);
		return null;
	} finally {
		clearTimeout(t);
	}
}

/** Map a 0-100 score and/or a CSP category label to the UI's health vocabulary. */
function mapHealth(score: number | undefined, category?: string): string {
	if (category) {
		const c = category.toUpperCase();
		if (["EXCELLENT", "GOOD", "HEALTHY"].includes(c)) return "good";
		if (["CRITICAL", "POOR", "CHURN", "CHURN_RISK"].includes(c)) return "critical";
		if (c.includes("RISK") || ["MODERATE", "FAIR", "WARNING"].includes(c)) return "at-risk";
	}
	if (typeof score === "number") {
		if (score >= 67) return "good";
		if (score < 34) return "critical";
		return "at-risk";
	}
	return "unknown";
}

/** Average all "...Trend" components in the health score and bucket into up/flat/dropping. */
function trendFromHealthScore(hs: Json | null): string {
	if (!hs) return "flat";
	const comps: Json[] = [];
	for (const key of Object.keys(hs)) {
		const section = hs[key];
		if (section && Array.isArray(section.components)) comps.push(...section.components);
	}
	const trends = comps.filter((c) => /trend/i.test(String(c?.name ?? "")));
	let sum = 0;
	let n = 0;
	for (const c of trends) {
		const m = String(c?.value ?? "").match(/-?\d+(\.\d+)?/);
		if (m) {
			sum += Number(m[0]);
			n++;
		}
	}
	if (n === 0) return "flat";
	const avg = sum / n;
	if (avg <= -5) return "dropping";
	if (avg >= 5) return "up";
	return "flat";
}

/** Pull the open support-item count from the relationship "Support Volume" driver. */
function openIssuesFromHealthScore(hs: Json | null): number {
	const components: Json[] = hs?.relationship?.components ?? [];
	const support = components.find((c) => /support volume/i.test(String(c?.name ?? "")));
	const m = String(support?.value ?? "").match(/\d+/);
	return m ? Number(m[0]) : 0;
}

/** Most recent login across all engagement rows — a real "last activity" signal. */
function lastSeenFromEngagement(engagement: Json | null): string | undefined {
	if (!Array.isArray(engagement) || engagement.length === 0) return undefined;
	const times = engagement
		.map((e) => Date.parse(String(e?.last_seen ?? "")))
		.filter((n) => !Number.isNaN(n));
	if (times.length === 0) return undefined;
	return new Date(Math.max(...times)).toISOString();
}

/** Earliest renewal date among common field names, if any renewal exists. */
function nextRenewalDate(renewals: Json | null): string | undefined {
	const list: Json[] = Array.isArray(renewals) ? renewals : (renewals?.renewals ?? []);
	if (!Array.isArray(list) || list.length === 0) return undefined;
	const dates = list
		.map((r) => r?.renewalDate ?? r?.date ?? r?.dueDate ?? r?.contractEndDate ?? r?.expiryDate)
		.filter(Boolean)
		.map((d) => String(d))
		.sort();
	if (dates.length === 0) return undefined;
	const parsed = Date.parse(dates[0]);
	return Number.isNaN(parsed) ? undefined : new Date(parsed).toISOString();
}

/** List the CSM's accounts from CSP as UI summaries. Health is inlined per account. */
export async function listCspSummaries(
	cfg: CspReaderConfig,
	limit: number,
): Promise<CustomerSummaryView[]> {
	const qs = new URLSearchParams();
	qs.set("assignedCsmId", cfg.csmEmail);
	qs.set("limit", String(limit));
	const data = await cspGet(cfg, `/accounts?${qs}`);
	if (!Array.isArray(data)) return [];
	return data.map((a: Json) => {
		const score = a?.healthScore ?? a?.healthScores?.[0]?.overallScore;
		return {
			profile: {
				id: String(a.id),
				companyName: String(a.name ?? a.companyName ?? a.id),
				plan: a.plan,
			},
			state: { health: mapHealth(score), openIssues: 0, usageTrend: "flat" },
		};
	});
}

/**
 * Build the profile + state for one account from CSP (account + health + engagement + renewals,
 * fetched in parallel). Returns null if the account isn't found in CSP.
 */
export async function getCspDetail(
	cfg: CspReaderConfig,
	id: string,
): Promise<{ profile: CustomerProfileView; state: CustomerStateView } | null> {
	const [acct, hs, engagement, renewals] = await Promise.all([
		cspGet(cfg, `/accounts/${id}`),
		cspGet(cfg, `/accounts/${id}/health-score`),
		cspGet(cfg, `/accounts/${id}/engagement`),
		cspGet(cfg, `/accounts/${id}/renewals?pageSize=5`),
	]);
	if (!acct) return null;

	const mrr = acct?.businessMetrics?.mrr;
	const employees = acct?.contactsStructure?.summary?.totalEmployees;
	const profile: CustomerProfileView = {
		id: String(acct.id),
		companyName: String(acct.name ?? acct.id),
		companySize: acct.size ?? (employees ? `${employees} employees` : undefined),
		plan: acct.plan,
		contractValue: typeof mrr === "number" ? Math.round(mrr * 12) : undefined,
		contacts: Array.isArray(acct.contacts)
			? acct.contacts.map((c: Json) => ({
					name: String(c?.name ?? ""),
					role: String(c?.role ?? ""),
					email: c?.email || undefined,
					isDecisionMaker: Boolean(c?.isDecisionMaker),
				}))
			: [],
		csmOwnerId: String(acct.assignedCsmName ?? acct.assignedCsmEmail ?? "—"),
	};

	const overall = hs?.overall;
	const state: CustomerStateView = {
		health: mapHealth(overall?.score, overall?.category),
		openIssues: openIssuesFromHealthScore(hs),
		usageTrend: trendFromHealthScore(hs),
		lastContactDate: lastSeenFromEngagement(engagement) ?? acct.updatedAt ?? acct.createdAt,
		renewalDate: nextRenewalDate(renewals),
	};

	return { profile, state };
}
