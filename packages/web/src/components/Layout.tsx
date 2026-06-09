/** App shell: icon rail nav + persistent telemetry bar + scrollable content. */

import {
	ApiOutlined,
	BranchesOutlined,
	NodeIndexOutlined,
	SettingOutlined,
	StopOutlined,
} from "@ant-design/icons";
import { type ReactNode, useEffect, useState } from "react";
import { Outlet, useLocation, useNavigate } from "react-router-dom";
import type { DigestCounters } from "../lib/api.js";
import { usePoll } from "../lib/usePoll.js";
import { TelemetryBar } from "./TelemetryBar.js";

const COUNTERS_POLL_MS = 5000;

interface NavItem {
	path: string;
	label: string;
	icon: ReactNode;
}

const NAV: NavItem[] = [
	{ path: "/", label: "Activity", icon: <NodeIndexOutlined /> },
	{ path: "/situations", label: "Situations", icon: <BranchesOutlined /> },
	{ path: "/escalations", label: "Escalations", icon: <StopOutlined /> },
	{ path: "/skills", label: "Intel", icon: <ApiOutlined /> },
	{ path: "/settings", label: "Config", icon: <SettingOutlined /> },
];

export function AppLayout() {
	const navigate = useNavigate();
	const location = useLocation();

	const { data: counters, lastSuccessAt } = usePoll<DigestCounters>(
		"/api/digest/counters",
		COUNTERS_POLL_MS,
	);

	// Heartbeat so liveness re-evaluates even when polls stop landing (a dead
	// backend never updates lastSuccessAt, so without this the bar would freeze
	// on its last truthy render and keep claiming LIVE).
	const [, setHeartbeat] = useState(0);
	useEffect(() => {
		const h = setInterval(() => setHeartbeat((n) => n + 1), 1000);
		return () => clearInterval(h);
	}, []);

	// "Live" means a successful counters fetch landed within ~2 poll intervals.
	const live =
		lastSuccessAt !== null && Date.now() - new Date(lastSuccessAt).getTime() < COUNTERS_POLL_MS * 2;

	const escalationCount = counters?.counts?.escalations?.needsCsm ?? 0;

	return (
		<div className="cc-root" style={{ display: "flex", minHeight: "100vh" }}>
			<nav className="cc-rail">
				{NAV.map((item) => {
					const active =
						item.path === "/" ? location.pathname === "/" : location.pathname.startsWith(item.path);
					const showBadge = item.path === "/escalations" && escalationCount > 0;
					return (
						<button
							type="button"
							key={item.path}
							className={`cc-rail-item${active ? " active" : ""}`}
							onClick={() => navigate(item.path)}
						>
							{showBadge && <span className="cc-rail-badge ring">{escalationCount}</span>}
							{item.icon}
							<span className="cc-rail-label">{item.label}</span>
						</button>
					);
				})}
			</nav>

			<div style={{ display: "flex", flexDirection: "column", flex: 1, minWidth: 0 }}>
				<TelemetryBar counters={counters} lastSyncAt={lastSuccessAt} live={live} />
				<main className="cc-content">
					<Outlet />
				</main>
			</div>
		</div>
	);
}
