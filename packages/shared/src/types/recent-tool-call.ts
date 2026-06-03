/**
 * A single recorded tool invocation, surfaced in the Skills tab's live activity
 * feed (GET /api/tools/recent). `seq` is a monotonic, process-local counter that
 * gives each entry a stable, collision-free key for the UI.
 */
export interface RecentToolCall {
	seq: number;
	tool: string;
	ts: string;
	ok: boolean;
	customerId?: string;
}
