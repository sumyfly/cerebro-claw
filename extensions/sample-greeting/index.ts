/**
 * Sample extension: demonstrates registering a tool, a channel-style helper,
 * and a brain-loop event hook.
 *
 * Drop this directory anywhere under extensions/ and the server picks it up
 * at startup (see loadExtensionsFromDir).
 *
 * Two demos in here:
 *
 *  1. `greeting` — toy tool to prove tool registration works.
 *  2. `service_status` — real-world pattern: a tool that fetches live data
 *     via the bash tool. The agent calls `service_status` and it returns
 *     the HTTP status code from a public endpoint (api.github.com).
 *     This pattern (extension wraps bash+curl) is how M3 connectors will
 *     plug in CRM / usage / ticket APIs without modifying core code.
 */
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { Extension } from "@cerebro-claw/shared";

const exec = promisify(execFile);

const sampleExtension: Extension = {
	id: "sample-greeting",
	factory: (api) => {
		api.registerTool({
			name: "greeting",
			kind: "observe",
			blastRadius: "none",
			description:
				"Return a friendly greeting for a person by name. Demo tool to verify extension registration.",
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

		api.registerTool({
			name: "service_status",
			kind: "observe",
			blastRadius: "none",
			description:
				"Check whether an external service is up. Returns HTTP status code from a HEAD request. Use this as an example of how an extension can wrap a real data source for the agent.",
			parameters: {
				type: "object",
				properties: {
					url: {
						type: "string",
						description: "URL to probe (https only)",
					},
				},
				required: ["url"],
			},
			async execute(params) {
				const url = params.url as string;
				if (!/^https:\/\//.test(url)) {
					return { content: "Only https:// URLs are allowed.", success: false };
				}
				try {
					const { stdout } = await exec("curl", [
						"-sS",
						"-o",
						"/dev/null",
						"-w",
						"%{http_code}",
						"--max-time",
						"5",
						url,
					]);
					const code = Number.parseInt(stdout, 10);
					return {
						content: `${url} → HTTP ${code}`,
						success: code >= 200 && code < 400,
						details: { httpCode: code },
					};
				} catch (err) {
					return {
						content: `Failed to reach ${url}: ${(err as Error).message}`,
						success: false,
					};
				}
			},
		});

		api.on("brain_loop_cycle_start", () => {
			console.log(`[${api.extensionId}] brain loop cycle starting`);
		});
	},
};

export default sampleExtension;
