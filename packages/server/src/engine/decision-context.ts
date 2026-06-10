import type { ActionLedgerEntry, Situation } from "@cerebro-claw/shared";
import type { DecisionSignals } from "./signals.js";

/**
 * Render the computed decision signals into a prompt context block the agent
 * reads before choosing a band. This is the "structured inputs" half of the
 * hybrid policy: the code states the salient facts + the hard constraints
 * (override, no-change), the agent still makes the judgment.
 *
 * Injected as the per-account `context` (appended after SYSTEM_PROMPT), so it
 * reaches both the production brain loop and the eval identically.
 */
export function renderDecisionContext(signals: DecisionSignals, instincts: string[] = []): string {
	const lines: string[] = ["# Decision signals (computed for you)"];

	lines.push(
		`- Health: ${signals.healthScore ?? "?"}${
			signals.healthGrade ? ` (grade ${signals.healthGrade})` : ""
		}, trend ${signals.healthTrend ?? "?"}`,
	);
	lines.push(
		`- Usage trend: ${signals.usageTrend ?? "?"}${
			signals.logins30d != null ? ` (${signals.logins30d} logins/30d)` : ""
		}`,
	);
	if (signals.daysToRenewal != null) {
		lines.push(
			`- Renewal: ${signals.daysToRenewal} day(s) away${
				signals.daysToRenewal < 0 ? " (OVERDUE)" : ""
			}`,
		);
	}
	if (signals.contractValue != null) {
		lines.push(`- Contract value: $${signals.contractValue.toLocaleString()}/yr`);
	}
	if (signals.daysSinceLastContact != null) {
		lines.push(`- Last customer contact: ${signals.daysSinceLastContact} day(s) ago`);
	}

	// Hard constraint: an override forces a minimum band.
	if (signals.overrideForcesBand) {
		lines.push(
			`- ⚠️ OVERRIDE for this account: you MUST use the "${signals.overrideForcesBand}" band. Do not pick a lower-stakes band, regardless of the other signals.`,
		);
	}

	// Change detection: steer away from re-acting on an unchanged account. Only
	// surface "last decision: X" when X is a real band — never a bookkeeping
	// placeholder (the persisted record may only carry a fingerprint).
	if (!signals.changedSinceLastCycle) {
		const realBands = ["act", "notify-then-act", "escalate", "prep"];
		const lastBandNote =
			signals.lastBand && realBands.includes(signals.lastBand)
				? ` (last decision: ${signals.lastBand})`
				: "";
		lines.push(
			`- No material change since last cycle${lastBandNote}. Default to NO action unless a time-based trigger (e.g. a renewal window opening) now applies.`,
		);
	}

	if (instincts.length > 0) {
		lines.push("", "# What the CSM has told you about this account (instinct notes)");
		for (const note of instincts) lines.push(`- ${note}`);
	}

	return lines.join("\n");
}

/**
 * Render the account's recent ledger entries so the agent observes the
 * outcomes of its own past actions (the closed loop): chase a send that got no
 * response, retry or escalate a failure, and never repeat an in-flight touch.
 */
export function renderRecentActions(entries: ActionLedgerEntry[], now: Date): string {
	if (entries.length === 0) return "";
	const lines = [
		"# Recent agent actions on this account (your own past work — newest first)",
		"Use these to follow through: chase a send with no response, address failures, and do NOT repeat work already done or in flight.",
	];
	for (const e of entries) {
		const ageDays = Math.max(0, Math.floor((now.getTime() - e.createdAt.getTime()) / 86_400_000));
		const age = ageDays === 0 ? "today" : `${ageDays}d ago`;
		const failure = e.status === "failed" && e.note ? ` — FAILED: ${e.note}` : "";
		lines.push(`- [${e.band}/${e.status}] ${age}: ${e.summary}${failure}`);
	}
	return lines.join("\n");
}

/**
 * Render the account's open Situations (storylines already in flight) so the
 * agent advances/resolves them instead of re-discovering the same thing. A
 * `watching` situation whose checkpoint hasn't passed is an explicit "leave it"
 * signal — this is the no-re-discovery mechanic, surfaced to the agent.
 */
export function renderSituations(situations: Situation[], now: Date): string {
	if (situations.length === 0) {
		return '# Open situations\n- none. If you start tracking something (e.g. "watching a renewal"), open a Situation with situation_open — do NOT log it as an `act`.';
	}
	const lines = [
		"# Open situations — ALREADY in flight. Advance/resolve these; do NOT open a duplicate or re-log them as an `act`.",
	];
	for (const s of situations) {
		const checkpoint = s.nextCheckpoint
			? s.nextCheckpoint > now
				? ` — checkpoint ${s.nextCheckpoint.toISOString().slice(0, 10)} not yet due: leave unchanged unless signals materially changed`
				: " — checkpoint DUE: re-evaluate and advance or resolve now"
			: "";
		lines.push(
			`- #${s.id.slice(0, 8)} ${s.kind}/${s.status}: ${s.title}${
				s.waitingFor ? ` (waiting: ${s.waitingFor})` : ""
			}${checkpoint}`,
		);
	}
	return lines.join("\n");
}
