import express, { type Express } from "express";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import type { MemoryStore, PendingAction } from "@cerebro-claw/shared";
import { SqliteStore } from "@cerebro-claw/memory";
import { AgentRuntime, type AgentBackend } from "./agent-runtime.js";
import { ClaudeCodeRuntime } from "./claude-code-runtime.js";
import { createMcpHandler } from "./mcp-server.js";
import { Router } from "./router.js";
import { BrainLoop, createCspAccountSource } from "./brain-loop.js";
import { loadConfig } from "./config.js";
import { ExtensionHost } from "./extension-host.js";
import { loadExtensionsFromDir } from "./extension-loader.js";
import { createAdminAuth } from "./auth.js";
import { verifyLarkSignature } from "@cerebro-claw/channel-lark";
import { errorHandler, notFoundHandler, requestLogger } from "./middleware.js";
import { createLarkExtension } from "./builtin-extensions/lark-extension.js";
import { memoryToolsExtension } from "./builtin-extensions/memory-tools-extension.js";
import { createMessageToolsExtension } from "./builtin-extensions/message-tools-extension.js";
import { createBashToolExtension } from "./builtin-extensions/bash-tool-extension.js";

export interface AppHandles {
	app: Express;
	brainLoop: BrainLoop;
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
	app.use(express.json({
		verify: (req, _res, buf) => {
			(req as unknown as { rawBody: string }).rawBody = buf.toString("utf8");
		},
	}));

	// Admin auth — must come before API routes
	app.use(createAdminAuth(config.adminToken));

	// Memory (SQLite — survives restarts)
	mkdirSync(dirname(config.dbPath), { recursive: true });
	const store: MemoryStore = new SqliteStore(config.dbPath);

	// Pending actions queue (shared across extensions)
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
	const brainLoopEnabled =
		config.runtime === "claude-code" ? true : !!config.anthropicApiKey;

	// Pick account source: CSP (live) when CSP_TOKEN + CSP_CSM_EMAIL are configured,
	// otherwise fall back to the local SQLite store (demo / seed mode).
	const cspSource =
		process.env.CSP_TOKEN && process.env.CSP_CSM_EMAIL
			? createCspAccountSource({
					baseUrl: process.env.CSP_BASE_URL ?? "http://localhost:5656",
					token: process.env.CSP_TOKEN,
					csmEmail: process.env.CSP_CSM_EMAIL,
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
					if (!verifyLarkSignature(config.larkVerificationToken, timestamp, nonce, rawBody, signature)) {
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

	app.get("/api/customers", async (_req, res) => {
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
		const profile = await store.getProfile(req.params.id);
		if (!profile) {
			res.status(404).json({ error: "Not found" });
			return;
		}
		const state = await store.getState(req.params.id);
		const history = await store.getHistory(req.params.id, 50);
		const instincts = await store.getInstincts(req.params.id);
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
			results.lark = { ok: true, detail: "credentials configured (call from Lark to fully verify)" };
		}

		res.json(results);
	});

	// 404 (must come after all routes) + global error handler (must be last)
	app.use(notFoundHandler());
	app.use(errorHandler());

	const shutdown = async () => {
		brainLoop.stop();
		await host.shutdown();
		if (store instanceof SqliteStore) (store as SqliteStore).close();
	};

	return { app, brainLoop, store, host, shutdown };
}
