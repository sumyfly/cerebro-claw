import type { AccountSnapshot } from "../engine/signals.js";
import type { Scenario } from "./types.js";

/** A CSP fixture envelope is `{ data: <payload> }`. */
function data(fixture: unknown): Record<string, unknown> | undefined {
	if (fixture && typeof fixture === "object" && "data" in (fixture as Record<string, unknown>)) {
		const d = (fixture as { data: unknown }).data;
		return d && typeof d === "object" ? (d as Record<string, unknown>) : undefined;
	}
	return undefined;
}

/**
 * Build a typed AccountSnapshot from a scenario's CSP fixtures + memory, so the
 * eval can compute the same decision signals the production loop would. Reads
 * the standard CSP paths the agent would hit (account, health-score, engagement,
 * renewals). Returns null when no account fixture is present.
 */
export function snapshotFromScenario(
	scenario: Scenario,
	now: Date,
): { businessId: string; snapshot: AccountSnapshot } | null {
	let businessId: string | null = null;
	for (const path of Object.keys(scenario.csp)) {
		const m = path.match(/\/api\/v1\/accounts\/([0-9a-f]{24})$/i);
		if (m) {
			businessId = m[1];
			break;
		}
	}
	if (!businessId) return null;

	const base = `/api/v1/accounts/${businessId}`;
	const account = data(scenario.csp[base]);
	const healthScore = data(scenario.csp[`${base}/health-score`]);
	const engagement = data(scenario.csp[`${base}/engagement`]);
	const renewalsRaw = data(scenario.csp[`${base}/renewals`]);
	const renewals = Array.isArray((renewalsRaw as { items?: unknown[] })?.items)
		? ((renewalsRaw as { items: unknown[] }).items as AccountSnapshot["renewals"])
		: Array.isArray(renewalsRaw)
			? (renewalsRaw as unknown as AccountSnapshot["renewals"])
			: undefined;

	const snapshot: AccountSnapshot = {
		account: account as AccountSnapshot["account"],
		healthScore: healthScore as AccountSnapshot["healthScore"],
		engagement: engagement as AccountSnapshot["engagement"],
		renewals,
		instincts: scenario.memory?.instincts ?? [],
		overrides: scenario.memory?.overrides ?? [],
		now,
	};
	return { businessId, snapshot };
}
