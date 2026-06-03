import type { ServerConfig } from "./config.js";

export interface StartupCheck {
	name: string;
	ok: boolean;
	detail: string;
}

export function runStartupChecks(config: ServerConfig): StartupCheck[] {
	const runtimeCheck: StartupCheck = {
		name: "RUNTIME",
		ok: true,
		detail: `claude-code (subprocess: ${config.claudeBinary})`,
	};

	return [
		runtimeCheck,
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
		{
			name: "ADMIN_TOKEN",
			ok: Boolean(config.adminToken),
			detail: config.adminToken
				? "set — admin API requires bearer auth"
				: "missing — admin API is OPEN (dev only)",
		},
		{
			name: "LARK_VERIFICATION_TOKEN",
			ok: Boolean(config.larkVerificationToken),
			detail: config.larkVerificationToken
				? "set — webhook signatures verified"
				: "missing — webhooks accepted without verification (dev only)",
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
