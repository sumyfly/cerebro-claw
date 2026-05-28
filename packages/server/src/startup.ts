import type { ServerConfig } from "./config.js";

export interface StartupCheck {
	name: string;
	ok: boolean;
	detail: string;
}

export function runStartupChecks(config: ServerConfig): StartupCheck[] {
	return [
		{
			name: "ANTHROPIC_API_KEY",
			ok: config.anthropicApiKey.startsWith("sk-ant-"),
			detail: config.anthropicApiKey
				? config.anthropicApiKey.startsWith("sk-ant-")
					? "set"
					: "set but does not look like an Anthropic key (expected prefix sk-ant-)"
				: "missing — chat and brain loop will not work",
		},
		{
			name: "LARK_APP_ID",
			ok: Boolean(config.larkAppId),
			detail: config.larkAppId ? "set" : "missing — Lark channel disabled",
		},
		{
			name: "LARK_APP_SECRET",
			ok: Boolean(config.larkAppSecret),
			detail: config.larkAppSecret ? "set" : "missing — Lark channel disabled",
		},
		{
			name: "Database",
			ok: true,
			detail: config.dbPath,
		},
		{
			name: "Brain loop",
			ok: true,
			detail: `${config.brainLoopIntervalMs / 1000}s interval`,
		},
		{
			name: "Bash allowlist",
			ok: true,
			detail: config.bashAllowlist.join(", "),
		},
	];
}

export function printStartupBanner(checks: StartupCheck[]): void {
	console.log("");
	console.log("┌─ Cerebro Claw — startup check ────────────────────");
	for (const c of checks) {
		const mark = c.ok ? "✓" : "✗";
		console.log(`│ ${mark} ${c.name.padEnd(22)} ${c.detail}`);
	}
	console.log("└────────────────────────────────────────────────────");
	console.log("");

	const failing = checks.filter((c) => !c.ok);
	if (failing.length > 0) {
		console.log(`[startup] ${failing.length} optional component(s) not configured.`);
		console.log("[startup] Server will start in degraded mode. Add credentials to .env to enable.");
		console.log("");
	}
}
