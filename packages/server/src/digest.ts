import type { ActionLedger, SituationStore } from "@cerebro-claw/shared";

export interface DigestCounts {
	windowHours: number;
	acts: number;
	notifies: { inFlight: number; executed: number; cancelled: number; failed: number };
	escalations: { needsCsm: number; resolved: number };
	/** D5: the storyline-level view the CSM acts on. needsCsm = the headline "need you" number. */
	situations: { needsCsm: number; watching: number };
	preps: number;
}

/**
 * Compute the CSM's daily digest counts. Acts/preps are counted within the
 * window; notifies-in-flight and escalations-needing-the-CSM are counted from
 * OPEN entries (they persist until dispatched/decided).
 *
 * D5: the headline "need you" number is the count of SITUATIONS needing the CSM
 * — escalated/needsAttention situations, unioned with needs-csm escalations
 * that have no linked situation (so a bare escalation is never lost). When no
 * situation store is provided, it falls back to the escalation count.
 */
export async function computeDigestCounts(
	ledger: ActionLedger,
	now: Date,
	windowHours = 24,
	situationStore?: SituationStore,
): Promise<DigestCounts> {
	const since = new Date(now.getTime() - windowHours * 3600 * 1000);
	// listByWindow's upper bound is exclusive; +1ms makes the window inclusive of
	// `now` so an action recorded/resolved this instant isn't dropped from counts.
	const recent = await ledger.listByWindow(since, new Date(now.getTime() + 1));
	const open = await ledger.listOpen();

	const escalationsNeedingCsm = open.filter((e) => e.band === "escalate");
	let situationsNeedsCsm = escalationsNeedingCsm.length;
	let situationsWatching = 0;
	if (situationStore) {
		const needing = await situationStore.listNeedingCsm();
		const watching = await situationStore.listWatching();
		// Union: situations needing the CSM + escalations with no situation link.
		const bareEscalations = escalationsNeedingCsm.filter((e) => !e.situationId).length;
		situationsNeedsCsm = needing.length + bareEscalations;
		situationsWatching = watching.length;
	}

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
			needsCsm: escalationsNeedingCsm.length,
			resolved: recent.filter((e) => e.band === "escalate" && e.status === "resolved").length,
		},
		situations: { needsCsm: situationsNeedsCsm, watching: situationsWatching },
		preps: recent.filter((e) => e.band === "prep").length,
	};
}

export function digestHeadline(counts: DigestCounts): string {
	return `Yesterday: ${counts.acts} acts, ${counts.notifies.inFlight} notifies in-flight, ${counts.situations.needsCsm} situations need you.`;
}
