import type { ActionLedger } from "@cerebro-claw/shared";

export interface DigestCounts {
	windowHours: number;
	acts: number;
	notifies: { inFlight: number; executed: number; cancelled: number; failed: number };
	escalations: { needsCsm: number; resolved: number };
	preps: number;
}

/**
 * Compute the CSM's daily digest counts from the action ledger. Acts/preps are
 * counted within the window; notifies-in-flight and escalations-needing-the-CSM
 * are counted from OPEN entries (they persist until dispatched/decided),
 * matching the "Yesterday: N acts, M notifies in-flight, K escalations" headline.
 */
export async function computeDigestCounts(
	ledger: ActionLedger,
	now: Date,
	windowHours = 24,
): Promise<DigestCounts> {
	const since = new Date(now.getTime() - windowHours * 3600 * 1000);
	// listByWindow's upper bound is exclusive; +1ms makes the window inclusive of
	// `now` so an action recorded/resolved this instant isn't dropped from counts.
	const recent = await ledger.listByWindow(since, new Date(now.getTime() + 1));
	const open = await ledger.listOpen();
	return {
		windowHours,
		acts: recent.filter((e) => e.band === "act").length,
		notifies: {
			inFlight: open.filter((e) => e.band === "notify-then-act").length,
			executed: recent.filter((e) => e.band === "notify-then-act" && e.status === "executed")
				.length,
			cancelled: recent.filter((e) => e.band === "notify-then-act" && e.status === "cancelled")
				.length,
			failed: recent.filter((e) => e.band === "notify-then-act" && e.status === "failed").length,
		},
		escalations: {
			needsCsm: open.filter((e) => e.band === "escalate").length,
			resolved: recent.filter((e) => e.band === "escalate" && e.status === "resolved").length,
		},
		preps: recent.filter((e) => e.band === "prep").length,
	};
}

export function digestHeadline(counts: DigestCounts): string {
	return `Yesterday: ${counts.acts} acts, ${counts.notifies.inFlight} notifies in-flight, ${counts.escalations.needsCsm} escalations need you.`;
}
