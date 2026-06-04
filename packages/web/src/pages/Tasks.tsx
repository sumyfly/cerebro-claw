/** Tasks — the CSM's Cerebro work queue as the agent works it.
 * Reads GET /api/tasks (open tasks joined with the agent's recorded band +
 * outcome), polls every 5s. Two lanes: open queue → cleared (24h). */

import { CheckCircleOutlined, DisconnectOutlined } from "@ant-design/icons";
import type { ReactNode } from "react";
import { BandChip, Panel, RelativeTime, StatusChip } from "../components/primitives.js";
import type { TaskOutcomeRow, TaskQueue, TaskRow } from "../lib/api.js";
import { BAND_COLOR, COLOR, shortId } from "../lib/status.js";
import { usePoll } from "../lib/usePoll.js";

/** CSP priority → token color. */
const PRIORITY_COLOR: Record<string, string> = {
	HIGH: COLOR.danger,
	URGENT: COLOR.danger,
	NORMAL: COLOR.grey,
	LOW: COLOR.grey,
};

function PriorityTag({ value }: { value: string }) {
	const color = PRIORITY_COLOR[value.toUpperCase()] ?? COLOR.grey;
	return (
		<span className="cc-id mono" style={{ color, letterSpacing: "0.08em" }}>
			{value.toUpperCase()}
		</span>
	);
}

function TaskCard({ t }: { t: TaskRow }) {
	// Spine carries the action-policy color language; untouched stays grey.
	const spine = t.latestAction ? BAND_COLOR[t.latestAction.band] : COLOR.grey;
	return (
		<div className="cc-row" style={{ borderLeftColor: spine }}>
			<div className="cc-meta">
				{t.latestAction ? (
					<>
						<BandChip band={t.latestAction.band} />
						<StatusChip status={t.latestAction.status} />
					</>
				) : (
					<span className="cc-chip" style={{ color: COLOR.grey, borderColor: `${COLOR.grey}55` }}>
						UNTOUCHED
					</span>
				)}
				{t.priority && <PriorityTag value={t.priority} />}
			</div>
			<div className="cc-card-summary">{t.title}</div>
			{t.latestAction && (
				<div className="cc-meta" style={{ marginTop: 4, color: "var(--text-dim)" }}>
					{t.latestAction.summary}
				</div>
			)}
			<div className="cc-meta" style={{ marginTop: 4 }}>
				{t.customerName && <span className="cc-cust">{t.customerName}</span>}
				<span className="cc-id mono">#{shortId(t.id)}</span>
			</div>
		</div>
	);
}

function OutcomeCard({ o }: { o: TaskOutcomeRow }) {
	return (
		<div className="cc-row" style={{ borderLeftColor: BAND_COLOR[o.band] }}>
			<div className="cc-meta">
				<BandChip band={o.band} />
				<StatusChip status={o.status} />
			</div>
			<div className="cc-card-summary">{o.summary}</div>
			<div className="cc-meta" style={{ marginTop: 4 }}>
				<span className="cc-id mono">#{shortId(o.taskId)}</span>
				<RelativeTime value={o.createdAt} />
			</div>
		</div>
	);
}

function Lane({
	label,
	count,
	accent,
	delay,
	children,
}: {
	label: string;
	count: number;
	accent: string;
	delay: number;
	children: ReactNode;
}) {
	return (
		<Panel delay={delay} style={{ borderTop: `2px solid ${accent}` }}>
			<div className="cc-panel-header">
				<span>{label}</span>
				<span className="count">[{count}]</span>
			</div>
			<div className="cc-col">{count === 0 ? <span className="cc-id mono">—</span> : children}</div>
		</Panel>
	);
}

function TaskShell({ children }: { children: ReactNode }) {
	return (
		<>
			<h1 className="cc-page-title">TASKS — CEREBRO WORK QUEUE</h1>
			{children}
		</>
	);
}

export function Tasks() {
	const { data, loaded } = usePoll<TaskQueue>("/api/tasks", 5000);

	if (!loaded) {
		return (
			<TaskShell>
				<div className="cc-loading">QUERYING TASK QUEUE…</div>
			</TaskShell>
		);
	}

	if (data && !data.configured) {
		return (
			<TaskShell>
				<div className="cc-empty">
					<DisconnectOutlined className="glyph" style={{ color: "var(--text-dim)" }} />
					<div className="line">NO TASK SOURCE BOUND</div>
					<div className="sub">SET TASK_SOURCE=CSP TO STREAM THE LIVE QUEUE</div>
				</div>
			</TaskShell>
		);
	}

	const open = data?.open ?? [];
	const outcomes = data?.recentOutcomes ?? [];

	if (open.length === 0 && outcomes.length === 0) {
		return (
			<TaskShell>
				<div className="cc-empty">
					<CheckCircleOutlined className="glyph" />
					<div className="line">QUEUE CLEAR — NO OPEN TASKS</div>
					<div className="sub">THE AGENT IS WORKING THE PORTFOLIO. NOTHING WAITING.</div>
				</div>
			</TaskShell>
		);
	}

	return (
		<TaskShell>
			<div className="cc-toolbar">
				{data?.label && (
					<span className="cc-fchip-grouplabel">SOURCE: {data.label.toUpperCase()}</span>
				)}
				<span className="cc-id mono" style={{ marginLeft: "auto", color: "var(--text-dim)" }}>
					{open.length} OPEN · {outcomes.length} ACTED / 24H
				</span>
			</div>

			<div className="cc-kanban" style={{ gridTemplateColumns: "1fr 1fr" }}>
				<Lane label="OPEN QUEUE" count={open.length} accent={COLOR.grey} delay={0}>
					{open.map((t) => (
						<TaskCard key={t.id} t={t} />
					))}
				</Lane>
				<Lane label="CLEARED / 24H" count={outcomes.length} accent={COLOR.ok} delay={70}>
					{outcomes.map((o) => (
						<OutcomeCard key={`${o.taskId}-${o.createdAt}`} o={o} />
					))}
				</Lane>
			</div>
		</TaskShell>
	);
}
