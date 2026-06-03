/** Pipeline — the agent's task stream as a control-room kanban.
 * Reads GET /api/ledger?since= (windowed), polls every 5s. Telemetry counters
 * come from the shared layout fetch (GET /api/digest/counters). */

import { useMemo, useState } from "react";
import { BandChip, Panel, RelativeTime, StatusDot } from "../components/primitives.js";
import type { LedgerEntry } from "../lib/api.js";
import {
	BAND_COLOR,
	BAND_LABEL,
	type Band,
	STATUS_COLOR,
	type Status,
	shortId,
} from "../lib/status.js";
import { usePoll } from "../lib/usePoll.js";

type Win = "24H" | "7D" | "ALL";

const WINDOWS: { key: Win; hours: number | null }[] = [
	{ key: "24H", hours: 24 },
	{ key: "7D", hours: 24 * 7 },
	{ key: "ALL", hours: null },
];

const BANDS: Band[] = ["act", "notify-then-act", "escalate", "prep"];

/** Kanban columns grouping statuses into operational lanes. */
const COLUMNS: { key: string; label: string; statuses: Status[] }[] = [
	{ key: "running", label: "IN-FLIGHT", statuses: ["in-flight"] },
	{ key: "done", label: "DONE", statuses: ["done", "executed", "resolved"] },
	{ key: "blocked", label: "NEEDS-CSM", statuses: ["needs-csm"] },
	{ key: "closed", label: "CANCELLED / FAILED", statuses: ["cancelled", "failed"] },
];

const COLUMN_ACCENT: Record<string, string> = {
	running: "#d29922",
	done: "#3fb950",
	blocked: "#f85149",
	closed: "#6b7787",
};

function sinceParam(win: Win): string {
	const w = WINDOWS.find((x) => x.key === win);
	if (!w || w.hours === null) return new Date("2000-01-01T00:00:00Z").toISOString();
	return new Date(Date.now() - w.hours * 3600 * 1000).toISOString();
}

function TaskCard({ e }: { e: LedgerEntry }) {
	return (
		<div className="cc-row" style={{ borderLeftColor: STATUS_COLOR[e.status] }}>
			<div className="cc-meta">
				<BandChip band={e.band} />
				<span className="cc-id mono">#{shortId(e.id)}</span>
				<StatusDot status={e.status} />
			</div>
			<div className="cc-card-summary">{e.summary}</div>
			<div className="cc-meta" style={{ marginTop: 4 }}>
				{e.customerName && <span className="cc-cust">{e.customerName}</span>}
				<RelativeTime value={e.createdAt} />
			</div>
		</div>
	);
}

export function Pipeline() {
	const [win, setWin] = useState<Win>("24H");
	const [bandFilter, setBandFilter] = useState<Set<Band>>(new Set());

	// TODO: server-side cap for ALL window
	const { data, loaded } = usePoll<{ entries: LedgerEntry[] }>(
		`/api/ledger?since=${encodeURIComponent(sinceParam(win))}`,
		5000,
	);
	const entries = data?.entries ?? [];

	const filtered = useMemo(() => {
		const sorted = [...entries].sort(
			(a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
		);
		if (bandFilter.size === 0) return sorted;
		return sorted.filter((e) => bandFilter.has(e.band));
	}, [entries, bandFilter]);

	// Bucket entries into kanban lanes once. An entry whose status falls outside
	// every lane is simply not rendered — so the header count must reflect the
	// bucketed total, never the pre-bucket length.
	const buckets = useMemo(
		() => COLUMNS.map((col) => filtered.filter((e) => col.statuses.includes(e.status))),
		[filtered],
	);
	const renderedCount = useMemo(() => buckets.reduce((n, b) => n + b.length, 0), [buckets]);

	const toggleBand = (b: Band) => {
		setBandFilter((prev) => {
			const next = new Set(prev);
			if (next.has(b)) next.delete(b);
			else next.add(b);
			return next;
		});
	};

	return (
		<>
			<h1 className="cc-page-title">PIPELINE — AGENT TASK STREAM</h1>

			<div className="cc-toolbar">
				<div className="cc-seg">
					{WINDOWS.map((w) => (
						<button
							type="button"
							key={w.key}
							className={win === w.key ? "on" : ""}
							onClick={() => setWin(w.key)}
						>
							{w.key}
						</button>
					))}
				</div>

				<div className="cc-fchip-group">
					<span className="cc-fchip-grouplabel">BAND</span>
					{BANDS.map((b) => {
						const on = bandFilter.has(b);
						const color = BAND_COLOR[b];
						return (
							<button
								type="button"
								key={b}
								className={`cc-fchip${on ? " on" : ""}`}
								onClick={() => toggleBand(b)}
								style={
									on
										? { background: color, borderColor: color }
										: { color, borderColor: `${color}55` }
								}
							>
								{BAND_LABEL[b]}
							</button>
						);
					})}
				</div>

				<span className="cc-id mono" style={{ marginLeft: "auto" }}>
					{renderedCount} TASKS
				</span>
			</div>

			{!loaded ? (
				<div className="cc-loading">QUERYING LEDGER…</div>
			) : (
				<div className="cc-kanban">
					{COLUMNS.map((col, i) => {
						const items = buckets[i];
						return (
							<Panel
								key={col.key}
								delay={i * 70}
								style={{ borderTop: `2px solid ${COLUMN_ACCENT[col.key]}` }}
							>
								<div className="cc-panel-header">
									<span>{col.label}</span>
									<span className="count">[{items.length}]</span>
								</div>
								<div className="cc-col">
									{items.length === 0 ? (
										<span className="cc-id mono" style={{ opacity: 0.5 }}>
											—
										</span>
									) : (
										items.map((e) => <TaskCard key={e.id} e={e} />)
									)}
								</div>
							</Panel>
						);
					})}
				</div>
			)}
		</>
	);
}
