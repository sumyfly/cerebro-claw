/** Intel / Skills — capability catalog (GET /api/extensions) + live tool feed
 * (GET /api/tools/recent). The feed endpoint is new; degrade gracefully if 404. */

import { useEffect, useMemo, useState } from "react";
import { Dot, Panel } from "../components/primitives.js";
import { type ExtensionInfo, type RecentToolCall, getJson } from "../lib/api.js";
import { COLOR, relTime } from "../lib/status.js";
import { usePoll } from "../lib/usePoll.js";

/** Group tools by inferred source: csp_* → CSP CONNECTOR, else AGENT TOOLKIT. */
function groupTools(tools: { name: string; description: string }[]) {
	const groups = new Map<string, { name: string; description: string }[]>();
	for (const t of tools) {
		const key = t.name.startsWith("csp_") ? "CSP CONNECTOR" : "AGENT TOOLKIT";
		const arr = groups.get(key) ?? [];
		arr.push(t);
		groups.set(key, arr);
	}
	// Stable order: agent toolkit first, then csp connector.
	const order = ["AGENT TOOLKIT", "CSP CONNECTOR"];
	const rank = (k: string) => {
		const i = order.indexOf(k);
		return i === -1 ? order.length : i;
	};
	return [...groups.entries()].sort((a, b) => rank(a[0]) - rank(b[0]));
}

function FeedRow({ call }: { call: RecentToolCall }) {
	const color = call.ok ? COLOR.ok : COLOR.danger;
	return (
		<div className="cc-feed-row cc-row" style={{ borderLeftColor: color }}>
			<div className="cc-meta">
				<Dot color={color} pulse={!call.ok} />
				<span className="cc-tool-feed mono" style={{ color: COLOR.cyan, fontSize: 12 }}>
					{call.tool}
				</span>
				<span className="mono" style={{ color, fontSize: 10 }}>
					{call.ok ? "OK" : "FAIL"}
				</span>
				<span className="cc-time mono" style={{ marginLeft: "auto" }}>
					{relTime(call.ts)}
				</span>
			</div>
			{call.customerId && (
				<div className="cc-id mono" style={{ marginTop: 3 }}>
					→ {call.customerId}
				</div>
			)}
		</div>
	);
}

export function Skills() {
	const [info, setInfo] = useState<ExtensionInfo | null>(null);

	useEffect(() => {
		getJson<ExtensionInfo>("/api/extensions")
			.then(setInfo)
			.catch(() => {});
	}, []);

	const { data: feed, available: feedAvailable } = usePoll<RecentToolCall[]>(
		"/api/tools/recent",
		4000,
	);

	const grouped = useMemo(() => (info ? groupTools(info.tools) : []), [info]);

	return (
		<>
			<h1 className="cc-page-title">INTEL — CAPABILITY CATALOG &amp; LIVE TELEMETRY</h1>

			<div className="cc-grid-2">
				{/* LEFT: catalog */}
				<div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
					<Panel title="WIRED CHANNELS &amp; EXTENSIONS" delay={0}>
						<div className="cc-chips-inline">
							{info?.loaded.map((id) => (
								<span key={id} className="cc-tag cyan">
									{id}
								</span>
							))}
							{info?.channels.map((c) => (
								<span key={c} className="cc-tag">
									ch:{c}
								</span>
							))}
							{!info && <span className="cc-loading">LOADING…</span>}
						</div>
					</Panel>

					{grouped.map(([group, tools], i) => (
						<Panel key={group} title={group} count={tools.length} delay={80 + i * 70}>
							{tools.map((t) => (
								<div key={t.name} className="cc-tool">
									<div className="name">{t.name}</div>
									<div className="desc">{t.description}</div>
								</div>
							))}
						</Panel>
					))}
				</div>

				{/* RIGHT: live feed */}
				<Panel
					title="LIVE TOOL FEED"
					count={feed?.length ?? 0}
					delay={120}
					style={{ position: "sticky", top: 0 }}
				>
					{!feedAvailable ? (
						<div className="cc-empty" style={{ minHeight: 200 }}>
							<div className="line" style={{ color: COLOR.pending }}>
								AWAITING TELEMETRY
							</div>
							<div className="sub">
								/api/tools/recent NOT YET ONLINE — FEED WILL ATTACH WHEN READY
							</div>
						</div>
					) : feed && feed.length > 0 ? (
						<div className="cc-feed-scroll">
							{feed.map((call) => (
								<FeedRow key={call.seq} call={call} />
							))}
						</div>
					) : (
						<div className="cc-empty" style={{ minHeight: 200 }}>
							<div className="line">IDLE — NO RECENT CALLS</div>
							<div className="sub">TOOL INVOCATIONS WILL STREAM IN HERE</div>
						</div>
					)}
				</Panel>
			</div>
		</>
	);
}
