/** Settings — read-only status panel. Connectivity (GET /api/diagnostics) +
 * loaded extensions/channels/tool count (GET /api/extensions). */

import { useEffect, useState } from "react";
import { Panel } from "../components/primitives.js";
import { type Diagnostics, type ExtensionInfo, getJson } from "../lib/api.js";
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
				</div>
			</div>
		</>
	);
}
