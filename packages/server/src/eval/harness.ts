import { existsSync } from "node:fs";
import type { Server as HttpServer } from "node:http";
import type { AddressInfo } from "node:net";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { ActionLedger, ChannelAdapter, CustomerChannel } from "@cerebro-claw/shared";
import express from "express";
import { createActionObserver } from "../action-observer.js";
import { createActionPolicyExtension } from "../builtin-extensions/action-policy-extension.js";
import { memoryToolsExtension } from "../builtin-extensions/memory-tools-extension.js";
import { ClaudeCodeRuntime } from "../claude-code-runtime.js";
import { loadConfig } from "../config.js";
import { resolveOverrideFromStore } from "../engine/overrides.js";
import { ExtensionHost } from "../extension-host.js";
import { loadExtensionsFromDir } from "../extension-loader.js";
import { createMcpHandler } from "../mcp-server.js";

/**
 * Wiring for a single eval run. Everything is in-memory / stubbed except the
 * agent, which is the real `claude-code` subprocess reaching our tools over an
 * in-process HTTP MCP server — exactly how the server wires it in app.ts.
 */
export interface EvalAgentDeps {
	/** In-memory action ledger the action-policy tools write into. */
	ledger: ActionLedger;
	/** StubCustomerChannel — captures the agent's outbound customer sends. */
	customerChannel: CustomerChannel;
	/** StubCsmChannel — captures CSM-facing heads-ups / escalation cards. */
	csmChannel: ChannelAdapter;
	/** CSP fixture map keyed by exact path, fed to MockCspTransport via env. */
	cspFixtures: Record<string, unknown>;
	/** CSM instinct notes to seed into the store (agent-private memory). */
	instincts?: string[];
	/** Customer/business id the seeded instincts + overrides are keyed under. */
	customerId?: string;
	/** Override rules for this account, enforced as a hard gate by the tools. */
	overrides?: Array<{ rule: string; forcesBand?: string }>;
	/**
	 * Live mode: do NOT mock CSP. The csp-connector hits the real CSP backend
	 * using CSP_TOKEN/CSP_BASE_URL from process.env. Used to test the agent
	 * against live Cerebro data instead of fixtures.
	 */
	live?: boolean;
}

/** What the runner needs from the agent: one-shot prompt that drives tool calls. */
export interface EvalAgent {
	prompt(userMessage: string, context: string | undefined, sessionId: string): Promise<unknown>;
	/** Tear down the in-process MCP server stood up for this agent. */
	close(): Promise<void>;
}

/**
 * Build an agent wired to the eval stubs. Faithful to app.ts:
 *  - same extension set (memory tools, action-policy tools, csp-connector)
 *  - action-policy tools write to `deps.ledger` and send via `deps.customerChannel`
 *  - the csmChannel is registered as the host channel so heads-ups land in the inbox
 *  - tools are exposed over an in-process HTTP MCP server, and a ClaudeCodeRuntime
 *    is pointed at it — identical transport to RUNTIME=claude-code in production.
 *
 * The csp-connector reads CSP_MOCK / CSP_MOCK_FIXTURES from process.env at factory
 * time, so we set them BEFORE loading it.
 */
