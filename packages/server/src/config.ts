import { homedir } from "node:os";
import { join } from "node:path";
import { DEFAULT_ALLOWLIST } from "@cerebro-claw/tools";

export interface ServerConfig {
	port: number;
	larkAppId: string;
	larkAppSecret: string;
	brainLoopIntervalMs: number;
	/** Run a cycle immediately on boot. Default false — avoids a token tax on every dev restart. */
	brainLoopRunOnStart: boolean;
	model: string;
	dbPath: string;
	bashAllowlist: string[];
	bashTimeoutMs: number;
	extensionsDir: string;
	adminToken: string;
	larkVerificationToken: string;
	claudeBinary: string;
	defaultCsmLarkUserId: string;
	dispatcherIntervalMs: number;
	defaultPauseMinutes: number;
	/** Task backend base URL. When unset (and TASK_SOURCE!=stub), task iteration is skipped. */
	taskApiBaseUrl: string;
	/** Task backend bearer token. */
	taskApiToken: string;
	/** CSM identity passed to the task backend (email/id). */
	taskCsmEmail: string;
	/** Force the in-memory StubTaskSource ("stub") regardless of TASK_API_*. Dev/demo. */
	taskSource: string;
	/** Renewal input selection: "csp" (live, reuses CSP_*) / "stub" / unset = renewal sweep skipped. */
	renewalSource: string;
	/** Only sweep renewals due within this many days (or at-risk). Default 90 (T-90 onward). */
	renewalWindowDays: number;
	/** Triage: max subjects worked per input per cycle. 0 = disabled (work all — current behavior). */
	triageMax: number;
	/** Triage: minimum score to be worth an agent turn. */
	triageMinScore: number;
}

export function loadConfig(): ServerConfig {
	const allowlistEnv = process.env.BASH_ALLOWLIST;
	const bashAllowlist = allowlistEnv
		? allowlistEnv
				.split(",")
				.map((s) => s.trim())
				.filter(Boolean)
		: DEFAULT_ALLOWLIST;

	return {
		port: Number(process.env.PORT ?? 5100),
		larkAppId: process.env.LARK_APP_ID ?? "",
		larkAppSecret: process.env.LARK_APP_SECRET ?? "",
		brainLoopIntervalMs: Number(process.env.BRAIN_LOOP_INTERVAL_MS ?? 300_000),
		brainLoopRunOnStart: /^(1|true|yes)$/i.test(process.env.BRAIN_LOOP_RUN_ON_START ?? ""),
		model: process.env.MODEL ?? "claude-sonnet-4-20250514",
		dbPath: process.env.DB_PATH ?? join(homedir(), ".cerebro-claw", "data.db"),
		bashAllowlist,
		bashTimeoutMs: Number(process.env.BASH_TIMEOUT_MS ?? 30_000),
		extensionsDir: process.env.EXTENSIONS_DIR ?? join(process.cwd(), "extensions"),
		adminToken: process.env.ADMIN_TOKEN ?? "",
		larkVerificationToken: process.env.LARK_VERIFICATION_TOKEN ?? "",
		claudeBinary: process.env.CLAUDE_BINARY ?? "claude",
		defaultCsmLarkUserId: process.env.DEFAULT_CSM_LARK_USER_ID ?? "",
		dispatcherIntervalMs: Number(process.env.DISPATCHER_INTERVAL_MS ?? 60_000),
		defaultPauseMinutes: Number(process.env.DEFAULT_PAUSE_MINUTES ?? 240),
		taskApiBaseUrl: process.env.TASK_API_BASE_URL ?? "",
		taskApiToken: process.env.TASK_API_TOKEN ?? "",
		taskCsmEmail: process.env.TASK_CSM_EMAIL ?? "",
		taskSource: process.env.TASK_SOURCE ?? "",
		renewalSource: process.env.RENEWAL_SOURCE ?? "",
		renewalWindowDays: Number(process.env.RENEWAL_WINDOW_DAYS ?? 90),
		triageMax: Number(process.env.TRIAGE_MAX ?? 0),
		triageMinScore: Number(process.env.TRIAGE_MIN_SCORE ?? 0),
	};
}
