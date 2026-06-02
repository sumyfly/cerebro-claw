import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import type { ToolDefinition } from "@cerebro-claw/shared";
import { describe, expect, it, vi } from "vitest";
import { createMcpHandler } from "../mcp-server.js";

function makeTool(
	name: string,
	execute: (
		params: Record<string, unknown>,
	) => Promise<{ content: string; success: boolean }> = async () => ({
		content: `executed ${name}`,
		success: true,
	}),
): ToolDefinition {
	return {
		name,
		description: `tool ${name}`,
		parameters: {
			type: "object",
			properties: {
				input: { type: "string", description: "input value" },
			},
		},
		execute,
	};
}

/**
 * Spin up a real Node HTTP server bound to the MCP handler. We hit it with
 * raw fetch(POST /) so the test exercises the same StreamableHTTPServerTransport
 * code path the Claude Code subprocess will use.
 */
async function withMcpServer(
	tools: () => ToolDefinition[],
	body: object,
	headers: Record<string, string> = {},
): Promise<{ status: number; json: any }> {
	const handler = createMcpHandler({ tools });
	const server = createServer(async (req, res) => {
		// Collect body
		const chunks: Buffer[] = [];
		for await (const c of req) chunks.push(c as Buffer);
		const raw = Buffer.concat(chunks).toString("utf8");
		(req as unknown as { body: unknown }).body = raw ? JSON.parse(raw) : {};
		await handler(req as never, res as never);
	});
	await new Promise<void>((r) => server.listen(0, r));
	const port = (server.address() as AddressInfo).port;

	try {
		const resp = await fetch(`http://127.0.0.1:${port}/`, {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				Accept: "application/json, text/event-stream",
				...headers,
			},
			body: JSON.stringify(body),
		});
		const text = await resp.text();
		const json = text ? JSON.parse(text) : null;
		return { status: resp.status, json };
	} finally {
		await new Promise<void>((r) => server.close(() => r()));
	}
}

describe("MCP server", () => {
	it("tools/list returns every registered tool with description and inputSchema", async () => {
		const tools = [makeTool("alpha"), makeTool("beta")];
		const { status, json } = await withMcpServer(() => tools, {
			jsonrpc: "2.0",
			id: 1,
			method: "tools/list",
		});
		expect(status).toBe(200);
		expect(json.result.tools).toHaveLength(2);
		const names = json.result.tools.map((t: { name: string }) => t.name);
		expect(names.sort()).toEqual(["alpha", "beta"]);
		const alpha = json.result.tools.find((t: { name: string }) => t.name === "alpha");
		expect(alpha.description).toBe("tool alpha");
		expect(alpha.inputSchema.type).toBe("object");
		expect(alpha.inputSchema.properties.input).toBeDefined();
	});

	it("tools/list reflects a dynamic tools function (extension added at runtime)", async () => {
		const tools: ToolDefinition[] = [makeTool("first")];
		const handler = createMcpHandler({ tools: () => tools });

		// Mount and hit once
		const fetchTools = async () => {
			const server = createServer(async (req, res) => {
				const chunks: Buffer[] = [];
				for await (const c of req) chunks.push(c as Buffer);
				(req as unknown as { body: unknown }).body = JSON.parse(
					Buffer.concat(chunks).toString("utf8"),
				);
				await handler(req as never, res as never);
			});
			await new Promise<void>((r) => server.listen(0, r));
			const port = (server.address() as AddressInfo).port;
			const r = await fetch(`http://127.0.0.1:${port}/`, {
				method: "POST",
				headers: {
					"Content-Type": "application/json",
					Accept: "application/json, text/event-stream",
				},
				body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" }),
			});
			const j = await r.json();
			await new Promise<void>((res) => server.close(() => res()));
			return j;
		};

		const before = await fetchTools();
		expect(before.result.tools).toHaveLength(1);

		tools.push(makeTool("late-added"));
		const after = await fetchTools();
		expect(after.result.tools).toHaveLength(2);
		expect(after.result.tools.map((t: { name: string }) => t.name).sort()).toEqual([
			"first",
			"late-added",
		]);
	});

	it("tools/call invokes the right tool and returns its content", async () => {
		const calls: { name: string; params: unknown }[] = [];
		const tools = [
			makeTool("alpha", async (params) => {
				calls.push({ name: "alpha", params });
				return { content: "alpha result", success: true };
			}),
			makeTool("beta", async (params) => {
				calls.push({ name: "beta", params });
				return { content: "beta result", success: true };
			}),
		];

		const { status, json } = await withMcpServer(() => tools, {
			jsonrpc: "2.0",
			id: 2,
			method: "tools/call",
			params: { name: "beta", arguments: { input: "hello" } },
		});
		expect(status).toBe(200);
		expect(json.result.isError).toBeFalsy();
		expect(json.result.content[0].text).toBe("beta result");
		expect(calls).toEqual([{ name: "beta", params: { input: "hello" } }]);
	});

	it("tools/call surfaces unknown tool as isError with a clear message", async () => {
		const { json } = await withMcpServer(() => [makeTool("only-one")], {
			jsonrpc: "2.0",
			id: 3,
			method: "tools/call",
			params: { name: "ghost", arguments: {} },
		});
		expect(json.result.isError).toBe(true);
		expect(json.result.content[0].text).toContain("Unknown tool: ghost");
	});

	it("tools/call surfaces tool failures as isError but does not crash", async () => {
		const tools = [makeTool("boom", async () => ({ content: "kaboom", success: false }))];
		const { json } = await withMcpServer(() => tools, {
			jsonrpc: "2.0",
			id: 4,
			method: "tools/call",
			params: { name: "boom", arguments: {} },
		});
		expect(json.result.isError).toBe(true);
		expect(json.result.content[0].text).toBe("kaboom");
	});

	it("tools/call wraps thrown exceptions so the protocol never breaks", async () => {
		const tools = [
			{
				name: "exploder",
				description: "throws",
				parameters: { type: "object", properties: {} },
				execute: async () => {
					throw new Error("kaboom");
				},
			} as ToolDefinition,
		];
		const { json } = await withMcpServer(() => tools, {
			jsonrpc: "2.0",
			id: 5,
			method: "tools/call",
			params: { name: "exploder", arguments: {} },
		});
		expect(json.result.isError).toBe(true);
		expect(json.result.content[0].text).toContain("threw: kaboom");
	});
});
