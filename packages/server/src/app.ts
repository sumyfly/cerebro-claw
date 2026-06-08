import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { verifyLarkSignature } from "@cerebro-claw/channel-lark";
import { SqliteActionLedger, SqliteSituationStore, SqliteStore } from "@cerebro-claw/memory";
import type {
	ActionLedger,
	CustomerChannel,
	MemoryStore,
	RenewalSource,
	SituationStore,
	TaskSource,
	Verifier,
} from "@cerebro-claw/shared";
import { StubCustomerChannel, StubRenewalSource, StubTaskSource } from "@cerebro-claw/tools";
import express, { type Express } from "express";
import { createActionObserver } from "./action-observer.js";
import type { AgentBackend } from "./agent-backend.js";
import { createAdminAuth } from "./auth.js";
import { BrainLoop, createCspAccountSource } from "./brain-loop.js";
import { createActionPolicyExtension } from "./builtin-extensions/action-policy-extension.js";
import { createBashToolExtension } from "./builtin-extensions/bash-tool-extension.js";
import { createLarkExtension } from "./builtin-extensions/lark-extension.js";
import { memoryToolsExtension } from "./builtin-extensions/memory-tools-extension.js";
import { createSituationToolsExtension } from "./builtin-extensions/situation-tools-extension.js";
import { createTaskToolsExtension } from "./builtin-extensions/task-tools-extension.js";
import { ClaudeCodeRuntime } from "./claude-code-runtime.js";
import { loadConfig } from "./config.js";
import { createCspRenewalSource } from "./csp-renewal-source.js";
import { createCspTaskSource } from "./csp-task-source.js";
import { computeDigestCounts, digestHeadline } from "./digest.js";
import { NotifyThenActDispatcher } from "./dispatcher.js";
import { resolveOverrideFromStore } from "./engine/overrides.js";
import { computeTriageScore, selectByTriage } from "./engine/triage.js";
import { ExtensionHost } from "./extension-host.js";
import { loadExtensionsFromDir } from "./extension-loader.js";
import { createMcpHandler } from "./mcp-server.js";
import { errorHandler, notFoundHandler, requestLogger } from "./middleware.js";
import { type RecentToolCall, createRecentToolCalls } from "./recent-tools.js";
import { Router } from "./router.js";
import { createLlmCriticVerifier } from "./verifier.js";

export interface AppHandles {
	app: Express;
	brainLoop: BrainLoop;
	dispatcher: NotifyThenActDispatcher;
	ledger: ActionLedger;
	customerChannel: CustomerChannel;
	store: MemoryStore;
	host: ExtensionHost;
	shutdown: () => Promise<void>;
}

