/**
 * Cerebro Claw MCP server.
 *
 * Exposes the agent's tools (csp_*, memory_*, draft_message, send_message, bash)
 * over MCP so an external agent (Claude Code subprocess, or any other MCP client)
 * can call them. This is the bridge that lets the `claude-code` runtime work
 * without an Anthropic API key — Claude Code connects to this server via
 * --mcp-config and discovers our tools natively.
 *
 * Stateless mode: each request is its own JSON-RPC exchange. No session
 * persistence between calls. Simpler and matches how the Claude Code
 * subprocess uses MCP (short-lived sessions per turn).
 */

import type { Request, Response } from "express";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import {
	CallToolRequestSchema,
	ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import type { ToolDefinition } from "@cerebro-claw/shared";

export interface CerebroMcpServerOptions {
	tools: () => ToolDefinition[];
	name?: string;
	version?: string;
}

/**
 * Build an MCP server that proxies a dynamic tool list (so newly registered
 * extensions show up without restarting). The factory returns a request
 * handler suitable to mount on an Express route.
 */
export function createMcpHandler(opts: CerebroMcpServerOptions) {
	const server = new Server(
		{ name: opts.name ?? "cerebro-claw", version: opts.version ?? "0.1.0" },
		{ capabilities: { tools: {} } },
	);

	server.setRequestHandler(ListToolsRequestSchema, async () => ({
		tools: opts.tools().map((t) => ({
			name: t.name,
			description: t.description,
			// Our ToolDefinition.parameters is already JSON Schema (type:"object",
			// properties, required). MCP accepts it verbatim.
			inputSchema: t.parameters,
		})),
	}));

	server.setRequestHandler(CallToolRequestSchema, async (req) => {
		const tool = opts.tools().find((t) => t.name === req.params.name);
		if (!tool) {
			return {
				content: [{ type: "text", text: `Unknown tool: ${req.params.name}` }],
				isError: true,
			};
		}
		try {
			const result = await tool.execute(req.params.arguments ?? {});
			return {
				content: [{ type: "text", text: result.content }],
				isError: !result.success,
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

	// Stateless: every request creates a fresh transport, runs once, closes.
	// This matches Claude Code's behavior (it opens a fresh MCP connection per turn).
	return async (req: Request, res: Response) => {
		const transport = new StreamableHTTPServerTransport({
			sessionIdGenerator: undefined, // stateless
			enableJsonResponse: true,
		});
		res.on("close", () => {
			transport.close().catch(() => undefined);
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
