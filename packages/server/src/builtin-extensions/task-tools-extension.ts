import type { ActionLedger, Extension, TaskSource } from "@cerebro-claw/shared";
import { createTaskTools } from "@cerebro-claw/tools";

export interface TaskToolsExtensionOptions {
	source: TaskSource;
	ledger: ActionLedger;
}

/**
 * Registers the task tools (task_list_open, task_get, task_complete,
 * task_block) bound to the configured TaskSource + the action ledger.
 *
 * This is a built-in (not a filesystem extension) because the tools need direct
 * ledger access to record task outcomes — the same reason the action-policy
 * tools are wired here rather than under extensions/. The real task backend
 * still binds behind the TaskSource interface, so swapping it out never touches
 * this wiring.
 */
export function createTaskToolsExtension(opts: TaskToolsExtensionOptions): Extension {
	return {
		id: "task-tools",
		factory: (api) => {
			const tools = createTaskTools({ source: opts.source, ledger: opts.ledger });
			for (const tool of tools) api.registerTool(tool);
		},
	};
}