export async function createApp(): Promise<AppHandles> {
	const config = loadConfig();
	const app = express();

	// Request logging (skips successful /health)
	app.use(requestLogger());

	// Capture raw body for webhooks (needed for signature verification)
	app.use(
		express.json({
			verify: (req, _res, buf) => {
				(req as unknown as { rawBody: string }).rawBody = buf.toString("utf8");
			},
		}),
	);

	// Admin auth — must come before API routes
	app.use(createAdminAuth(config.adminToken));

	// Memory (SQLite — survives restarts)
	mkdirSync(dirname(config.dbPath), { recursive: true });
	const store: MemoryStore = new SqliteStore(config.dbPath);

	// Action ledger — every act / notify / escalate / prep lands here
	const ledger: ActionLedger = new SqliteActionLedger(config.dbPath);

	// Situation store — persistent storylines so the agent advances, not re-discovers
	const situationStore: SituationStore = new SqliteSituationStore(config.dbPath);

	// The CSP test backend serves an untrusted/expired TLS cert, which Node's
	// fetch rejects. CSP_INSECURE_TLS is the opt-in escape hatch for dev/test.
	// The brain-loop CSP account source and the csp-connector tools both rely on
	// this being set process-wide before any CSP fetch.
	if (
		process.env.CSP_TOKEN &&
		process.env.CSP_CSM_EMAIL &&
		/^(1|true|yes)$/i.test(process.env.CSP_INSECURE_TLS ?? "")
	) {
		process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0";
		console.warn(
			"[csp] CSP_INSECURE_TLS=true — TLS certificate verification is OFF process-wide. Dev/test only.",
		);
	}

	// Customer channel — stub by default. Real channels (email, SMS) drop in
	// as extensions later by implementing CustomerChannel.
	const customerChannel: CustomerChannel = new StubCustomerChannel();

	// Extension host — collects tools, channels, and event handlers
	const host = new ExtensionHost({
		store,
		config: { dbPath: config.dbPath, model: config.model },
	});

	// Lark extension also returns the bot for webhook handling
	const lark = createLarkExtension({
		appId: config.larkAppId,
		appSecret: config.larkAppSecret,
		store,
		defaultCsmLarkUserId: config.defaultCsmLarkUserId || undefined,
		onMessage: async (text, senderId, _channelId) => {
			const sessionId = `lark:${senderId}`;
			const message = {
				channelType: "lark",
				channelId: _channelId,
				senderId,
				senderName: senderId,
				text,
				timestamp: new Date(),
			};
			await host.emit("channel_message_received", message);
			const reply = await router.handleMessage(message, sessionId);
			if (reply) await host.emit("channel_message_sent", { recipientId: _channelId, text: reply });
			return reply;
		},
	});

	// Task source — the CSM's Cerebro work queue. Selection:
	//   TASK_SOURCE=csp            → live CSP Task API (reuses CSP_BASE_URL/CSP_TOKEN)
	//   TASK_SOURCE=stub           → in-memory demo queue (dev/demo)
	//   TASK_API_BASE_URL set       → standalone task backend (not yet bound)
	//   neither                     → task iteration skipped (logged)
	let taskSource: TaskSource | null = null;
	if (config.taskSource === "csp") {
		if (process.env.CSP_TOKEN) {
			taskSource = createCspTaskSource({
				baseUrl: process.env.CSP_BASE_URL ?? "http://localhost:5656",
				token: process.env.CSP_TOKEN,
				scope: (process.env.TASK_SCOPE as "all" | "mine") ?? "all",
				maxTasks: process.env.TASK_MAX ? Number(process.env.TASK_MAX) : undefined,
			});
			console.log(`[tasks] Using CspTaskSource (scope=${process.env.TASK_SCOPE ?? "all"})`);
		} else {
			console.warn("[tasks] TASK_SOURCE=csp but CSP_TOKEN is not set — task iteration skipped.");
		}
	} else if (config.taskSource === "stub") {
		taskSource = new StubTaskSource();
		console.log("[tasks] Using StubTaskSource (in-memory demo queue)");
	} else if (config.taskApiBaseUrl) {
		// A standalone (non-CSP) task backend would bind here behind the same
		// TaskSource interface.
		console.warn(
			`[tasks] TASK_API_BASE_URL set (${config.taskApiBaseUrl}) but no standalone connector is bound — task iteration skipped. Use TASK_SOURCE=csp or =stub.`,
		);
	} else {
		console.log("[tasks] No task source configured — task iteration skipped.");
	}

	// Renewal source — upcoming/at-risk renewals as a first-class swept input.
	//   RENEWAL_SOURCE=csp   → derive from accounts + per-account renewals (window-filtered)
	//   RENEWAL_SOURCE=stub  → in-memory demo queue
	//   unset                → renewal sweep skipped (logged)
	let renewalSource: RenewalSource | null = null;
	if (config.renewalSource === "csp") {
		if (process.env.CSP_TOKEN && process.env.CSP_CSM_EMAIL) {
			renewalSource = createCspRenewalSource({
				baseUrl: process.env.CSP_BASE_URL ?? "http://localhost:5656",
				token: process.env.CSP_TOKEN,
				csmEmail: process.env.CSP_CSM_EMAIL,
				windowDays: config.renewalWindowDays,
			});
			console.log(`[renewals] Using CspRenewalSource (window=${config.renewalWindowDays}d)`);
		} else {
			console.warn(
				"[renewals] RENEWAL_SOURCE=csp but CSP_TOKEN/CSP_CSM_EMAIL not set — renewal sweep skipped.",
			);
		}
	} else if (config.renewalSource === "stub") {
		renewalSource = new StubRenewalSource();
		console.log("[renewals] Using StubRenewalSource (in-memory demo queue)");
	} else {
		console.log("[renewals] No renewal source configured — renewal sweep skipped.");
	}

	// Verifier (critic) — gates notify-then-act / escalate before they commit.
	// The default critic needs the agent, which is created AFTER extensions load,
	// so we pass a deferred closure: verify is only ever CALLED at action time,
	// long after `verifier` is assigned below.
	const verifyEnabled = !/^(0|false|no)$/i.test(process.env.VERIFY_ENABLED ?? "");
	const verifyBands = (process.env.VERIFY_BANDS ?? "notify-then-act,escalate")
		.split(",")
		.map((s) => s.trim())
		.filter(Boolean);
	let verifier: Verifier | null = null;

	// Load extensions: built-in first, then any from the extensions/ directory
	const userExtensions = await loadExtensionsFromDir(config.extensionsDir);
	await host.load([
		memoryToolsExtension,
		createActionPolicyExtension({
			ledger,
			customerChannel,
			host,
			defaultCsmRecipientId: config.defaultCsmLarkUserId || undefined,
			defaultPauseMinutes: config.defaultPauseMinutes,
			// Enforce stored overrides as a hard gate (overrides are taught by the
			// CSM as instinct notes; resolveOverrideFromStore parses them).
			resolveOverride: (customerId) => resolveOverrideFromStore(store, customerId),
			verify: verifyEnabled
				? (input) =>
						verifier
							? verifier.verify(input)
							: Promise.resolve({ pass: true, reason: "verifier not ready" })
				: undefined,
			verifyBands,
		}),
		createBashToolExtension({
			allowlist: config.bashAllowlist,
			timeoutMs: config.bashTimeoutMs,
		}),
		createSituationToolsExtension({ store: situationStore }),
		// Task tools only register when a task source is configured.
		...(taskSource ? [createTaskToolsExtension({ source: taskSource, ledger })] : []),
		lark.extension,
		...userExtensions,
	]);

	// Recent tool-call feed (last 100) for the Skills tab's live activity panel.
	const recentTools = createRecentToolCalls();
	const actionObserver = createActionObserver(ledger);
	// Compose two observers onto the single MCP onToolCall hook: the action
	// observer keeps the ledger honest, the recorder feeds /api/tools/recent.
	// Both run per tool call; an error in one must not skip the other.
	const onToolCall = async (
		name: string,
		params: Record<string, unknown>,
		result: { content: string; success: boolean },
	): Promise<void> => {
		const customerId = String(params.business_id ?? params.customer_id ?? "") || undefined;
		recentTools.record({
			tool: name,
			ts: new Date().toISOString(),
			ok: result.success,
			...(customerId ? { customerId } : {}),
		});
		await actionObserver(name, params, result);
	};

	// MCP endpoint — exposes our tools to any external MCP client (Claude Code
	// subprocess, Cursor, etc.). The Claude Code runtime uses this to call our
	// tools without an Anthropic API key.
	app.post(
		"/mcp",
		createMcpHandler({
			tools: () => host.getTools(),
			onToolCall,
		}),
	);

	// Agent runtime — Claude Code subprocess, reached over the MCP endpoint above.
	const mcpUrl = `http://127.0.0.1:${config.port}/mcp`;
	const agent: AgentBackend = new ClaudeCodeRuntime(
		config.model,
		host.getTools(),
		config.claudeBinary,
		mcpUrl,
	);
	console.log("[runtime] Using claude-code");

	// Now the agent exists — bind the default LLM critic (deferred closure above).
	if (verifyEnabled) {
		verifier = createLlmCriticVerifier(agent);
		console.log(`[verify] Critic enabled for bands: ${verifyBands.join(", ")}`);
	} else {
		console.log("[verify] Verification disabled (VERIFY_ENABLED=false).");
	}

	// Router and brain loop (brain loop emits lifecycle events through the host).
	// BRAIN_LOOP_ENABLED=false keeps the API/UI up without spawning agent cycles
	// (useful for UI work, or running the dashboard against live data read-only).
	const router = new Router(agent, { store });
	const brainLoopEnabled = !/^(0|false|no)$/i.test(process.env.BRAIN_LOOP_ENABLED ?? "");

	// Pick account source: CSP (live) when CSP_TOKEN + CSP_CSM_EMAIL are configured,
	// otherwise fall back to the local SQLite store (demo / seed mode).
	const cspSource =
		process.env.CSP_TOKEN && process.env.CSP_CSM_EMAIL
			? createCspAccountSource({
					baseUrl: process.env.CSP_BASE_URL ?? "http://localhost:5656",
					token: process.env.CSP_TOKEN,
					csmEmail: process.env.CSP_CSM_EMAIL,
					maxAccounts: process.env.CSP_MAX_ACCOUNTS
						? Number(process.env.CSP_MAX_ACCOUNTS)
						: undefined,
					store,
					situationStore,
				})
			: undefined;

	const brainLoop = new BrainLoop(
		store,
		agent,
		config.brainLoopIntervalMs,
		brainLoopEnabled,
		host,
		cspSource,
		taskSource,
		ledger,
		renewalSource,
		situationStore,
		config.triageMax,
		config.triageMinScore,
		config.brainLoopRunOnStart,
	);

	// Dispatcher — picks up due notify-then-act sends and pushes them through
	// the customer channel. Always on, regardless of agent runtime.
	const dispatcher = new NotifyThenActDispatcher({
		ledger,
		customerChannel,
		intervalMs: config.dispatcherIntervalMs,
	});

	// --- HTTP Routes ---

	app.get("/health", (_req, res) => {
		res.json({
			status: "ok",
			uptime: process.uptime(),
			extensions: host.getLoadedExtensions(),
			channels: host.getChannels().map((c) => c.type),
			tools: host.getTools().map((t) => t.name),
		});
	});

	// Lark webhook (signature-verified if token is configured)
	app.post("/webhook/lark", async (req, res) => {
		try {
			if (config.larkVerificationToken) {
				const timestamp = req.header("X-Lark-Request-Timestamp") ?? "";
				const nonce = req.header("X-Lark-Request-Nonce") ?? "";
				const signature = req.header("X-Lark-Signature") ?? "";
				const rawBody = (req as unknown as { rawBody?: string }).rawBody ?? "";

				// URL verification challenges arrive before signing is set up
				if (req.body.type !== "url_verification") {
					if (
						!verifyLarkSignature(config.larkVerificationToken, timestamp, nonce, rawBody, signature)
					) {
						res.status(401).json({ error: "Invalid signature" });
						return;
					}
				}
			}
			const result = await lark.bot.handleWebhook(req.body);
			res.json(result ?? { ok: true });
		} catch (err) {
			console.error("[webhook/lark] Error:", err);
			res.status(500).json({ error: "Internal error" });
		}
	});

	// --- API Routes (for admin web UI) ---

	// Action ledger — the agent's daily work log. Drives the digest.
	app.get("/api/ledger", async (req, res) => {
		const sinceStr = (req.query.since as string) ?? "";
		const untilStr = (req.query.until as string) ?? "";
		const since = sinceStr ? new Date(sinceStr) : new Date(Date.now() - 24 * 3600 * 1000);
		const until = untilStr ? new Date(untilStr) : new Date();
		const entries = await ledger.listByWindow(since, until);
		res.json({ since: since.toISOString(), until: until.toISOString(), entries });
	});

	app.get("/api/ledger/open", async (_req, res) => {
		const entries = await ledger.listOpen();
		res.json(entries);
	});

	app.post("/api/ledger/:id/cancel", async (req, res) => {
		const existing = await ledger.get(req.params.id);
		if (!existing) {
			res.status(404).json({ error: "Not found" });
			return;
		}
		if (existing.band !== "notify-then-act" && existing.band !== "escalate") {
			res.status(400).json({ error: "Only notify-then-act and escalate can be cancelled" });
			return;
		}
		if (existing.status !== "in-flight" && existing.status !== "needs-csm") {
			res.status(400).json({ error: `Cannot cancel — already ${existing.status}` });
			return;
		}
		const updated = await ledger.update(req.params.id, {
			status: "cancelled",
			note: (req.body?.reason as string) ?? "cancelled via admin API",
			executedAt: new Date(),
		});
		res.json(updated);
	});

	app.post("/api/ledger/:id/resolve", async (req, res) => {
		const existing = await ledger.get(req.params.id);
		if (!existing) {
			res.status(404).json({ error: "Not found" });
			return;
		}
		if (existing.band !== "escalate") {
			res.status(400).json({ error: "Only escalations can be resolved" });
			return;
		}
		const updated = await ledger.update(req.params.id, {
			status: "resolved",
			note: (req.body?.outcome as string) ?? "resolved via admin API",
			executedAt: new Date(),
		});
		res.json(updated);
	});

	// "Yesterday: 47 acts, 12 notifies in-flight, 3 situations need you."
	app.get("/api/digest/counters", async (req, res) => {
		const windowHours = Number(req.query.hours ?? 24);
		const counts = await computeDigestCounts(ledger, new Date(), windowHours, situationStore);
		res.json({ headline: digestHeadline(counts), counts });
	});

	// Situations needing the CSM — open storylines (escalated OR needsAttention),
	// each joined with its ledger storyline, plus a watching count.
	app.get("/api/situations", async (_req, res) => {
		const needing = await situationStore.listNeedingCsm();
		const watching = await situationStore.listWatching();
		const items = await Promise.all(
			needing.map(async (s) => ({
				...s,
				storyline: await ledger.listBySituation(s.id),
			})),
		);
		res.json({ needsCsm: items, watchingCount: watching.length });
	});

	// Triage queue — how the work loop would rank/spend this cycle. Recomputed on
	// demand from the renewal + task sources (cheap, no model call). Shows the
	// budget (TRIAGE_MAX/MIN) and which subjects would be deferred and why.
	app.get("/api/triage", async (_req, res) => {
		const max = config.triageMax > 0 ? config.triageMax : Number.POSITIVE_INFINITY;
		const minScore = config.triageMinScore;
		const renewals = renewalSource ? await renewalSource.listOpen() : [];
		const tasks = taskSource ? await taskSource.listOpen() : [];
		const renewalQ = selectByTriage(
			renewals,
			(r) =>
				computeTriageScore({
					atRisk: r.atRisk,
					daysToRenewal: r.daysToRenewal,
					contractValue: r.arr,
				}),
			{ max, minScore },
		);
		const taskQ = selectByTriage(tasks, (t) => computeTriageScore({ priority: t.priority }), {
			max,
			minScore,
		});
		res.json({
			budget: { max: config.triageMax, minScore },
			renewals: { selected: renewalQ.selected, deferred: renewalQ.deferred },
			tasks: { selected: taskQ.selected, deferred: taskQ.deferred },
		});
	});

	// Task queue for the ops console — open tasks joined with the agent's
	// recorded outcome (band + status) from the ledger via the task-id tag.
	app.get("/api/tasks", async (_req, res) => {
		if (!taskSource) {
			res.json({ configured: false, label: null, open: [], recentOutcomes: [] });
			return;
		}
		const open = await taskSource.listOpen();
		const since = new Date(Date.now() - 24 * 3600 * 1000);
		const ledgerEntries = await ledger.listByWindow(since, new Date(Date.now() + 1));
		// Index ledger entries by their task-id tag (latest wins).
		const byTask = new Map<string, (typeof ledgerEntries)[number]>();
		for (const e of ledgerEntries) {
			const taskId = (e.payload as { taskId?: unknown } | undefined)?.taskId;
			if (typeof taskId === "string") byTask.set(taskId, e);
		}
		res.json({
			configured: true,
			label: taskSource.label,
			open: open.map((t) => {
				const action = byTask.get(t.id);
				return {
					...t,
					latestAction: action
						? { band: action.band, status: action.status, summary: action.summary }
						: null,
				};
			}),
			recentOutcomes: ledgerEntries
				.filter((e) => (e.payload as { taskId?: unknown } | undefined)?.taskId)
				.map((e) => ({
					taskId: (e.payload as { taskId?: string }).taskId,
					band: e.band,
					status: e.status,
					summary: e.summary,
					createdAt: e.createdAt,
				})),
		});
	});

	// Recent tool invocations (newest first) — live activity feed for the Skills tab.
	app.get("/api/tools/recent", (_req, res) => {
		const calls: RecentToolCall[] = recentTools.list();
		res.json(calls);
	});

	// Extension introspection (useful for the admin UI)
	app.get("/api/extensions", (_req, res) => {
		res.json({
			loaded: host.getLoadedExtensions(),
			channels: host.getChannels().map((c) => c.type),
			tools: host.getTools().map((t) => ({ name: t.name, description: t.description })),
		});
	});

	// Diagnostics — actually test external service connectivity
	app.get("/api/diagnostics", async (_req, res) => {
		const results: Record<string, { ok: boolean; detail?: string }> = {};

		// Database
		try {
			await store.listProfiles();
			results.database = { ok: true, detail: "responsive" };
		} catch (err) {
			results.database = { ok: false, detail: String(err) };
		}

		// Runtime (Claude Code CLI)
		const ping = await agent.ping();
		results.runtime = { ok: ping.ok, detail: ping.ok ? "claude-code: CLI ready" : ping.error };

		// Lark
		if (!config.larkAppId || !config.larkAppSecret) {
			results.lark = { ok: false, detail: "LARK_APP_ID/SECRET not set" };
		} else {
			results.lark = {
				ok: true,
				detail: "credentials configured (call from Lark to fully verify)",
			};
		}

		res.json(results);
	});

	// 404 (must come after all routes) + global error handler (must be last)
	app.use(notFoundHandler());
	app.use(errorHandler());

	const shutdown = async () => {
		brainLoop.stop();
		dispatcher.stop();
		await host.shutdown();
		if (ledger instanceof SqliteActionLedger) (ledger as SqliteActionLedger).close();
		if (situationStore instanceof SqliteSituationStore)
			(situationStore as SqliteSituationStore).close();
		if (store instanceof SqliteStore) (store as SqliteStore).close();
	};

	return { app, brainLoop, dispatcher, ledger, customerChannel, store, host, shutdown };
}
