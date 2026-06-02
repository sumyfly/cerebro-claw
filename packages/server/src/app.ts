import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { verifyLarkSignature } from "@cerebro-claw/channel-lark";
import { SqliteActionLedger, SqliteStore } from "@cerebro-claw/memory";
import type {
	ActionLedger,
	CustomerChannel,
	MemoryStore,
	PendingAction,
} from "@cerebro-claw/shared";
import { StubCustomerChannel } from "@cerebro-claw/tools";
import express, { type Express } from "express";
import { type AgentBackend, AgentRuntime } from "./agent-runtime.js";
import { createAdminAuth } from "./auth.js";
import { BrainLoop, createCspAccountSource } from "./brain-loop.js";
import { createActionPolicyExtension } from "./builtin-extensions/action-policy-extension.js";
import { createBashToolExtension } from "./builtin-extensions/bash-tool-extension.js";
import { createLarkExtension } from "./builtin-extensions/lark-extension.js";
import { memoryToolsExtension } from "./builtin-extensions/memory-tools-extension.js";
import { createMessageToolsExtension } from "./builtin-extensions/message-tools-extension.js";
import { ClaudeCodeRuntime } from "./claude-code-runtime.js";
import { loadConfig } from "./config.js";
import { cspReaderFromEnv, getCspDetail, listCspSummaries } from "./csp-customers.js";
import { NotifyThenActDispatcher } from "./dispatcher.js";
import { resolveOverrideFromStore } from "./engine/overrides.js";
import { ExtensionHost } from "./extension-host.js";
import { loadExtensionsFromDir } from "./extension-loader.js";
import { createMcpHandler } from "./mcp-server.js";
import { errorHandler, notFoundHandler, requestLogger } from "./middleware.js";
import { Router } from "./router.js";

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

	// Customer data for the admin UI reads live from CSP when configured
	// (source of truth for accounts/health/engagement); the local store is the
	// fallback only when CSP isn't wired up. Agent-private history/instincts
	// always come from the local store.
	const cspReader = cspReaderFromEnv();
	if (cspReader) {
		// The CSP test backend serves an untrusted/expired TLS cert, which Node's
		// fetch rejects. CSP_INSECURE_TLS is the opt-in escape hatch for dev/test.
		if (/^(1|true|yes)$/i.test(process.env.CSP_INSECURE_TLS ?? "")) {
			process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0";
			console.warn(
				"[customers] CSP_INSECURE_TLS=true — TLS certificate verification is OFF process-wide. Dev/test only.",
			);
		}
		console.log(`[customers] Reading live from CSP as CSM ${cspReader.csmEmail}`);
	}

	// Customer channel — stub by default. Real channels (email, SMS) drop in
	// as extensions later by implementing CustomerChannel.
	const customerChannel: CustomerChannel = new StubCustomerChannel();

	// Pending actions queue (shared across extensions, legacy draft flow)
	const pendingActions = new Map<string, PendingAction>();

	// Extension host — collects tools, channels, and event handlers
	const host = new ExtensionHost({
		store,
		config: { dbPath: config.dbPath, model: config.model },
	});

	// Lark extension also returns the bot for webhook handling
	const lark = createLarkExtension({
		appId: config.larkAppId,
		appSecret: config.larkAppSecret,
		pendingActions,
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

	// Load extensions: built-in first, then any from the extensions/ directory
	const userExtensions = await loadExtensionsFromDir(config.extensionsDir);
	await host.load([
		memoryToolsExtension,
		createMessageToolsExtension({ pendingActions, host }),
		createActionPolicyExtension({
			ledger,
			customerChannel,
			host,
			defaultCsmRecipientId: config.defaultCsmLarkUserId || undefined,
			defaultPauseMinutes: config.defaultPauseMinutes,
			// Enforce stored overrides as a hard gate (overrides are taught by the
			// CSM as instinct notes; resolveOverrideFromStore parses them).
			resolveOverride: (customerId) => resolveOverrideFromStore(store, customerId),
		}),
		createBashToolExtension({
			allowlist: config.bashAllowlist,
			timeoutMs: config.bashTimeoutMs,
		}),
		lark.extension,
		...userExtensions,
	]);

	// MCP endpoint — exposes our tools to any external MCP client (Claude Code
	// subprocess, Cursor, etc.). The Claude Code runtime uses this to call our
	// tools without an Anthropic API key.
	app.post("/mcp", createMcpHandler({ tools: () => host.getTools() }));

	// Agent runtime — Anthropic SDK (default) or Claude Code subprocess
	const mcpUrl = `http://127.0.0.1:${config.port}/mcp`;
	const agent: AgentBackend =
		config.runtime === "claude-code"
			? new ClaudeCodeRuntime(config.model, host.getTools(), config.claudeBinary, mcpUrl)
			: new AgentRuntime(config.anthropicApiKey, config.model, host.getTools());
	console.log(`[runtime] Using ${config.runtime}`);

	// Router and brain loop (brain loop emits lifecycle events through the host)
	const router = new Router(agent, { store });
	const brainLoopEnabled = config.runtime === "claude-code" ? true : !!config.anthropicApiKey;

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
				})
			: undefined;

	const brainLoop = new BrainLoop(
		store,
		agent,
		config.brainLoopIntervalMs,
		brainLoopEnabled,
		host,
		cspSource,
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

	app.get("/api/customers", async (req, res) => {
		// Live from CSP when configured. CSP_CSM has ~1.3k accounts, so cap the
		// page (default 50, override with ?limit=, max 200).
		if (cspReader) {
			const limit = Math.min(Math.max(Number(req.query.limit) || 50, 1), 200);
			res.json(await listCspSummaries(cspReader, limit));
			return;
		}
		const profiles = await store.listProfiles();
		const customers = await Promise.all(
			profiles.map(async (p) => {
				const state = await store.getState(p.id);
				return { profile: p, state };
			}),
		);
		res.json(customers);
	});

	app.get("/api/customers/:id", async (req, res) => {
		const id = req.params.id;
		// Agent-private data lives in the local store regardless of where the
		// profile comes from.
		const history = await store.getHistory(id, 50);
		const instincts = await store.getInstincts(id);

		// Prefer live CSP; fall back to the local store (e.g. a customer added
		// via POST /api/customers, or demo mode with no CSP).
		if (cspReader) {
			const detail = await getCspDetail(cspReader, id);
			if (detail) {
				res.json({ ...detail, history, instincts });
				return;
			}
		}

		const profile = await store.getProfile(id);
		if (!profile) {
			res.status(404).json({ error: "Not found" });
			return;
		}
		const state = await store.getState(id);
		res.json({ profile, state, history, instincts });
	});

	app.post("/api/customers", async (req, res) => {
		const profile = req.body;
		profile.createdAt = new Date();
		profile.updatedAt = new Date();
		await store.upsertProfile(profile);
		await store.updateState({
			customerId: profile.id,
			health: "good",
			openIssues: 0,
			lastContactDate: new Date(),
			usageTrend: "flat",
			updatedAt: new Date(),
		});
		res.status(201).json(profile);
	});

	app.get("/api/customers/:id/history", async (req, res) => {
		const history = await store.getHistory(req.params.id, 100);
		res.json(history);
	});

	app.get("/api/customers/:id/instincts", async (req, res) => {
		const instincts = await store.getInstincts(req.params.id);
		res.json(instincts);
	});

	app.get("/api/actions", (_req, res) => {
		res.json(Array.from(pendingActions.values()));
	});

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

	// "Yesterday: 47 acts, 12 notifies in-flight, 2 escalations need you."
	app.get("/api/digest/counters", async (req, res) => {
		const now = new Date();
		const windowHours = Number(req.query.hours ?? 24);
		const since = new Date(now.getTime() - windowHours * 3600 * 1000);
		const recent = await ledger.listByWindow(since, now);
		const open = await ledger.listOpen();
		const counts = {
			windowHours,
			acts: recent.filter((e) => e.band === "act").length,
			notifies: {
				inFlight: open.filter((e) => e.band === "notify-then-act").length,
				executed: recent.filter((e) => e.band === "notify-then-act" && e.status === "executed")
					.length,
				cancelled: recent.filter((e) => e.band === "notify-then-act" && e.status === "cancelled")
					.length,
				failed: recent.filter((e) => e.band === "notify-then-act" && e.status === "failed").length,
			},
			escalations: {
				needsCsm: open.filter((e) => e.band === "escalate").length,
				resolved: recent.filter((e) => e.band === "escalate" && e.status === "resolved").length,
			},
			preps: recent.filter((e) => e.band === "prep").length,
		};
		const headline = `Yesterday: ${counts.acts} acts, ${counts.notifies.inFlight} notifies in-flight, ${counts.escalations.needsCsm} escalations need you.`;
		res.json({ headline, counts });
	});

	app.post("/api/actions/:id/approve", async (req, res) => {
		const action = pendingActions.get(req.params.id);
		if (!action) {
			res.status(404).json({ error: "Not found" });
			return;
		}
		action.status = "approved";
		if (action.draft) {
			const sender = host.getChannelSender(action.draft.channelType);
			if (sender) await sender.send(action.draft.recipientId, action.draft.text);
		}
		res.json(action);
	});

	app.post("/api/actions/:id/reject", (req, res) => {
		const action = pendingActions.get(req.params.id);
		if (!action) {
			res.status(404).json({ error: "Not found" });
			return;
		}
		action.status = "rejected";
		res.json(action);
	});

	// Chat
	app.post("/api/chat", async (req, res) => {
		const { message, customerId, sessionId } = req.body;
		const chatSessionId = sessionId ?? (customerId ? `chat:${customerId}` : "chat:general");
		const context = customerId ? `Current customer context: ${customerId}` : undefined;
		const response = await agent.prompt(message, context, chatSessionId);
		res.json({ text: response.text, toolCalls: response.toolCalls, sessionId: chatSessionId });
	});

	app.post("/api/digest", async (_req, res) => {
		try {
			const digest = await brainLoop.runDigest();
			res.json({ text: digest });
		} catch (err) {
			res.status(500).json({ error: "Failed to generate digest. Is ANTHROPIC_API_KEY set?" });
		}
	});

	app.get("/api/sessions", (_req, res) => {
		res.json(agent.listSessions());
	});

	app.delete("/api/sessions/:id", (req, res) => {
		agent.clearSession(req.params.id);
		res.json({ ok: true });
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

		// Runtime (Anthropic SDK or Claude Code CLI)
		if (config.runtime === "claude-code") {
			const ping = await agent.ping();
			results.runtime = { ok: ping.ok, detail: ping.ok ? "claude-code: CLI ready" : ping.error };
		} else if (!config.anthropicApiKey) {
			results.runtime = { ok: false, detail: "anthropic: ANTHROPIC_API_KEY not set" };
		} else {
			const ping = await agent.ping();
			results.runtime = { ok: ping.ok, detail: ping.ok ? "anthropic: reachable" : ping.error };
		}

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
		if (store instanceof SqliteStore) (store as SqliteStore).close();
	};

	return { app, brainLoop, dispatcher, ledger, customerChannel, store, host, shutdown };
}
