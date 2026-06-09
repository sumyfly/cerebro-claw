/** Settings — read-only status panel. Connectivity (GET /api/diagnostics) +
 * loaded extensions/channels/tool count (GET /api/extensions). */

import { useEffect, useState } from "react";
import { Panel } from "../components/primitives.js";
import {
	type CycleSummary,
	type Diagnostics,
	type ExtensionInfo,
	HttpError,
	getJson,
	postJson,
} from "../lib/api.js";
import { COLOR } from "../lib/status.js";

const DIAG_LABEL: Record<string, string> = {
	database: "DATABASE",
	runtime: "AGENT RUNTIME",
	lark: "LARK CHANNEL",
	csp: "CSP BACKEND",
};

function StatusRow({ name, ok, detail }: { name: string; ok: boolean; detail?: string }) {
	const color = ok ? COLOR.ok : COLOR.danger;
	return (
		<div className="cc-kv">
			<span className="key" style={{ display: "flex", alignItems: "center", gap: 8 }}>
				<span style={{ color, fontSize: 13 }}>{ok ? "✓" : "✗"}</span>
				{DIAG_LABEL[name] ?? name.toUpperCase()}
			</span>
			<span className="val" style={{ color: ok ? COLOR.grey : color }}>
				{detail ?? (ok ? "ok" : "unavailable")}
			</span>
		</div>
	);
}

function KV({ k, v }: { k: string; v: string | number }) {
	return (
		<div className="cc-kv">
			<span className="key">{k}</span>
			<span className="val">{v}</span>
		</div>
	);
}

function WorkLoopPanel() {
	const [limit, setLimit] = useState(3);
	const [running, setRunning] = useState(false);
	const [summary, setSummary] = useState<CycleSummary | null>(null);
	const [error, setError] = useState<string | null>(null);

	async function runCycle() {
		setRunning(true);
		setError(null);
		setSummary(null);
		try {
			const res = await postJson<CycleSummary>(`/api/brain/cycle?limit=${limit}`, {});
			setSummary(res);
		} catch (err) {
			if (err instanceof HttpError && err.status === 409) {
				setError("A cycle is already running — try again in a moment.");
			} else {
				setError(err instanceof Error ? err.message : String(err));
			}
		} finally {
			setRunning(false);
		}
	}

	return (
		<Panel title="WORK LOOP" delay={260}>
			<div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 12 }}>
				<button type="button" className="cc-btn" disabled={running} onClick={runCycle}>
					{running ? "RUNNING…" : "RUN ONE CYCLE"}
				</button>
				<label className="cc-kv" style={{ gap: 6 }}>
					<span className="key">limit</span>
					<input
						type="number"
						min={0}
						value={limit}
						disabled={running}
						onChange={(e) => setLimit(Math.max(0, Number(e.target.value) || 0))}
						style={{ width: 56 }}
					/>
				</label>
				<span className="val" style={{ color: COLOR.grey }}>
					0 = full run
				</span>
			</div>
			{error && (
				<div className="val" style={{ color: COLOR.danger }}>
					{error}
				</div>
			)}
			{summary && (
				<>
					<KV k="cap" v={summary.limit === 0 ? "none" : summary.limit} />
					<KV k="accounts" v={`${summary.accounts.evaluated}/${summary.accounts.available}`} />
					<KV k="tasks" v={`${summary.tasks.evaluated}/${summary.tasks.available}`} />
					<KV k="renewals" v={`${summary.renewals.evaluated}/${summary.renewals.available}`} />
					<KV k="actions taken" v={summary.actionsTaken} />
					<KV k="duration" v={`${(summary.durationMs / 1000).toFixed(1)}s`} />
				</>
			)}
		</Panel>
	);
}

export function Settings() {
	const [diag, setDiag] = useState<Diagnostics | null>(null);
	const [info, setInfo] = useState<ExtensionInfo | null>(null);

	useEffect(() => {
		getJson<Diagnostics>("/api/diagnostics")
			.then(setDiag)
			.catch(() => {});
		getJson<ExtensionInfo>("/api/extensions")
			.then(setInfo)
			.catch(() => {});
	}, []);

	return (
		<>
			<h1 className="cc-page-title">
				CONFIG{" "}
				<span className="cc-id mono" style={{ color: COLOR.pending }}>
					[READ-ONLY]
				</span>
			</h1>

			<div className="cc-grid-2">
				<Panel title="CONNECTIVITY" delay={0}>
					{diag ? (
						Object.entries(diag).map(([name, s]) => (
							<StatusRow key={name} name={name} ok={s.ok} detail={s.detail} />
						))
					) : (
						<div className="cc-loading">PROBING SERVICES…</div>
					)}
				</Panel>

				<div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
					<Panel title="RUNTIME INVENTORY" delay={80}>
						{info ? (
							<>
								<KV k="extensions" v={info.loaded.length} />
								<KV k="channels" v={info.channels.length || "none"} />
								<KV k="tools" v={info.tools.length} />
							</>
						) : (
							<div className="cc-loading">LOADING…</div>
						)}
					</Panel>

					<Panel title="LOADED EXTENSIONS" count={info?.loaded.length} delay={150}>
						<div className="cc-chips-inline">
							{info?.loaded.map((id) => (
								<span key={id} className="cc-tag cyan">
									{id}
								</span>
							))}
							{info && info.loaded.length === 0 && <span className="cc-loading">NONE</span>}
						</div>
					</Panel>

					<Panel title="WIRED CHANNELS" count={info?.channels.length} delay={210}>
						<div className="cc-chips-inline">
							{info?.channels.map((c) => (
								<span key={c} className="cc-tag">
									{c}
								</span>
							))}
							{info && info.channels.length === 0 && (
								<span className="cc-loading">NO CHANNELS REGISTERED</span>
							)}
						</div>
					</Panel>

					<WorkLoopPanel />
				</div>
			</div>
		</>
	);
}
