import express, { type Express } from "express";
import type { MemoryStore, PendingAction } from "@cerebro-claw/shared";
import { InMemoryStore } from "@cerebro-claw/memory";
import { createMemoryTools, createMessageTools } from "@cerebro-claw/tools";
import { LarkBot } from "@cerebro-claw/channel-lark";
import { AgentRuntime } from "./agent-runtime.js";
import { Router } from "./router.js";
import { BrainLoop } from "./brain-loop.js";
import { loadConfig } from "./config.js";

export function createApp(): { app: Express; brainLoop: BrainLoop; store: MemoryStore } {
	const config = loadConfig();
	const app = express();
	app.use(express.json());

	// Memory
	const store: MemoryStore = new InMemoryStore();

	// Pending actions (CSM approval queue)
	const pendingActions = new Map<string, PendingAction>();

	// Lark channel
	const lark = new LarkBot({
		appId: config.larkAppId,
		appSecret: config.larkAppSecret,
	});

	// Tools
	const memoryTools = createMemoryTools(store);
	const messageTools = createMessageTools({
		pendingActions,
		async sendToChannel(_channelId, recipientId, text) {
			await lark.sendMessageToUser(recipientId, text);
		},
	});
	const allTools = [...memoryTools, ...messageTools];

	// Agent runtime
	const agent = new AgentRuntime(config.anthropicApiKey, config.model, allTools);

	// Router
	const router = new Router(agent);

	// Brain loop
	const brainLoop = new BrainLoop(store, agent, config.brainLoopIntervalMs);

	// Lark webhook
	lark.onMessage(async (message) => {
		const reply = await router.handleMessage(message);
		if (reply) {
			await lark.sendMessage(message.channelId, reply);
		}
	});

	// --- HTTP Routes ---

	app.get("/health", (_req, res) => {
		res.json({ status: "ok", uptime: process.uptime() });
	});

	// Lark event webhook
	app.post("/webhook/lark", async (req, res) => {
		try {
			const result = await lark.handleWebhook(req.body);
			res.json(result ?? { ok: true });
		} catch (err) {
			console.error("[webhook/lark] Error:", err);
			res.status(500).json({ error: "Internal error" });
		}
	});

	// --- API Routes (for admin web UI) ---

	// Customers
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

	// History
	app.get("/api/customers/:id/history", async (req, res) => {
		const history = await store.getHistory(req.params.id, 100);
		res.json(history);
	});

	// Instincts
	app.get("/api/customers/:id/instincts", async (req, res) => {
		const instincts = await store.getInstincts(req.params.id);
		res.json(instincts);
	});

	// Pending actions
	app.get("/api/actions", (_req, res) => {
		res.json(Array.from(pendingActions.values()));
	});

	app.post("/api/actions/:id/approve", (req, res) => {
		const action = pendingActions.get(req.params.id);
		if (!action) {
			res.status(404).json({ error: "Not found" });
			return;
		}
		action.status = "approved";
		if (action.draft) {
			lark.sendMessageToUser(action.draft.recipientId, action.draft.text).catch(console.error);
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

	// Chat (assistant mode — CSM talks to agent directly)
	app.post("/api/chat", async (req, res) => {
		const { message, customerId } = req.body;
		const context = customerId ? `Current customer context: ${customerId}` : undefined;
		const response = await agent.prompt(message, context);
		res.json({ text: response.text, toolCalls: response.toolCalls });
	});

	return { app, brainLoop, store };
}
