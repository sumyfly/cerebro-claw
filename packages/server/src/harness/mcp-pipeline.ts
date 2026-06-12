/**
 * The harness pipeline that every MCP tool call runs through.
 *
 * The pipeline is the structural law of the agent runtime — what the prompt
 * cannot ask its way around. Each step is a small, testable predicate; the
 * order is fixed because later steps assume earlier ones have already run.
 *
 *  1. Resolve turn        — POST /mcp/turn/:turnId → TurnContext from registry.
 *                            Missing turn falls back to legacy un-scoped mode.
 *  2. Visibility filter   — `requiresCapability` tools only appear in
 *                            tools/list when a matching grant exists for the
 *                            turn's scope (and isn't consumed/expired).
 *  3. Legality recheck    — defense in depth: re-validate (kind, blastRadius)
 *                            even though registration also checks it.
 *  4. Capability consume  — for tools with `requiresCapability`, atomically
 *                            decrement an active grant. Refuse the call if
 *                            none can be claimed.
 *  5. Critic gate         — owned by the action-policy tools (kept there
 *                            because it has access to band/summary/reason).
 *  6. ALS-scoped execute  — run inside `currentTurn.run(turn, ...)` and with
 *                            the tool's metadata set on the turn so the
 *                            wrapped ledger can stamp every row.
 *  7. Observer            — post-call hook (recent tools, action observer).
 *
 * The MCP server itself stays thin; this module owns the policy.
 */

