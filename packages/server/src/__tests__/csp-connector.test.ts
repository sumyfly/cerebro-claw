import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import type { ExtensionAPI, ToolDefinition } from "@cerebro-claw/shared";
// The extension lives at extensions/csp-connector/ at the repo root.
// It's a file-loaded extension, but we test it directly here since the
// server package already has vitest configured.
// @ts-expect-error — path traverses out of rootDir, intentional for testing
import cspExtension from "../../../../extensions/csp-connector/index.ts";

function makeApi(env: Record<string, string> = {}): {
	api: ExtensionAPI;
	tools: Map<string, ToolDefinition>;
} {
	const tools = new Map<string, ToolDefinition>();
	const api: ExtensionAPI = {
		extensionId: "csp-connector",
		registerTool: (t) => tools.set(t.name, t),
		registerChannel: () => undefined,
		on: () => undefined,
		getStore: () => ({}) as never,
		getConfig: () => env,
	};
	return { api, tools };
}

const VALID_ID = "1".repeat(24);

describe("csp-connector", () => {
	const originalFetch = globalThis.fetch;
	const originalEnv = { ...process.env };

	beforeEach(() => {
		delete process.env.CSP_TOKEN;
		delete process.env.CSP_BASE_URL;
		delete process.env.CSP_CSM_EMAIL;
	});

	afterEach(() => {
		globalThis.fetch = originalFetch;
		process.env = { ...originalEnv };
	});

	it("registers 3 tools", async () => {
		const { api, tools } = makeApi();
		await cspExtension.factory(api);
		expect(tools.size).toBe(3);
		expect(tools.has("csp_list_my_accounts")).toBe(true);
		expect(tools.has("csp_get_account")).toBe(true);
		expect(tools.has("csp_get_health_score")).toBe(true);
	});

	it("returns a clear error when CSP_TOKEN is not configured", async () => {
		const { api, tools } = makeApi();
		await cspExtension.factory(api);
		const result = await tools.get("csp_get_account")!.execute({ business_id: VALID_ID });
		expect(result.success).toBe(false);
		expect(result.content).toContain("CSP_TOKEN not configured");
	});

	it("validates business_id format (rejects non-hex)", async () => {
		const { api, tools } = makeApi({ CSP_TOKEN: "fake" });
		await cspExtension.factory(api);
		const result = await tools.get("csp_get_account")!.execute({ business_id: "not-a-business-id" });
		expect(result.success).toBe(false);
		expect(result.content).toContain("Invalid business_id");
	});

	it("csp_get_account calls the expected URL and returns JSON", async () => {
		const fetchMock = vi.fn(async () => ({
			ok: true,
			status: 200,
			text: async () => JSON.stringify({ success: true, profile: { name: "Acme" } }),
		}));
		globalThis.fetch = fetchMock as never;

		const { api, tools } = makeApi({ CSP_TOKEN: "tok", CSP_BASE_URL: "http://csp.test" });
		await cspExtension.factory(api);
		const result = await tools.get("csp_get_account")!.execute({ business_id: VALID_ID });

		expect(result.success).toBe(true);
		expect(result.content).toContain("Acme");
		expect(fetchMock).toHaveBeenCalledTimes(1);
		const call = fetchMock.mock.calls[0][0] as string;
		expect(call).toBe(`http://csp.test/api/accounts/${VALID_ID}`);
		const init = fetchMock.mock.calls[0][1] as RequestInit;
		expect((init.headers as Record<string, string>).Authorization).toBe("Bearer tok");
	});

	it("csp_list_my_accounts uses the default CSM email and forwards search/limit", async () => {
		const fetchMock = vi.fn(async () => ({
			ok: true,
			status: 200,
			text: async () => JSON.stringify({ items: [] }),
		}));
		globalThis.fetch = fetchMock as never;

		const { api, tools } = makeApi({
			CSP_TOKEN: "tok",
			CSP_BASE_URL: "http://csp.test",
			CSP_CSM_EMAIL: "csm@example.com",
		});
		await cspExtension.factory(api);
		const result = await tools.get("csp_list_my_accounts")!.execute({ search: "acme", limit: 5 });

		expect(result.success).toBe(true);
		const url = fetchMock.mock.calls[0][0] as string;
		expect(url).toContain("assignedCsmId=csm%40example.com");
		expect(url).toContain("search=acme");
		expect(url).toContain("limit=5");
	});

	it("caps the limit at 100", async () => {
		const fetchMock = vi.fn(async () => ({
			ok: true,
			status: 200,
			text: async () => "{}",
		}));
		globalThis.fetch = fetchMock as never;

		const { api, tools } = makeApi({ CSP_TOKEN: "tok", CSP_BASE_URL: "http://csp.test" });
		await cspExtension.factory(api);
		await tools.get("csp_list_my_accounts")!.execute({ limit: 1000 });

		const url = fetchMock.mock.calls[0][0] as string;
		expect(url).toContain("limit=100");
		expect(url).not.toContain("limit=1000");
	});

	it("surfaces HTTP errors clearly", async () => {
		const fetchMock = vi.fn(async () => ({
			ok: false,
			status: 401,
			text: async () => JSON.stringify({ error: "Unauthorized" }),
		}));
		globalThis.fetch = fetchMock as never;

		const { api, tools } = makeApi({ CSP_TOKEN: "tok", CSP_BASE_URL: "http://csp.test" });
		await cspExtension.factory(api);
		const result = await tools.get("csp_get_account")!.execute({ business_id: VALID_ID });

		expect(result.success).toBe(false);
		expect(result.content).toContain("CSP error 401");
		expect(result.content).toContain("Unauthorized");
	});

	it("surfaces network errors without crashing", async () => {
		globalThis.fetch = (async () => {
			throw new Error("ECONNREFUSED");
		}) as never;

		const { api, tools } = makeApi({ CSP_TOKEN: "tok", CSP_BASE_URL: "http://csp.test" });
		await cspExtension.factory(api);
		const result = await tools.get("csp_get_health_score")!.execute({ business_id: VALID_ID });

		expect(result.success).toBe(false);
		expect(result.content).toContain("CSP request failed");
	});

	it("strips trailing slash on CSP_BASE_URL", async () => {
		const fetchMock = vi.fn(async () => ({
			ok: true,
			status: 200,
			text: async () => "{}",
		}));
		globalThis.fetch = fetchMock as never;

		const { api, tools } = makeApi({ CSP_TOKEN: "tok", CSP_BASE_URL: "http://csp.test/" });
		await cspExtension.factory(api);
		await tools.get("csp_get_account")!.execute({ business_id: VALID_ID });

		const url = fetchMock.mock.calls[0][0] as string;
		expect(url).toBe(`http://csp.test/api/accounts/${VALID_ID}`);
		expect(url).not.toContain("//api");
	});
});
