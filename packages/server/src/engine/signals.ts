/**
 * Decision signals — the structured inputs a CSM weighs before acting.
 *
 * The "action policy" is hybrid: this module computes the salient signals in
 * code (deterministic, testable), and the agent (LLM) makes the band judgment
 * on top of them. That keeps the judgment flexible while making the inputs —
 * reversibility cues, ARR, renewal proximity, health movement, overrides — explicit
 * rather than buried in prose the model may or may not weigh.
 *
 * Pure: every time-relative value is computed against an injected `now`, so the
 * output is fully determined by the snapshot. No I/O, no Date.now().
 */

/** Raw, source-shaped account data (Cerebro/CSP-shaped) the agent sees. */
export interface AccountSnapshot {
	account?: {
		id?: string;
		name?: string;
		plan?: string;
		contractValue?: number;
		arr?: number;
	};
	healthScore?: { overallScore?: number; grade?: string; trend?: string };
	engagement?: { logins30d?: number; trend?: string };
	renewals?: Array<{ renewalDate?: string; status?: string; arr?: number }>;
	/** CSM instinct notes (agent-private memory). */
	instincts?: string[];
	/** Per-customer/per-CSM override rules. */
	overrides?: Array<{ rule: string; forcesBand?: string }>;
	/** Prior cycle's decision for this account (change detection). */
	lastDecision?: { signalFingerprint?: string; band?: string; reason?: string };
	/** ISO date of last customer contact. */
	lastContactDate?: string;
	/** Clock — injected for determinism. */
	now: Date;
}

export interface DecisionSignals {
	healthScore: number | null;
	healthGrade: string | null;
	healthTrend: string | null;
	usageTrend: string | null;
	logins30d: number | null;
	/** Days until the soonest open renewal (negative = overdue). */
	daysToRenewal: number | null;
	contractValue: number | null;
	daysSinceLastContact: number | null;
	hasOverride: boolean;
	/** If an override forces a minimum band, the band it forces (e.g. "escalate"). */
	overrideForcesBand: string | null;
	/** Stable digest of the salient signals — used for change detection. */
	signalFingerprint: string;
	/** True if this is the first look OR the fingerprint moved since last cycle. */
	changedSinceLastCycle: boolean;
	lastBand: string | null;
}

const DAY_MS = 24 * 60 * 60 * 1000;

function daysBetween(from: Date, toIso: string | undefined): number | null {
	if (!toIso) return null;
	const t = Date.parse(toIso);
	if (Number.isNaN(t)) return null;
	return Math.round((t - from.getTime()) / DAY_MS);
}

/** Soonest open (not closed) renewal date, if any. */
function soonestRenewalIso(snapshot: AccountSnapshot): string | undefined {
	const open = (snapshot.renewals ?? []).filter(
		(r) =>
			r.renewalDate &&
			!String(r.status ?? "")
				.toUpperCase()
				.startsWith("CLOSED"),
	);
	if (open.length === 0) return undefined;
	open.sort((a, b) => Date.parse(a.renewalDate ?? "") - Date.parse(b.renewalDate ?? ""));
	return open[0].renewalDate;
}

/** Bucket renewal proximity so small day-shifts don't churn the fingerprint. */
function renewalBucket(daysToRenewal: number | null): string {
	if (daysToRenewal === null) return "none";
	if (daysToRenewal < 0) return "overdue";
	if (daysToRenewal <= 7) return "week";
	if (daysToRenewal <= 30) return "month";
	if (daysToRenewal <= 90) return "quarter";
	return "far";
}

export function computeSignals(snapshot: AccountSnapshot): DecisionSignals {
	const health = snapshot.healthScore ?? {};
	const eng = snapshot.engagement ?? {};
	const renewalIso = soonestRenewalIso(snapshot);
	const daysToRenewal = daysBetween(snapshot.now, renewalIso);
	const daysSinceLastContact =
		snapshot.lastContactDate != null
			? -(daysBetween(snapshot.now, snapshot.lastContactDate) ?? 0)
			: null;

	const override = (snapshot.overrides ?? []).find((o) => o.forcesBand);
	const hasOverride = (snapshot.overrides ?? []).length > 0;
	const overrideForcesBand = override?.forcesBand ?? null;

	// Fingerprint uses BUCKETED / categorical signals only, so day-to-day noise
	// (a login here, one point of health) doesn't look like a real change.
	const signalFingerprint = [
		`grade:${health.grade ?? "?"}`,
		`htrend:${health.trend ?? "?"}`,
		`utrend:${eng.trend ?? "?"}`,
		`renewal:${renewalBucket(daysToRenewal)}`,
		`override:${overrideForcesBand ?? (hasOverride ? "yes" : "no")}`,
	].join("|");

	const last = snapshot.lastDecision;
	const changedSinceLastCycle =
		!last?.signalFingerprint || last.signalFingerprint !== signalFingerprint;

	return {
		healthScore: typeof health.overallScore === "number" ? health.overallScore : null,
		healthGrade: health.grade ?? null,
		healthTrend: health.trend ?? null,
		usageTrend: eng.trend ?? null,
		logins30d: typeof eng.logins30d === "number" ? eng.logins30d : null,
		daysToRenewal,
		contractValue:
			typeof snapshot.account?.contractValue === "number"
				? snapshot.account.contractValue
				: typeof snapshot.account?.arr === "number"
					? snapshot.account.arr
					: null,
		daysSinceLastContact,
		hasOverride,
		overrideForcesBand,
		signalFingerprint,
		changedSinceLastCycle,
		lastBand: last?.band ?? null,
	};
}
