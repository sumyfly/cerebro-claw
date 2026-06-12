import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { verifyLarkSignature } from "@cerebro-claw/channel-lark";
import {
	SqliteActionLedger,
	SqliteCapabilityStore,
	SqliteSituationStore,
	SqliteStore,
} from "@cerebro-claw/memory";
import type {
	ActionLedger,
	CapabilityStore,
	CustomerChannel,
	MemoryStore,
	RenewalSource,
	SituationStore,
	TaskSource,
	Verifier,
} from "@cerebro-claw/shared";
import { StubCustomerChannel, StubRenewalSource, StubTaskSource } from "@cerebro-claw/tools";
import express, { type Express, type Request, type Response } from "express";
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
import { CspCustomerChannel } from "./csp-customer-channel.js";
import { createCspRenewalSource } from "./csp-renewal-source.js";
import { createCspTaskSource } from "./csp-task-source.js";
import { computeDigestCounts, digestHeadline } from "./digest.js";
import { NotifyThenActDispatcher } from "./dispatcher.js";
import { resolveOverrideFromStore } from "./engine/overrides.js";
import { computeTriageScore, selectByTriage } from "./engine/triage.js";
import { ExtensionHost } from "./extension-host.js";
import { loadExtensionsFromDir } from "./extension-loader.js";
import { TurnRegistry, createMcpHarnessHandler, wrapLedgerForHarness } from "./harness/index.js";
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

	// Action ledger — every act / notify / escalate / prep lands here. The raw
	// ledger is the dispatcher/digest source; tools see the harness-wrapped
	// variant below so every record() auto-inherits turn scope.
	const rawLedger: ActionLedger = new SqliteActionLedger(config.dbPath);

	// Situation store — persistent storylines so the agent advances, not re-discovers
	const situationStore: SituationStore = new SqliteSituationStore(config.dbPath);

	// Capability store — grants the CSM issues when resolving escalations, used
	// to unlock customer-irreversible tools for bounded one-time use.
	const capabilityStore: CapabilityStore = new SqliteCapabilityStore(config.dbPath);

	// Turn registry — tracks the live agent turns so the MCP pipeline can resolve
	// `/mcp/turn/:turnId` requests to a TurnContext.
	const turnRegistry = new TurnRegistry();

	// The ledger seen by extensions/tools: turn-aware. ledger.record() auto-stamps
	// turn_id, customer_id, task_id, tool_name, blast_radius and idempotency_key
	// from the active turn context (via AsyncLocalStorage). Out-of-turn calls
	// (dispatcher, brain loop dedup queries) pass through unchanged.
	const ledger: ActionLedger = wrapLedgerForHarness(rawLedger);

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

	// Customer channel — CSP-backed when CSP is configured: dispatched sends
	// land in CSP as activities + notes (the system of record), not a log line.
	// Stub otherwise (dev/tests). Other channels (email, SMS) drop in later by
	// implementing CustomerChannel.
	let customerChannel: CustomerChannel;
	// CSP_MOCK runs (offline fixtures) must never fire real customer-facing
	// writes — the mock transport only covers the csp-connector tools, not this
	// channel, so mock mode falls back to the stub.
	if (process.env.CSP_TOKEN && process.env.CSP_MOCK !== "1") {
		customerChannel = new CspCustomerChannel({
			baseUrl: process.env.CSP_BASE_URL ?? "http://localhost:5656",
			token: process.env.CSP_TOKEN,
			timeoutMs: process.env.CSP_TIMEOUT_MS ? Number(process.env.CSP_TIMEOUT_MS) : undefined,
		});
		console.log("[customer-channel] CSP-backed channel active (sends write to CSP)");
	} else {
		customerChannel = new StubCustomerChannel();
		console.log("[customer-channel] STUB channel active — sends only log (set CSP_TOKEN for real)");
	}

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
	//   TASK_SOURCE=csp   → live CSP Task API (reuses CSP_BASE_URL/CSP_TOKEN)
	//   TASK_SOURCE=stub  → in-memory demo queue (dev/demo)
	//   unset             → task iteration skipped (logged)
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

	// MCP endpoints — exposes our tools to any external MCP client (Claude Code
	// subprocess, Cursor, etc.).
	//
	// The harness route /mcp/turn/:turnId runs the full structural pipeline:
	// resolves the turn from the registry, filters tools by capability, recheck
	// the legality matrix, atomically consume a capability when required, scope
	// the executing tool to the turn via AsyncLocalStorage so the wrapped
	// ledger auto-stamps every row. The agent runtime targets this route.
	//
	// The legacy /mcp route stays for un-scoped callers (chat surfaces today,
	// external MCP clients without a turn). It runs no pipeline — just exec.
	// Capability-gated tools are invisible there because there is no scope.
	const mcpHarnessHandler = createMcpHarnessHandler({
		tools: () => host.getTools(),
		turnRegistry,
		capabilities: capabilityStore,
		onToolCall,
	});
	app.post("/mcp/turn/:turnId", mcpHarnessHandler);
	app.post(
		"/mcp",
		createMcpHandler({
			tools: () => host.getTools(),
			onToolCall,
		}),
	);

	// Agent runtime — Claude Code subprocess, reached over the MCP endpoint above.
	const mcpBaseUrl = `http://127.0.0.1:${config.port}`;
	const agent: AgentBackend = new ClaudeCodeRuntime({
		model: config.model,
		tools: host.getTools(),
		claudeBinary: config.claudeBinary,
		mcpBaseUrl,
		turnRegistry,
	});
	console.log("[runtime] Using claude-code (turn-scoped harness)");

	// Now the agent exists — bind the default LLM critic (deferred closure above).
	// VERIFIER_MODEL runs the critic on its own (cheaper/faster) model via a
	// second runtime instance; unset = the critic shares the main agent. The
	// verifier runtime intentionally has NO turn registry — its tool calls are
	// observational, must not consume capabilities, and must not be auto-scoped
	// into the parent turn's ledger entries.
	if (verifyEnabled) {
		const verifierAgent: AgentBackend = config.verifierModel
			? new ClaudeCodeRuntime({
					model: config.verifierModel,
					tools: host.getTools(),
					claudeBinary: config.claudeBinary,
					mcpBaseUrl,
				})
			: agent;
		verifier = createLlmCriticVerifier(verifierAgent);
		console.log(
			`[verify] Critic enabled for bands: ${verifyBands.join(", ")}${
				config.verifierModel ? ` (model: ${config.verifierModel})` : ""
			}`,
		);
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
					ledger,
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
		{
			enabled: config.skipGateEnabled,
			renewalHorizonDays: config.skipGateRenewalHorizonDays,
			maxSkipAgeDays: config.skipGateMaxAgeDays,
		},
		config.brainConcurrency,
	);

	// Dispatcher — picks up due notify-then-act sends and pushes them through
	// the customer channel. Always on, regardless of agent runtime. Dead-lettered
	// sends (3 failed attempts) open an escalate so the bounce surfaces to the
	// CSM instead of staying as a counter no one looks at.
	const dispatcher = new NotifyThenActDispatcher({
		ledger: rawLedger,
		customerChannel,
		intervalMs: config.dispatcherIntervalMs,
		async onDeadLetter(entry, error) {
			try {
				await rawLedger.record({
					band: "escalate",
					customerId: entry.customerId,
					customerName: entry.customerName,
					summary: `Customer send to ${entry.customerName ?? entry.customerId} failed permanently`,
					reason: `Dispatcher exhausted retries on action #${entry.id.slice(0, 8)}: ${error}. Original send was: "${entry.summary}". CSM needs to either retry manually or close the loop with the customer another way.`,
					status: "needs-csm",
					createdAt: new Date(),
					payload: {
						deadLetterOf: entry.id,
						originalSummary: entry.summary,
						lastError: error,
					},
					parentId: entry.id,
				});
				console.log(`[dispatcher] Opened escalate for dead-lettered ${entry.id}`);
			} catch (escErr) {
				console.error("[dispatcher] Failed to open dead-letter escalate:", escErr);
			}
		},
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

	// Console approval surfaces — the in-product human valve (no Lark needed):
	// pending sends the CSM can still cancel, and escalations awaiting a decision.
	app.get("/api/actions/pending", async (_req, res) => {
		const entries = await ledger.listOpen();
		res.json(entries.filter((e) => e.band === "notify-then-act" && e.status === "in-flight"));
	});

	app.get("/api/actions/escalations", async (_req, res) => {
		const entries = await ledger.listOpen();
		res.json(entries.filter((e) => e.band === "escalate" && e.status === "needs-csm"));
	});

	// One implementation of each ledger state transition, shared by both route
	// pairs (/api/actions/* for the console, /api/ledger/* legacy admin) so the
	// validation rules cannot drift between surfaces.
	const cancelHandler =
		(defaultNote: string) => async (req: Request<{ id: string }>, res: Response) => {
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
				note: (req.body?.reason as string) ?? defaultNote,
				executedAt: new Date(),
			});
			res.json(updated);
		};

	const resolveHandler =
		(defaultNote: string) => async (req: Request<{ id: string }>, res: Response) => {
			const existing = await ledger.get(req.params.id);
			if (!existing) {
				res.status(404).json({ error: "Not found" });
				return;
			}
			if (existing.band !== "escalate") {
				res.status(400).json({ error: "Only escalations can be resolved" });
				return;
			}
			if (existing.status !== "needs-csm") {
				res.status(400).json({ error: `Cannot resolve — already ${existing.status}` });
				return;
			}
			const outcome = (req.body?.outcome as string) ?? defaultNote;
			const resolvedBy = (req.body?.resolvedBy as string) ?? "console";
			// Capability grants: the CSM resolving the escalation may attach
			// one or more capability names to issue to the agent. These unlock
			// the matching `requiresCapability` tools for ONE bounded use on
			// the same account scope. Default expiry 1h; default uses 1.
			const grantsRequested: Array<{ name: string; uses?: number; expiresInMinutes?: number }> =
				Array.isArray(req.body?.grants) ? req.body.grants : [];
			const now = new Date();
			const updated = await ledger.update(req.params.id, {
				status: "resolved",
				note: outcome,
				executedAt: now,
				resolution: outcome,
				resolvedAt: now,
				resolvedBy,
			});
			const issued = [] as Array<{ id: string; grants: string }>;
			for (const g of grantsRequested) {
				if (!g?.name) continue;
				const granted = await capabilityStore.grant({
					grants: g.name,
					scope: { accountId: existing.customerId },
					parentEscalationId: existing.id,
					usesRemaining: g.uses && g.uses > 0 ? Math.floor(g.uses) : 1,
					expiresAt: new Date(
						now.getTime() + (g.expiresInMinutes && g.expiresInMinutes > 0 ? g.expiresInMinutes : 60) * 60_000,
					),
				});
				issued.push({ id: granted.id, grants: granted.grants });
			}
			res.json({ ...updated, capabilitiesIssued: issued });
		};

	app.post("/api/actions/:id/cancel", cancelHandler("cancelled via console"));
	app.post("/api/actions/:id/resolve", resolveHandler("resolved via console"));
	app.post("/api/ledger/:id/cancel", cancelHandler("cancelled via admin API"));
	app.post("/api/ledger/:id/resolve", resolveHandler("resolved via admin API"));

	// Inspect active capability grants for an account — diagnostic surface so
	// the CSM (and tests) can see exactly what the agent has unlocked.
	app.get("/api/capabilities", async (req, res) => {
		const accountId = String(req.query.accountId ?? "");
		if (!accountId) {
			res.status(400).json({ error: "accountId is required" });
			return;
		}
		const grants = await capabilityStore.listActiveForScope({ accountId }, new Date());
		res.json({ accountId, grants });
	});

	// Manually issue a capability — useful when the CSM wants to authorize the
	// agent outside of a specific escalation flow (rare; reserve for ops cases).
	app.post("/api/capabilities/grant", async (req, res) => {
		const body = req.body ?? {};
		const accountId = String(body.accountId ?? "");
		const grants = String(body.grants ?? "");
		const parentEscalationId = String(body.parentEscalationId ?? "");
		if (!accountId || !grants || !parentEscalationId) {
			res
				.status(400)
				.json({ error: "accountId, grants, parentEscalationId are required" });
			return;
		}
		const grant = await capabilityStore.grant({
			grants,
			scope: { accountId },
			parentEscalationId,
			usesRemaining: Number.isFinite(Number(body.uses)) ? Math.max(1, Math.floor(Number(body.uses))) : 1,
			expiresAt: new Date(
				Date.now() +
					Math.max(1, Number.isFinite(Number(body.expiresInMinutes)) ? Number(body.expiresInMinutes) : 60) *
						60_000,
			),
		});
		res.json(grant);
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

	// Manual single-cycle trigger — runs one work-loop cycle on demand. Lets the
	// loop stay disabled (BRAIN_LOOP_ENABLED=false) yet still be testable for cents
	// during development. ?limit caps per-sweep fan-out (omitted = 3, 0 = no cap).
	app.post("/api/brain/cycle", async (req, res) => {
		const raw = req.query.limit;
		let limit: number | undefined;
		if (raw !== undefined) {
			const n = Number(raw);
			limit = Number.isFinite(n) && n >= 0 ? n : undefined;
		}
		const result = await brainLoop.runOnce({ limit });
		if (result.ran === false) {
			res.status(409).json(result);
			return;
		}
		res.json(result);
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
		if (rawLedger instanceof SqliteActionLedger) (rawLedger as SqliteActionLedger).close();
		if (capabilityStore instanceof SqliteCapabilityStore)
			(capabilityStore as SqliteCapabilityStore).close();
		if (situationStore instanceof SqliteSituationStore)
			(situationStore as SqliteSituationStore).close();
		if (store instanceof SqliteStore) (store as SqliteStore).close();
	};

	return { app, brainLoop, dispatcher, ledger, customerChannel, store, host, shutdown };
}
