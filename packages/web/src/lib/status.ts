/**
 * Status / band color language — the soul of the console.
 * Mirrors the four-band action policy: act→green, notify→amber, escalate→red,
 * prep→cyan; statuses tint by lifecycle (done/executed/resolved→green,
 * in-flight/needs-csm→amber/red, cancelled→grey, failed→red).
 */

export type Band = "act" | "notify-then-act" | "escalate" | "prep";
export type Status =
	| "done"
	| "in-flight"
	| "executed"
	| "cancelled"
	| "needs-csm"
	| "resolved"
	| "failed";

export const COLOR = {
	ok: "#3fb950",
	pending: "#d29922",
	danger: "#f85149",
	prep: "#39c5cf",
	grey: "#6b7787",
	cyan: "#2dd4bf",
} as const;

export const BAND_COLOR: Record<Band, string> = {
	act: COLOR.ok,
	"notify-then-act": COLOR.pending,
	escalate: COLOR.danger,
	prep: COLOR.prep,
};

export const BAND_LABEL: Record<Band, string> = {
	act: "ACT",
	"notify-then-act": "NOTIFY",
	escalate: "ESC",
	prep: "PREP",
};

export const STATUS_COLOR: Record<Status, string> = {
	done: COLOR.ok,
	executed: COLOR.ok,
	resolved: COLOR.ok,
	"in-flight": COLOR.pending,
	"needs-csm": COLOR.danger,
	cancelled: COLOR.grey,
	failed: COLOR.danger,
};

export const STATUS_LABEL: Record<Status, string> = {
	done: "DONE",
	executed: "EXECUTED",
	resolved: "RESOLVED",
	"in-flight": "IN-FLIGHT",
	"needs-csm": "NEEDS-CSM",
	cancelled: "CANCELLED",
	failed: "FAILED",
};

/** Statuses that warrant a pulsing dot (live attention). */
export function pulses(status: Status): boolean {
	return status === "in-flight" || status === "needs-csm" || status === "failed";
}

/** Relative-time string, monospace-friendly and compact. */
export function relTime(iso: string | Date | undefined): string {
	if (!iso) return "—";
	const t = typeof iso === "string" ? new Date(iso).getTime() : iso.getTime();
	if (Number.isNaN(t)) return "—";
	const sec = Math.floor((Date.now() - t) / 1000);
	if (sec < 0) return "now";
	if (sec < 60) return `${sec}s ago`;
	const min = Math.floor(sec / 60);
	if (min < 60) return `${min}m ago`;
	const hr = Math.floor(min / 60);
	if (hr < 24) return `${hr}h ago`;
	const d = Math.floor(hr / 24);
	return `${d}d ago`;
}

export function shortId(id: string): string {
	return id.slice(0, 8);
}
