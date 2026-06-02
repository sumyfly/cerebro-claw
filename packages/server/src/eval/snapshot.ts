import { cspToSnapshot } from "../engine/csp-snapshot.js";
import type { AccountSnapshot } from "../engine/signals.js";
import type { Scenario } from "./types.js";

/** Unwrap a CSP fixture envelope `{ data: <payload> }` → the payload. */
function data(fixture: unknown): unknown {
	if (fixture && typeof fixture === "object" && "data" in (fixture as Record<string, unknown>)) {
		return (fixture as { data: unknown }).data;
	}
	return undefined;
}

/**
 * Build a typed AccountSnapshot from a scenario's CSP fixtures + memory, using
 * the SAME real-shape mapper (cspToSnapshot) the production loop uses — so the
 * eval and live behave identically. Fixtures must use real CSP shapes:
 * account.businessMetrics, health.overall.{score,category}, engagement[].
 * Returns null when no account fixture is present.
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
	const account = data(scenario.csp[base]) as Record<string, unknown> | undefined;
	const health = data(scenario.csp[`${base}/health-score`]) as Record<string, unknown> | undefined;
	const engagement = data(scenario.csp[`${base}/engagement`]);

	const snapshot: AccountSnapshot = {
		...cspToSnapshot({ account, health, engagement }, now),
		instincts: scenario.memory?.instincts ?? [],
		overrides: scenario.memory?.overrides ?? [],
	};
	return { businessId, snapshot };
}