export async function buildAgentForEval(deps: EvalAgentDeps): Promise<EvalAgent> {
	const config = loadConfig();

	// The csp-connector's makeTransport() reads these from process.env when its
	// factory runs. In mock mode we set them before host.load(); in live mode we
	// clear the mock so the connector hits the real CSP backend with CSP_TOKEN.
	if (deps.live) {
		process.env.CSP_MOCK = "";
	} else {
		process.env.CSP_MOCK = "1";
		process.env.CSP_MOCK_FIXTURES = JSON.stringify(deps.cspFixtures);
	}

	// Host with an in-memory store (memory tools need a store; eval keeps it
	// throwaway — agent-private instincts/history don't survive the run).
	const { InMemoryStore } = await import("@cerebro-claw/memory");
	const store = new InMemoryStore();

	// Seed the scenario's CSM instinct notes so the agent's memory_* tools can
	// surface them — without this, a scenario whose correct band depends on what
	// the CSM "told" the agent (e.g. "evaluating a competitor") can't be tested.
	if (deps.instincts?.length && deps.customerId) {
		let i = 0;
		for (const content of deps.instincts) {
			await store.addInstinct({
				id: `eval-instinct-${i++}`,
				customerId: deps.customerId,
				content,
				source: "csm",
				createdAt: new Date(),
			});
		}
	}

	const host = new ExtensionHost({
		store,
		config: { dbPath: ":memory:", model: config.model },
	});

	// csp-connector lives on the filesystem and is default-exported as an
	// Extension; load it through the same loader app.ts uses, so the mock
	// transport wiring is exercised exactly as in production.
	//
	// config.extensionsDir defaults to <cwd>/extensions, which is wrong here:
	// the eval runs from packages/server, but csp-connector lives at the repo
	// root's extensions/ dir. Resolve from this module (…/packages/server/src/
	// eval/harness.ts → repo root is four levels up) and only fall back to the
	// configured dir if EXTENSIONS_DIR was set explicitly.
	const repoRootExtensions = resolve(
		dirname(fileURLToPath(import.meta.url)),
		"../../../../extensions",
	);
	const extensionsDir = process.env.EXTENSIONS_DIR
		? config.extensionsDir
		: existsSync(resolve(repoRootExtensions, "csp-connector"))
			? repoRootExtensions
			: config.extensionsDir;
	const cspConnectorDir = resolve(extensionsDir, "csp-connector");
	const cspExtensions = await loadExtensionsFromDir(cspConnectorDir);
	if (cspExtensions.length === 0) {
		console.warn(
			`[eval-harness] csp-connector not found under ${cspConnectorDir} — the agent will have no csp_* tools.`,
		);
	}

	await host.load([
		// Register the stub CSM channel first, the same way lark-extension does
		// (api.registerChannel), so host.getChannelSender() resolves to it and
		// action-policy heads-ups land in the stub inbox rather than the stderr
		// fallback. Loaded before action-policy so the channel exists when needed.
		{
			id: "eval-csm-channel",
			factory: (api) => {
				api.registerChannel(deps.csmChannel);
			},
		},
		memoryToolsExtension,
		createActionPolicyExtension({
			ledger: deps.ledger,
			customerChannel: deps.customerChannel,
			host,
			// Route heads-ups to a real recipient id (not "stub-csm") so they land
			// in the csmChannel inbox rather than the stderr fallback.
			defaultCsmRecipientId: "eval-csm",
			defaultPauseMinutes: config.defaultPauseMinutes,
			// Enforce overrides exactly as production does. Fixture scenarios pass
			// an explicit override for deps.customerId; live/portfolio runs (no
			// scenario customerId) resolve from the store like production, so the
			// gate is never silently disabled on the live path.
			resolveOverride: (customerId) => {
				if (deps.customerId && customerId === deps.customerId) {
					const forcing = (deps.overrides ?? []).find((o) => o.forcesBand);
					if (forcing) return { forcesBand: forcing.forcesBand };
				}
				return resolveOverrideFromStore(store, customerId);
			},
		}),
		...cspExtensions,
	]);

	// Stand up the in-process MCP server on a free port — same handler app.ts
	// mounts at POST /mcp, same dynamic tool list.
	const mcpApp = express();
	mcpApp.use(express.json());
	mcpApp.post(
		"/mcp",
		createMcpHandler({
			tools: () => host.getTools(),
			onToolCall: createActionObserver(deps.ledger),
		}),
	);

	const httpServer: HttpServer = await new Promise((res) => {
		const s = mcpApp.listen(0, "127.0.0.1", () => res(s));
	});
	const port = (httpServer.address() as AddressInfo).port;
	const mcpUrl = `http://127.0.0.1:${port}/mcp`;

	// Same construction as app.ts for RUNTIME=claude-code.
	const runtime = new ClaudeCodeRuntime(config.model, host.getTools(), config.claudeBinary, mcpUrl);

	return {
		prompt: (userMessage, context, sessionId) => runtime.prompt(userMessage, context, sessionId),
		close: () =>
			new Promise<void>((res) => {
				httpServer.close(() => res());
			}),
	};
}