import type {
	CapabilityStore,
	ToolDefinition,
	TurnContext,
} from "@cerebro-claw/shared";
import { validateToolDefinition } from "@cerebro-claw/shared";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import {
	CallToolRequestSchema,
	ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import type { Request, Response } from "express";
import { setCurrentTool } from "./turn-aware-ledger.js";
import { currentTurn, type TurnRegistry } from "./turn-registry.js";

export interface McpPipelineOptions {
	tools: () => ToolDefinition[];
	turnRegistry: TurnRegistry;
	/**
	 * Capability store consulted for tools/list visibility and for atomic
	 * consume on every gated tool call. Omit to disable capability gating
	 * (the pipeline still runs every other step).
	 */
	capabilities?: CapabilityStore;
	/** Post-execute observer — recent-tools feed + action observer. */
	onToolCall?: (
		name: string,
		params: Record<string, unknown>,
		result: { content: string; success: boolean },
	) => void | Promise<void>;
	name?: string;
	version?: string;
	now?: () => Date;
}

/**
 * Build a request handler that runs the full harness pipeline for one
 * `/mcp/turn/:turnId` POST. The handler is mounted by app.ts; everything
 * about the per-call policy lives here.
 */
export function createMcpHarnessHandler(opts: McpPipelineOptions) {
	const now = opts.now ?? (() => new Date());

	/**
	 * Build the MCP server for this request. The tool list is computed once at
	 * `tools/list` time, filtered for the turn's capabilities; `tools/call` then
	 * looks up by name from the SAME filtered set, so a hidden tool is invisible
	 * end-to-end (not just visually omitted).
	 */
	async function makeServer(turn: TurnContext | undefined): Promise<Server> {
		const allTools = opts.tools();
		const visibleTools = await filterToolsForTurn(allTools, turn, opts.capabilities, now());

		const server = new Server(
			{ name: opts.name ?? "cerebro-claw", version: opts.version ?? "0.1.0" },
			{ capabilities: { tools: {} } },
		);

		server.setRequestHandler(ListToolsRequestSchema, async () => ({
			tools: visibleTools.map((t) => ({
				name: t.name,
				description: t.description,
				inputSchema: t.parameters,
			})),
		}));

		server.setRequestHandler(CallToolRequestSchema, async (req) => {
			const tool = visibleTools.find((t) => t.name === req.params.name);
			if (!tool) {
				return {
					content: [
						{
							type: "text",
							text: tool === undefined
								? `Tool not available in this turn: ${req.params.name}`
								: `Unknown tool: ${req.params.name}`,
						},
					],
					isError: true,
				};
			}

			// Step 3: defense-in-depth legality recheck. Registration is supposed to
			// stop illegal tools landing in the registry, but a runtime mutation or
			// programmatic registerTool bypass could in principle slip one through.
			const legality = validateToolDefinition(tool);
			if (!legality.ok) {
				return {
					content: [{ type: "text", text: `Tool ${tool.name} blocked: ${legality.reason}` }],
					isError: true,
				};
			}

			const args = (req.params.arguments ?? {}) as Record<string, unknown>;

			// Step 4: capability consume (atomic). Only after a successful consume
			// do we proceed to execute — the grant is debited before any side
			// effect runs, so a tool that throws still costs one use.
			let consumedCapabilityId: string | undefined;
			if (tool.requiresCapability && opts.capabilities && turn) {
				const subjectAccount = subjectAccountId(turn);
				if (!subjectAccount) {
					return {
						content: [
							{
								type: "text",
								text: `Tool ${tool.name} requires capability "${tool.requiresCapability}" but this turn has no account scope to match against.`,
							},
						],
						isError: true,
					};
				}
				const grants = await opts.capabilities.listActiveForScope(
					{ accountId: subjectAccount },
					now(),
				);
				const candidate = grants.find((g) => g.grants === tool.requiresCapability);
				if (!candidate) {
					return {
						content: [
							{
								type: "text",
								text: `Tool ${tool.name} requires the "${tool.requiresCapability}" capability for account ${subjectAccount}; none is active. Open an escalate and wait for the CSM to approve before retrying.`,
							},
						],
						isError: true,
					};
				}
				const consumed = await opts.capabilities.consume(candidate.id, turn.id, now());
				if (!consumed) {
					return {
						content: [
							{
								type: "text",
								text: `Tool ${tool.name} could not consume capability ${candidate.id} (raced or expired). Retry by opening a fresh escalate.`,
							},
						],
						isError: true,
					};
				}
				consumedCapabilityId = consumed.id;
			}

			// Step 5: critic gate is implemented inside the action-policy tools,
			// where the band-specific summary/reason live. No work here.

			// Step 6: execute inside the turn's ALS frame so the wrapped ledger
			// can auto-stamp turnId/customerId/taskId/idempotencyKey on every
			// record(). The tool's `idempotencyKey` extractor runs once here so
			// it's available to the wrapped ledger throughout the call.
			//
			// Step 7: the observer (recent-tools feed + action observer) ALSO
			// runs inside this frame. The action-observer auto-records ledger
			// entries for CSP writes (csp_create_note etc.) whose tools don't
			// touch the ledger themselves; those writes MUST inherit the turn
			// scope, otherwise rows land without turn_id/customer_id and the
			// dedup + capability audit lose half the trail. The tool metadata
			// (name, blast_radius, idempotency_key) stays set through the
			// observer call too so the wrapped ledger can stamp those fields.
			const idempotencyKey = tool.idempotencyKey ? tool.idempotencyKey(args) : undefined;
			const blastRadius = tool.blastRadius;
			const runToolAndObserver = async () => {
				const r = await tool.execute(args);
				if (opts.onToolCall) {
					try {
						await opts.onToolCall(req.params.name, args, r);
					} catch (err) {
						console.error("[mcp] onToolCall observer failed:", err);
					}
				}
				return r;
			};
			try {
				const result = turn
					? await currentTurn.run(turn, async () => {
							setCurrentTool(turn, {
								name: tool.name,
								blastRadius,
								idempotencyKey,
							});
							try {
								return await runToolAndObserver();
							} finally {
								setCurrentTool(turn, undefined);
							}
						})
					: await runToolAndObserver();

				return {
					content: [{ type: "text", text: result.content }],
					isError: !result.success,
					_meta: consumedCapabilityId ? { capabilityId: consumedCapabilityId } : undefined,
				};
			} catch (err) {
				return {
					content: [
						{
							type: "text",
							text: `Tool ${req.params.name} threw: ${
								err instanceof Error ? err.message : String(err)
							}`,
						},
					],
					isError: true,
				};
			}
		});

		return server;
	}

	return async (req: Request, res: Response) => {
		const turnId = (req.params.turnId as string | undefined) ?? undefined;
		const turn = turnId ? opts.turnRegistry.get(turnId) : undefined;
		// Missing-turn handling. We treat unknown turn ids as legacy un-scoped
		// requests rather than 404-ing — that keeps things working for callers
		// that didn't register (chat surface, ad-hoc CLI). Capability-gated tools
		// will refuse on their own.
		const server = await makeServer(turn);
		const transport = new StreamableHTTPServerTransport({
			sessionIdGenerator: undefined,
			enableJsonResponse: true,
		});
		res.on("close", () => {
			transport.close().catch(() => undefined);
			server.close().catch(() => undefined);
		});
		try {
			await server.connect(transport);
			await transport.handleRequest(req, res, req.body);
		} catch (err) {
			console.error("[mcp] Request handling failed:", err);
			if (!res.headersSent) {
				res.status(500).json({
					jsonrpc: "2.0",
					error: { code: -32603, message: "Internal MCP error" },
					id: null,
				});
			}
		}
	};
}

/** Pull the account id out of the turn subject, when one is known. */
function subjectAccountId(turn: TurnContext): string | undefined {
	const subj = turn.subject;
	if (subj.kind === "account") return subj.accountId;
	return (subj as { accountId?: string }).accountId;
}

/**
 * Filter the full tool list down to what this turn can see. Tools without a
 * `requiresCapability` are always visible; gated tools appear only when a
 * matching grant exists for the turn's account scope. With no turn, gated
 * tools are hidden — there is no scope to evaluate them against.
 */
async function filterToolsForTurn(
	tools: ToolDefinition[],
	turn: TurnContext | undefined,
	capabilities: CapabilityStore | undefined,
	now: Date,
): Promise<ToolDefinition[]> {
	const gated = tools.some((t) => t.requiresCapability);
	if (!gated) return tools;

	let activeGrants: Set<string> | null = null;
	if (turn && capabilities) {
		const account = subjectAccountId(turn);
		if (account) {
			const grants = await capabilities.listActiveForScope({ accountId: account }, now);
			activeGrants = new Set(grants.map((g) => g.grants));
		}
	}
	return tools.filter((t) => {
		if (!t.requiresCapability) return true;
		return activeGrants?.has(t.requiresCapability) ?? false;
	});
}
