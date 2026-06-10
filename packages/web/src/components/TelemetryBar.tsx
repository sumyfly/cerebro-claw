/** Persistent top telemetry bar — live monospace counters + honest LIVE dot.
 * The dot + LAST SYNC reflect real backend sync (driven by Layout's counters
 * poll), not a free-running wall clock. When sync stalls, the dot goes
 * red/grey, stops pulsing, and a STALE/NO SYNC hint appears. */

import type { DigestCounters } from "../lib/api.js";
import { COLOR } from "../lib/status.js";

function Counter({ label, value, color }: { label: string; value: number; color: string }) {
	return (
		<span className="cc-tel-counter">
			<span className="lbl">{label}</span>
			<span className="val" style={{ color }}>
				{String(value).padStart(2, "0")}
			</span>
		</span>
	);
}

/** hh:mm:ss of the last successful sync, or a dashed placeholder. */
function syncClock(lastSyncAt: string | null): string {
	if (!lastSyncAt) return "--:--:--";
	const d = new Date(lastSyncAt);
	if (Number.isNaN(d.getTime())) return "--:--:--";
	return d.toTimeString().slice(0, 8);
}

export function TelemetryBar({
	counters,
	lastSyncAt,
	live,
}: {
	counters: DigestCounters | null;
	lastSyncAt: string | null;
	live: boolean;
}) {
	const c = counters?.counts;
	const acts = c?.acts ?? 0;
	const notify = c?.notifies?.inFlight ?? 0;
	const esc = c?.escalations?.needsCsm ?? 0;
	const prep = c?.preps ?? 0;

	const dotColor = live ? COLOR.ok : lastSyncAt ? COLOR.danger : COLOR.grey;
	const statusLabel = live ? "LIVE" : lastSyncAt ? "STALE" : "NO SYNC";

	return (
		<div className="cc-telemetry">
			<span className="cc-tel-brand head">
				CEREBRO <span className="slash">{"//"}</span> CLAW
			</span>
			<Counter label="ACTS" value={acts} color={COLOR.ok} />
			<span className="cc-tel-sep">·</span>
			<Counter label="NOTIFY" value={notify} color={notify > 0 ? COLOR.pending : COLOR.grey} />
			<span className="cc-tel-sep">·</span>
			<Counter label="ESC" value={esc} color={esc > 0 ? COLOR.danger : COLOR.grey} />
			<span className="cc-tel-sep">·</span>
			<Counter label="PREP" value={prep} color={prep > 0 ? COLOR.prep : COLOR.grey} />

			<span className="cc-tel-right">
				<span className="cc-live" style={{ color: dotColor }}>
					<span
						className="dot"
						style={{ background: dotColor, animation: live ? undefined : "none" }}
					/>
					{statusLabel}
				</span>
				<span>
					LAST SYNC{" "}
					<span style={{ color: live ? COLOR.cyan : COLOR.grey }}>{syncClock(lastSyncAt)}</span>
				</span>
			</span>
		</div>
	);
}
