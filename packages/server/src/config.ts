import { homedir } from "node:os";
import { join } from "node:path";
import { DEFAULT_ALLOWLIST } from "@cerebro-claw/tools";

export interface ServerConfig {
	port: number;
	anthropicApiKey: string;
	larkAppId: string;
	larkAppSecret: string;
	brainLoopIntervalMs: number;
	model: string;
	dbPath: string;
	bashAllowlist: string[];
	bashTimeoutMs: number;
	extensionsDir: string;
}

export function loadConfig(): ServerConfig {
	const allowlistEnv = process.env.BASH_ALLOWLIST;
	const bashAllowlist = allowlistEnv
		? allowlistEnv.split(",").map((s) => s.trim()).filter(Boolean)
		: DEFAULT_ALLOWLIST;

	return {
		port: Number(process.env.PORT ?? 3000),
		anthropicApiKey: process.env.ANTHROPIC_API_KEY ?? "",
		larkAppId: process.env.LARK_APP_ID ?? "",
		larkAppSecret: process.env.LARK_APP_SECRET ?? "",
		brainLoopIntervalMs: Number(process.env.BRAIN_LOOP_INTERVAL_MS ?? 300_000),
		model: process.env.MODEL ?? "claude-sonnet-4-20250514",
		dbPath: process.env.DB_PATH ?? join(homedir(), ".cerebro-claw", "data.db"),
		bashAllowlist,
		bashTimeoutMs: Number(process.env.BASH_TIMEOUT_MS ?? 30_000),
		extensionsDir: process.env.EXTENSIONS_DIR ?? join(process.cwd(), "extensions"),
	};
}
