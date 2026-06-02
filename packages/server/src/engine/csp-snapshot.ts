import type { AccountSnapshot } from "./signals.js";

/**
 * Map the REAL CSP response shapes into the engine's AccountSnapshot.
 *
 * Shapes (verified against cspapi.test.shub.us):
 *  - account.data.businessMetrics: { mrr, renewalDate, transactionMetrics.breakdown
 *    (pos/qrdinein/beepdelivery/ecom _count_past7days/_past30days) }
 *  - health-score.data.overall: { score, category }   (no grade/trend field)
 *  - engagement.data: array of user sessions with last_seen
 *
 * The earlier fixtures used a made-up flat shape ({overallScore,grade,trend},
 * {logins30d,trend}); this mapper is what makes the engine actually work on live
 * Cerebro data. Usage trend is DERIVED from the 7d-vs-30d transaction run-rate.
 */
export interface CspRaw {
	account?: Record<string, unknown>;
	health?: Record<string, unknown>;
	engagement?: unknown;
}

const TXN_CHANNELS = ["pos", "qrdinein", "beepdelivery", "ecom"] as const;
const DAY_MS = 24 * 60 * 60 * 1000;

function num(v: unknown): number {
	return typeof v === "number" && Number.isFinite(v) ? v : 0;
}

/** Sum a window's transaction counts across channels from the breakdown map. */
function txnCount(
	breakdown: Record<string, unknown> | undefined,
	window: "7days" | "30days",
): number {
	if (!breakdown) return 0;
	let total = 0;
	for (const ch of TXN_CHANNELS) total += num(breakdown[`${ch}_txn_count_past${window}`]);
	return total;
}

/** up / down / flat from 7d run-rate vs the 30d weekly average (±10% band). */
export function deriveUsageTrend(
	breakdown: Record<string, unknown> | undefined,
): "up" | "down" | "flat" | undefined {
	if (!breakdown) return undefined;
	const past7 = txnCount(breakdown, "7days");
	const past30 = txnCount(breakdown, "30days");
	if (past30 === 0) return past7 > 0 ? "up" : undefined;
	const weeklyAvg30 = (past30 * 7) / 30;
	if (weeklyAvg30 === 0) return undefined;
	if (past7 >= weeklyAvg30 * 1.1) return "up";
	if (past7 <= weeklyAvg30 * 0.9) return "down";
	return "flat";
}

export function cspToSnapshot(raw: CspRaw, now: Date): AccountSnapshot {
	const account = raw.account ?? {};
	const bm = (account.businessMetrics ?? {}) as Record<string, unknown>;
	const txnBreakdown = ((bm.transactionMetrics as Record<string, unknown> | undefined)?.breakdown ??
		undefined) as Record<string, unknown> | undefined;

	const overall = ((raw.health ?? {}).overall ?? {}) as Record<string, unknown>;

	// logins-ish magnitude: distinct users seen in the last 30 days.
	let logins30d: number | undefined;
	if (Array.isArray(raw.engagement)) {
		const cutoff = now.getTime() - 30 * DAY_MS;
		logins30d = (raw.engagement as Array<{ last_seen?: string }>).filter((u) => {
			const t = u.last_seen ? Date.parse(u.last_seen) : Number.NaN;
			return !Number.isNaN(t) && t >= cutoff;
		}).length;
	}

	const mrr = num(bm.mrr);
	const renewalDate = typeof bm.renewalDate === "string" ? bm.renewalDate : undefined;

	return {
		account: {
			id: typeof account.id === "string" ? account.id : undefined,
			name: typeof account.name === "string" ? account.name : undefined,
			plan: typeof account.plan === "string" ? account.plan : undefined,
			contractValue: mrr > 0 ? Math.round(mrr * 12) : undefined,
		},
		healthScore: {
			overallScore: typeof overall.score === "number" ? overall.score : undefined,
			grade: typeof overall.category === "string" ? overall.category : undefined,
			// CSP exposes no top-level health TREND; left undefined (honest).
			trend: undefined,
		},
		engagement: { logins30d, trend: deriveUsageTrend(txnBreakdown) },
		renewals: renewalDate ? [{ renewalDate, status: "OPEN" }] : undefined,
		now,
	};
}
