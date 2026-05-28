import type { Extension } from "@cerebro-claw/shared";
import { createBashTool } from "@cerebro-claw/tools";

export interface BashToolExtensionOptions {
	allowlist: string[];
	timeoutMs?: number;
}

export function createBashToolExtension(opts: BashToolExtensionOptions): Extension {
	return {
		id: "bash-tool",
		factory: (api) => {
			api.registerTool(createBashTool(opts));
		},
	};
}
