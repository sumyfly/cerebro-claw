export interface ServerConfig {
	port: number;
	anthropicApiKey: string;
	larkAppId: string;
	larkAppSecret: string;
	brainLoopIntervalMs: number;
	model: string;
}

export function loadConfig(): ServerConfig {
	return {
		port: Number(process.env.PORT ?? 3000),
		anthropicApiKey: process.env.ANTHROPIC_API_KEY ?? "",
		larkAppId: process.env.LARK_APP_ID ?? "",
		larkAppSecret: process.env.LARK_APP_SECRET ?? "",
		brainLoopIntervalMs: Number(process.env.BRAIN_LOOP_INTERVAL_MS ?? 300_000),
		model: process.env.MODEL ?? "claude-sonnet-4-20250514",
	};
}
