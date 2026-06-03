/** Shared visual primitives for the console: StatusDot, BandChip, PanelHeader,
 * RelativeTime, StatusChip. Built once, reused across all four pages. */

import type { ReactNode } from "react";
import {
	BAND_COLOR,
	BAND_LABEL,
	type Band,
	STATUS_COLOR,
	STATUS_LABEL,
	type Status,
	pulses,
	relTime,
} from "../lib/status.js";

export function StatusDot({ status }: { status: Status }) {
	const color = STATUS_COLOR[status];
	return (
		<span
			className={`cc-dot${pulses(status) ? " pulse" : ""}`}
			style={{ background: color, color }}
			title={status}
		/>
	);
}

export function Dot({ color, pulse }: { color: string; pulse?: boolean }) {
	return <span className={`cc-dot${pulse ? " pulse" : ""}`} style={{ background: color, color }} />;
}

export function BandChip({ band }: { band: Band }) {
	const color = BAND_COLOR[band];
	return (
		<span className="cc-chip" style={{ color, borderColor: color, background: `${color}14` }}>
			{BAND_LABEL[band]}
		</span>
	);
}

export function StatusChip({ status }: { status: Status }) {
	const color = STATUS_COLOR[status];
	return (
		<span
			className="cc-chip"
			style={{ color, borderColor: `${color}66`, background: `${color}0f` }}
		>
			{STATUS_LABEL[status]}
		</span>
	);
}

export function PanelHeader({ children, count }: { children: ReactNode; count?: number | string }) {
	return (
		<div className="cc-panel-header">
			<span>{children}</span>
			{count !== undefined && <span className="count">[{count}]</span>}
		</div>
	);
}

export function RelativeTime({ value }: { value: string | Date | undefined }) {
	return <span className="cc-time mono">{relTime(value)}</span>;
}

export function Panel({
	title,
	count,
	delay = 0,
	children,
	style,
}: {
	title?: ReactNode;
	count?: number | string;
	delay?: number;
	children: ReactNode;
	style?: React.CSSProperties;
}) {
	return (
		<div className="cc-panel" style={{ animationDelay: `${delay}ms`, ...style }}>
			{title && <PanelHeader count={count}>{title}</PanelHeader>}
			{children}
		</div>
	);
}
