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
	/** Task input selection: "csp" (live, reuses CSP_*) / "stub" / unset = task sweep skipped. */
	taskSource: string;
	/** Renewal input selection: "csp" (live, reuses CSP_*) / "stub" / unset = renewal sweep skipped. */
	renewalSource: string;
	/** Only sweep renewals due within this many days (or at-risk). Default 90 (T-90 onward). */
	renewalWindowDays: number;
	/** Triage: max subjects worked per input per cycle. 0 = disabled (work all — current behavior). */
	triageMax: number;
	/** Triage: minimum score to be worth an agent turn. */
	triageMinScore: number;
	/** Skip gate: unchanged accounts skip their agent turn. SKIP_GATE=off disables. */
	skipGateEnabled: boolean;
	/** Skip gate: a renewal within this many days always bypasses the gate. */
	skipGateRenewalHorizonDays: number;
	/** Skip gate: force a review after this many days skipped, even if unchanged. */
	skipGateMaxAgeDays: number;
	/** Max concurrent agent turns within a sweep. 1 = serial. */
	brainConcurrency: number;
	/** Model for the critic verifier (cheap/fast). Unset = share the main agent. */
	verifierModel: string;
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
		taskSource: process.env.TASK_SOURCE ?? "",
		renewalSource: process.env.RENEWAL_SOURCE ?? "",
		renewalWindowDays: Number(process.env.RENEWAL_WINDOW_DAYS ?? 90),
		triageMax: Number(process.env.TRIAGE_MAX ?? 0),
		triageMinScore: Number(process.env.TRIAGE_MIN_SCORE ?? 0),
		skipGateEnabled: !/^(0|off|false|no)$/i.test(process.env.SKIP_GATE ?? ""),
		skipGateRenewalHorizonDays: Number(process.env.SKIP_GATE_RENEWAL_HORIZON_DAYS ?? 90),
		skipGateMaxAgeDays: Number(process.env.SKIP_GATE_MAX_AGE_DAYS ?? 7),
		brainConcurrency: (() => {
			const n = Number(process.env.BRAIN_CONCURRENCY ?? 3);
			return Number.isFinite(n) ? Math.max(1, Math.floor(n)) : 3;
		})(),
		verifierModel: process.env.VERIFIER_MODEL ?? "",
	};
}
