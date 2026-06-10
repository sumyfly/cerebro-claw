/**
 * In-memory ring buffer of recent tool invocations, for the Skills tab's live
 * activity feed (GET /api/tools/recent). No persistence — it captures whatever
 * tool calls have flowed through the MCP onToolCall hook since the process
 * started. Since claude-code is the only runtime, every tool call (chat,
 * brain-loop, dispatcher) passes through /mcp, so this sees all of them.
 */

import type { RecentToolCall } from "@cerebro-claw/shared";

export type { RecentToolCall };

/** Callers record everything except `seq`; the buffer assigns the sequence id. */
export type RecordableToolCall = Omit<RecentToolCall, "seq">;

export interface RecentToolCalls {
	/** Record one tool invocation. A monotonic `seq` is assigned internally. */
	record(entry: RecordableToolCall): void;
	/** Return buffered calls, newest first. */
	list(): RecentToolCall[];
}

const MAX = 100;

export function createRecentToolCalls(max = MAX): RecentToolCalls {
	const buffer: RecentToolCall[] = [];
	let seq = 0;
	return {
		record(entry) {
			seq += 1;
			buffer.push({ ...entry, seq });
			if (buffer.length > max) buffer.shift();
		},
		list() {
			// Newest first.
			return [...buffer].reverse();
		},
	};
}
