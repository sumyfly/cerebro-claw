import type { MemoryStore } from "@cerebro-claw/shared";

const BAND_SEVERITY: Record<string, number> = {
	act: 0,
	prep: 1,
	"notify-then-act": 2,
	escalate: 3,
};

/**
 * Overrides are taught by the CSM the way the vision describes — by talking to
 * the agent ("remember: escalate everything for Acme"). The agent stores them as
 * instinct notes. We mark an enforceable override with a leading directive:
 *
 *   "override: escalate — VIP account, CSM owns every touch"
 *   "OVERRIDE BAND=notify-then-act: clear small nudges with me first"
 *
 * This parser pulls the strongest forced band out of a customer's instinct
 * notes. Returns null when no note carries an override directive.
 */
const OVERRIDE_RE = /\boverride\b[^a-z]*(?:band\s*[=:]\s*)?(act|prep|notify-then-act|escalate)\b/i;

export function parseOverrideBand(noteContents: string[]): string | null {
	let strongest: string | null = null;
	for (const content of noteContents) {
		const m = content.match(OVERRIDE_RE);
		if (!m) continue;
		const band = m[1].toLowerCase();
		if (strongest === null || (BAND_SEVERITY[band] ?? 0) > (BAND_SEVERITY[strongest] ?? 0)) {
			strongest = band;
		}
	}
	return strongest;
}

/**
 * Resolve a customer's enforceable override from the instinct store. Shape
 * matches what the action-policy tools' `resolveOverride` hook expects.
 */
export async function resolveOverrideFromStore(
	store: MemoryStore,
	customerId: string,
): Promise<{ forcesBand?: string } | null> {
	const instincts = await store.getInstincts(customerId);
	const band = parseOverrideBand(instincts.map((i) => i.content));
	return band ? { forcesBand: band } : null;
}
