/**
 * Triage — rank subjects by risk × value × urgency so the work loop spends its
 * (expensive) agent turns only on what matters. Pure arithmetic on existing
 * signals; NO model call. The LLM is reserved for the few subjects that clear
 * triage.
 */

export interface TriageInput {
	/** Health score 0–100 (higher = healthier). */
	healthScore?: number;
	/** Health grade/category (e.g. HEALTHY / AT_RISK / CHURN_RISK). */
	healthGrade?: string;
	/** Usage trend. */
	usageTrend?: "up" | "flat" | "down";
	/** Annual contract value / ARR. */
	contractValue?: number;
	/** Days until renewal (negative = overdue). */
	daysToRenewal?: number;
	/** Explicit at-risk flag (renewals). */
	atRisk?: boolean;
	/** Task priority label (e.g. OVERDUE / DUE_TODAY / HIGH). */
	priority?: string;
	/** An open Situation's checkpoint is due. */
	checkpointDue?: boolean;
}

export interface TriageScore {
	/** Overall 0–1. */
	score: number;
	risk: number;
	value: number;
	urgency: number;
}

export interface TriageWeights {
	risk: number;
	value: number;
	urgency: number;
	/** ARR that maps to value=1. */
	valueNorm: number;
	/** Renewal-days horizon over which urgency ramps to 1. */
	renewalHorizonDays: number;
}

export const DEFAULT_TRIAGE_WEIGHTS: TriageWeights = {
	risk: 0.5,
	value: 0.2,
	urgency: 0.3,
	valueNorm: 50_000,
	renewalHorizonDays: 90,
};

const clamp = (n: number, lo = 0, hi = 1) => Math.min(hi, Math.max(lo, n));

/** Score a subject. Deterministic, no I/O, no model call. */
export function computeTriageScore(
	input: TriageInput,
	w: TriageWeights = DEFAULT_TRIAGE_WEIGHTS,
): TriageScore {
	let risk = 0;
	if (input.healthScore != null)
		risk = Math.max(risk, (100 - clamp(input.healthScore, 0, 100)) / 100);
	if (input.healthGrade && /risk|churn|red/i.test(input.healthGrade)) risk = Math.max(risk, 0.7);
	if (input.usageTrend === "down") risk = Math.max(risk, 0.6);
	if (input.atRisk) risk = Math.max(risk, 0.8);
	risk = clamp(risk);

	const value = input.contractValue != null ? clamp(input.contractValue / w.valueNorm) : 0;

	let urgency = 0;
	if (input.daysToRenewal != null) {
		urgency =
			input.daysToRenewal <= 0
				? 1
				: clamp((w.renewalHorizonDays - input.daysToRenewal) / w.renewalHorizonDays);
	}
	if (input.checkpointDue) urgency = Math.max(urgency, 0.6);
	if (input.priority && /overdue|due.?today|urgent|high/i.test(input.priority)) {
		urgency = Math.max(urgency, 0.7);
	}
	urgency = clamp(urgency);

	const score = w.risk * risk + w.value * value + w.urgency * urgency;
	return { score, risk, value, urgency };
}

export interface TriageSelection<T> {
	selected: { item: T; score: TriageScore }[];
	deferred: { item: T; score: TriageScore; reason: "below-floor" | "over-budget" }[];
}

/**
 * Rank candidates by score (desc) and select the top `max` whose score clears
 * `minScore`; the rest are deferred (with the reason). Deferred subjects are
 * never dropped — the caller logs them and they re-compete next cycle.
 */
export function selectByTriage<T>(
	items: T[],
	scoreOf: (t: T) => TriageScore,
	opts: { max: number; minScore: number },
): TriageSelection<T> {
	const scored = items
		.map((item) => ({ item, score: scoreOf(item) }))
		.sort((a, b) => b.score.score - a.score.score);
	const selected: TriageSelection<T>["selected"] = [];
	const deferred: TriageSelection<T>["deferred"] = [];
	for (const s of scored) {
		if (s.score.score < opts.minScore) deferred.push({ ...s, reason: "below-floor" });
		else if (selected.length >= opts.max) deferred.push({ ...s, reason: "over-budget" });
		else selected.push(s);
	}
	return { selected, deferred };
}
