/**
 * Sample extension: greeting tool.
 *
 * This shows how a third-party extension plugs into Cerebro Claw without
 * editing any core code. Drop a directory here, give it an `index.ts` (or .js)
 * that default-exports an Extension, and the server picks it up at startup.
 *
 * Run: server logs "[extensions] Discovered: sample-greeting (sample-greeting)"
 * then "[extensions] Loaded: sample-greeting".
 *
 * To use: the agent now has a `greeting` tool it can call.
 */
import type { Extension } from "@cerebro-claw/shared";

const greetingExtension: Extension = {
	id: "sample-greeting",
	factory: (api) => {
		api.registerTool({
			name: "greeting",
			description:
				"Return a friendly greeting for a person by name. Demo tool to verify the extension system works.",
			parameters: {
				type: "object",
				properties: {
					name: { type: "string", description: "The person's name" },
				},
				required: ["name"],
			},
			async execute(params) {
				const name = (params.name as string) ?? "friend";
				return {
					content: `Hello, ${name}! (from extension ${api.extensionId})`,
					success: true,
				};
			},
		});

		api.on("brain_loop_cycle_start", () => {
			console.log(`[${api.extensionId}] brain loop cycle starting`);
		});
	},
};

export default greetingExtension;
