/** Situations — the agent's open storylines that need the CSM.
 * Reads GET /api/situations (escalated OR needs-attention), each with its
 * ledger storyline. The watching count is the agent's "tracked, no action" set. */

import { BandChip, Panel, RelativeTime } from "../components/primitives.js";
import type { SituationQueue, SituationWithStoryline } from "../lib/api.js";
import { type Band, shortId } from "../lib/status.js";
import { usePoll } from "../lib/usePoll.js";

function StatusTag({ status }: { status: string }) {
	const color = status === "escalated" ? "#f85149" : "#d29922";
	return (
		<span className="cc-id mono" style={{ color, borderColor: `${color}55` }}>
			{status.toUpperCase()}
		</span>
	);
}

function SituationCard({ s }: { s: SituationWithStoryline }) {
	return (
		<div
			className="cc-row"
			style={{ borderLeftColor: s.status === "escalated" ? "#f85149" : "#d29922" }}
		>
			<div className="cc-meta">
				<span className="cc-id mono">#{shortId(s.id)}</span>
				<StatusTag status={s.status} />
				<span className="cc-id mono" style={{ opacity: 0.7 }}>
					{s.kind}
				</span>
			</div>
			<div className="cc-card-summary">{s.title}</div>
			<div className="cc-meta" style={{ marginTop: 4 }}>
				{s.customerName && <span className="cc-cust">{s.customerName}</span>}
				{s.waitingFor && <span style={{ opacity: 0.8 }}>waiting: {s.waitingFor}</span>}
				<RelativeTime value={s.openedAt} />
			</div>
			{s.storyline.length > 0 && (
				<div className="cc-col" style={{ marginTop: 6 }}>
					{s.storyline.map((e) => (
						<div key={e.id} className="cc-meta" style={{ fontSize: 12, opacity: 0.85 }}>
							<BandChip band={e.band as Band} />
							<span>{e.summary}</span>
							<RelativeTime value={e.createdAt} />
						</div>
					))}
				</div>
			)}
		</div>
	);
}

export function Situations() {
	const { data, loaded } = usePoll<SituationQueue>("/api/situations", 5000);
	const items = data?.needsCsm ?? [];
	const watching = data?.watchingCount ?? 0;

	return (
		<>
			<h1 className="cc-page-title">SITUATIONS — OPEN STORYLINES NEEDING YOU</h1>

			<div className="cc-toolbar">
				<span className="cc-id mono">{items.length} NEED YOU</span>
				<span className="cc-id mono" style={{ marginLeft: "auto", opacity: 0.7 }}>
					{watching} WATCHING
				</span>
			</div>

			{!loaded ? (
				<div className="cc-loading">QUERYING SITUATIONS…</div>
			) : items.length === 0 ? (
				<div className="cc-empty">
					<div className="line">NOTHING NEEDS YOU</div>
					<div className="sub">
						{watching} SITUATION(S) BEING WATCHED. THE AGENT WILL SURFACE ANY THAT TURN.
					</div>
				</div>
			) : (
				<Panel>
					<div className="cc-col">
						{items.map((s) => (
							<SituationCard key={s.id} s={s} />
						))}
					</div>
				</Panel>
			)}
		</>
	);
}
