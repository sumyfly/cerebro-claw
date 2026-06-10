import type { Extension, SituationStore } from "@cerebro-claw/shared";
import { createSituationTools } from "@cerebro-claw/tools";

export interface SituationToolsExtensionOptions {
	store: SituationStore;
}

/**
 * Registers the situation tools (situation_open, situation_advance,
 * situation_resolve, situation_list) bound to the SituationStore.
 *
 * Built-in (not a filesystem extension) because, like the action-policy and
 * task tools, these need direct store access. Situations are how the agent
 * remembers a storyline across cycles instead of re-discovering it.
 */
export function createSituationToolsExtension(opts: SituationToolsExtensionOptions): Extension {
	return {
		id: "situation-tools",
		factory: (api) => {
			const tools = createSituationTools({ store: opts.store });
			for (const tool of tools) api.registerTool(tool);
		},
	};
}
