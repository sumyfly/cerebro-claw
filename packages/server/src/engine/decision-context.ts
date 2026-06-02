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

	// Change detection: steer away from re-acting on an unchanged account.
	if (!signals.changedSinceLastCycle) {
		lines.push(
			`- No material change since last cycle (last decision: ${
				signals.lastBand ?? "none"
			}). Default to NO action unless a time-based trigger (e.g. a renewal window opening) now applies.`,
		);
	}

	if (instincts.length > 0) {
		lines.push("", "# What the CSM has told you about this account (instinct notes)");
		for (const note of instincts) lines.push(`- ${note}`);
	}

	return lines.join("\n");
}
