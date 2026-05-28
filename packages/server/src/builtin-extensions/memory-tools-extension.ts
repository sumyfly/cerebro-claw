import type { Extension } from "@cerebro-claw/shared";
import { createMemoryTools } from "@cerebro-claw/tools";

export const memoryToolsExtension: Extension = {
	id: "memory-tools",
	factory: (api) => {
		const tools = createMemoryTools(api.getStore());
		for (const tool of tools) api.registerTool(tool);
	},
};
