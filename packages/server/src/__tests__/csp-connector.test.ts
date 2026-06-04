import type { ExtensionAPI, ToolDefinition } from "@cerebro-claw/shared";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
// The extension lives at extensions/csp-connector/ at the repo root.
// It's a file-loaded extension, but we test it directly here since the
// server package already has vitest configured.
// @ts-expect-error — path traverses out of rootDir, intentional for testing
import cspExtension from "../../../../extensions/csp-connector/index.ts";

function makeApi(env: Record<string, string> = {}): {
	api: ExtensionAPI;
	tools: Map<string, ToolDefinition>;
} {
	// The connector reads CSP_* from process.env (matching production wiring).
	for (const [k, v] of Object.entries(env)) {
		process.env[k] = v;
	}
	const tools = new Map<string, ToolDefinition>();
	const api: ExtensionAPI = {
		extensionId: "csp-connector",
		registerTool: (t) => tools.set(t.name, t),
		registerChannel: () => undefined,
		on: () => undefined,
		getStore: () => ({}) as never,
		getConfig: () => ({}),
	};
	return { api, tools };
}

const VALID_ID = "1".repeat(24);
const VALID_UUID = "11111111-2222-3333-4444-555555555555";

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

	it("registers all 10 tools", async () => {
		const { api, tools } = makeApi();
		await cspExtension.factory(api);
		expect(tools.size).toBe(10);
		expect(tools.has("csp_list_my_accounts")).toBe(true);
		expect(tools.has("csp_get_account")).toBe(true);
		expect(tools.has("csp_get_health_score")).toBe(true);
		expect(tools.has("csp_get_engagement")).toBe(true);
		expect(tools.has("csp_get_notes")).toBe(true);
		expect(tools.has("csp_create_note")).toBe(true);
		expect(tools.has("csp_delete_note")).toBe(true);
		expect(tools.has("csp_get_renewals")).toBe(true);
		expect(tools.has("csp_get_renewal")).toBe(true);
		expect(tools.has("csp_update_renewal")).toBe(true);
	});

	it("returns a clear error when CSP_TOKEN is not configured", async () => {
		const { api, tools } = makeApi();
		await cspExtension.factory(api);
		const result = await tools.get("csp_get_account")!.execute({ business_id: VALID_ID });
		expect(result.success).toBe(false);
		expect(result.content).toContain("CSP_TOKEN missing");
	});

	it("validates business_id format (rejects non-hex)", async () => {
		const { api, tools } = makeApi({ CSP_TOKEN: "fake" });
		await cspExtension.factory(api);
		const result = await tools
			.get("csp_get_account")!
			.execute({ business_id: "not-a-business-id" });
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
		expect(call).toBe(`http://csp.test/api/v1/accounts/${VALID_ID}`);
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
		expect(url).toBe(`http://csp.test/api/v1/accounts/${VALID_ID}`);
		expect(url).not.toContain("//api");
	});

	// --- v2 slice: notes / renewals / engagement / write-back ---

	it("csp_get_engagement hits /api/accounts/:id/engagement", async () => {
		const fetchMock = vi.fn(async () => ({
			ok: true,
			status: 200,
			text: async () => JSON.stringify({ success: true, data: { logins7d: 12 } }),
		}));
		globalThis.fetch = fetchMock as never;

		const { api, tools } = makeApi({ CSP_TOKEN: "tok", CSP_BASE_URL: "http://csp.test" });
		await cspExtension.factory(api);
		const result = await tools.get("csp_get_engagement")!.execute({ business_id: VALID_ID });

		expect(result.success).toBe(true);
		expect(fetchMock.mock.calls[0][0]).toBe(
			`http://csp.test/api/v1/accounts/${VALID_ID}/engagement`,
		);
	});

	it("csp_get_notes builds the right query string", async () => {
		const fetchMock = vi.fn(async () => ({
			ok: true,
			status: 200,
			text: async () => JSON.stringify({ data: [] }),
		}));
		globalThis.fetch = fetchMock as never;

		const { api, tools } = makeApi({ CSP_TOKEN: "tok", CSP_BASE_URL: "http://csp.test" });
		await cspExtension.factory(api);
		await tools.get("csp_get_notes")!.execute({
			business_id: VALID_ID,
			search: "renewal",
			type: "MEETING",
			limit: 5,
		});

		const url = fetchMock.mock.calls[0][0] as string;
		expect(url).toContain(`businessId=${VALID_ID}`);
		expect(url).toContain("search=renewal");
		expect(url).toContain("type=MEETING");
		expect(url).toContain("pageSize=5");
		expect(url).toContain("sortBy=createdAt");
		expect(url).toContain("sortOrder=desc");
	});

	it("csp_get_notes caps limit at 50", async () => {
		const fetchMock = vi.fn(async () => ({ ok: true, status: 200, text: async () => "{}" }));
		globalThis.fetch = fetchMock as never;

		const { api, tools } = makeApi({ CSP_TOKEN: "tok", CSP_BASE_URL: "http://csp.test" });
		await cspExtension.factory(api);
		await tools.get("csp_get_notes")!.execute({ business_id: VALID_ID, limit: 999 });

		const url = fetchMock.mock.calls[0][0] as string;
		expect(url).toContain("pageSize=50");
		expect(url).not.toContain("pageSize=999");
	});

	it("csp_create_note POSTs JSON body to /api/notes", async () => {
		const fetchMock = vi.fn(async () => ({
			ok: true,
			status: 200,
			text: async () => JSON.stringify({ success: true, data: { id: "note-1" } }),
		}));
		globalThis.fetch = fetchMock as never;

		const { api, tools } = makeApi({ CSP_TOKEN: "tok", CSP_BASE_URL: "http://csp.test" });
		await cspExtension.factory(api);
		const result = await tools.get("csp_create_note")!.execute({
			business_id: VALID_ID,
			content: "Discussed renewal pricing with Mike — wants 10% discount.",
			title: "Q3 renewal call",
			type: "CALL",
			priority: "HIGH",
			is_private: false,
		});

		expect(result.success).toBe(true);
		expect(result.content).toContain("Note created");

		const call = fetchMock.mock.calls[0];
		expect(call[0]).toBe("http://csp.test/api/v1/notes");
		const init = call[1] as RequestInit;
		expect(init.method).toBe("POST");
		expect((init.headers as Record<string, string>)["Content-Type"]).toBe("application/json");
		const body = JSON.parse(init.body as string);
		expect(body.businessId).toBe(VALID_ID);
		expect(body.content).toContain("renewal pricing");
		expect(body.title).toBe("Q3 renewal call");
		expect(body.type).toBe("CALL");
		expect(body.priority).toBe("HIGH");
		expect(body.isPrivate).toBe(false);
	});

	it("csp_create_note requires content and validates business_id", async () => {
		const { api, tools } = makeApi({ CSP_TOKEN: "tok" });
		await cspExtension.factory(api);
		const result = await tools.get("csp_create_note")!.execute({
			business_id: "not-hex",
			content: "anything",
		});
		expect(result.success).toBe(false);
		expect(result.content).toContain("Invalid business_id");
	});

	it("csp_get_renewals hits the per-account renewals endpoint", async () => {
		const fetchMock = vi.fn(async () => ({
			ok: true,
			status: 200,
			text: async () => JSON.stringify({ data: [{ id: "r-1", status: "OPEN" }] }),
		}));
		globalThis.fetch = fetchMock as never;

		const { api, tools } = makeApi({ CSP_TOKEN: "tok", CSP_BASE_URL: "http://csp.test" });
		await cspExtension.factory(api);
		await tools
			.get("csp_get_renewals")!
			.execute({ business_id: VALID_ID, status: "OPEN", limit: 5 });

		const url = fetchMock.mock.calls[0][0] as string;
		expect(url).toContain(`/api/v1/accounts/${VALID_ID}/renewals?`);
		expect(url).toContain("status=OPEN");
		expect(url).toContain("pageSize=5");
	});

	it("csp_get_renewal accepts UUID renewal ids and hits /api/v1/renewals/:id", async () => {
		const fetchMock = vi.fn(async () => ({
			ok: true,
			status: 200,
			text: async () => JSON.stringify({ data: { id: VALID_UUID, status: "OPEN" } }),
		}));
		globalThis.fetch = fetchMock as never;

		const { api, tools } = makeApi({ CSP_TOKEN: "tok", CSP_BASE_URL: "http://csp.test" });
		await cspExtension.factory(api);

		const ok = await tools.get("csp_get_renewal")!.execute({ renewal_id: VALID_UUID });
		expect(ok.success).toBe(true);
		expect(fetchMock.mock.calls[0][0]).toBe(`http://csp.test/api/v1/renewals/${VALID_UUID}`);

		// Reject a 24-char hex (would have passed under the old, wrong validation)
		const wrongShape = await tools.get("csp_get_renewal")!.execute({ renewal_id: VALID_ID });
		expect(wrongShape.success).toBe(false);
		expect(wrongShape.content).toContain("Invalid renewal_id");

		// Reject obviously malformed
		const bad = await tools.get("csp_get_renewal")!.execute({ renewal_id: "not-hex" });
		expect(bad.success).toBe(false);
		expect(bad.content).toContain("Invalid renewal_id");
	});

	// --- Review fixes: prefix coverage, clamp edge cases, timeout ---

	it("every tool URL starts with the /api/v1 prefix", async () => {
		const fetchMock = vi.fn(async () => ({ ok: true, status: 200, text: async () => "{}" }));
		globalThis.fetch = fetchMock as never;

		const { api, tools } = makeApi({ CSP_TOKEN: "tok", CSP_BASE_URL: "http://csp.test" });
		await cspExtension.factory(api);

		await tools.get("csp_list_my_accounts")!.execute({});
		await tools.get("csp_get_account")!.execute({ business_id: VALID_ID });
		await tools.get("csp_get_health_score")!.execute({ business_id: VALID_ID });
		await tools.get("csp_get_engagement")!.execute({ business_id: VALID_ID });
		await tools.get("csp_get_notes")!.execute({ business_id: VALID_ID });
		await tools.get("csp_create_note")!.execute({ business_id: VALID_ID, content: "x" });
		await tools.get("csp_delete_note")!.execute({ note_id: VALID_UUID });
		await tools.get("csp_get_renewals")!.execute({ business_id: VALID_ID });
		await tools.get("csp_get_renewal")!.execute({ renewal_id: VALID_UUID });
		await tools.get("csp_update_renewal")!.execute({ renewal_id: VALID_UUID, status: "WON" });

		for (const call of fetchMock.mock.calls) {
			const url = call[0] as string;
			expect(url, `URL should include /api/v1: ${url}`).toContain("/api/v1/");
		}
		expect(fetchMock).toHaveBeenCalledTimes(10);
	});

	it("csp_update_renewal POSTs status/playbook to /renewals/:id/update", async () => {
		const fetchMock = vi.fn(async () => ({
			ok: true,
			status: 200,
			text: async () => JSON.stringify({ success: true, data: { id: VALID_UUID, status: "WON" } }),
		}));
		globalThis.fetch = fetchMock as never;

		const { api, tools } = makeApi({ CSP_TOKEN: "tok", CSP_BASE_URL: "http://csp.test" });
		await cspExtension.factory(api);
		const result = await tools.get("csp_update_renewal")!.execute({
			renewal_id: VALID_UUID,
			status: "WON",
			playbook_stage: "CLOSED",
			note: "Renewed at list.",
		});

		expect(result.success).toBe(true);
		expect(result.content).toContain("updated in CSP");
		const call = fetchMock.mock.calls[0];
		expect(call[0]).toBe(`http://csp.test/api/v1/renewals/${VALID_UUID}/update`);
		const init = call[1] as RequestInit;
		expect(init.method).toBe("POST");
		const body = JSON.parse(init.body as string);
		expect(body.status).toBe("WON");
		expect(body.playbookStage).toBe("CLOSED");
		expect(body.note).toBe("Renewed at list.");
	});

	it("csp_update_renewal rejects a non-UUID id before any fetch", async () => {
		const fetchMock = vi.fn(async () => ({ ok: true, status: 200, text: async () => "{}" }));
		globalThis.fetch = fetchMock as never;

		const { api, tools } = makeApi({ CSP_TOKEN: "tok", CSP_BASE_URL: "http://csp.test" });
		await cspExtension.factory(api);
		const result = await tools
			.get("csp_update_renewal")!
			.execute({ renewal_id: "not-a-uuid", status: "WON" });

		expect(result.success).toBe(false);
		expect(result.content).toContain("Invalid renewal_id");
		expect(fetchMock).not.toHaveBeenCalled();
	});

	it("csp_update_renewal requires at least one field to change", async () => {
		const { api, tools } = makeApi({ CSP_TOKEN: "tok", CSP_BASE_URL: "http://csp.test" });
		await cspExtension.factory(api);
		const result = await tools.get("csp_update_renewal")!.execute({ renewal_id: VALID_UUID });
		expect(result.success).toBe(false);
		expect(result.content).toContain("Nothing to update");
	});

	it("csp_update_renewal surfaces a rejected transition with fallback guidance", async () => {
		const fetchMock = vi.fn(async () => ({
			ok: false,
			status: 403,
			text: async () => JSON.stringify({ error: "transition not permitted" }),
		}));
		globalThis.fetch = fetchMock as never;

		const { api, tools } = makeApi({ CSP_TOKEN: "tok", CSP_BASE_URL: "http://csp.test" });
		await cspExtension.factory(api);
		const result = await tools
			.get("csp_update_renewal")!
			.execute({ renewal_id: VALID_UUID, status: "WON" });

		expect(result.success).toBe(false);
		expect(result.content).toContain("CSP rejected the renewal update (403)");
		expect(result.content).toContain("csp_create_note");
		expect(result.content).toContain("escalate");
	});

	it("csp_delete_note POSTs to /notes/:id/delete and rejects non-UUID ids", async () => {
		const fetchMock = vi.fn(async () => ({
			ok: true,
			status: 200,
			text: async () => JSON.stringify({ success: true }),
		}));
		globalThis.fetch = fetchMock as never;

		const { api, tools } = makeApi({ CSP_TOKEN: "tok", CSP_BASE_URL: "http://csp.test" });
		await cspExtension.factory(api);

		const ok = await tools.get("csp_delete_note")!.execute({ note_id: VALID_UUID });
		expect(ok.success).toBe(true);
		expect(ok.content).toContain("deleted from CSP");
		const init = fetchMock.mock.calls[0][1] as RequestInit;
		expect(init.method).toBe("POST");
		expect(fetchMock.mock.calls[0][0]).toBe(`http://csp.test/api/v1/notes/${VALID_UUID}/delete`);

		// Non-UUID rejected before fetch
		fetchMock.mockClear();
		const bad = await tools.get("csp_delete_note")!.execute({ note_id: "not-a-uuid" });
		expect(bad.success).toBe(false);
		expect(bad.content).toContain("Invalid note_id");
		expect(fetchMock).not.toHaveBeenCalled();
	});

	it("clamps non-numeric, negative, and zero limit to the default", async () => {
		const fetchMock = vi.fn(async () => ({ ok: true, status: 200, text: async () => "{}" }));
		globalThis.fetch = fetchMock as never;

		const { api, tools } = makeApi({ CSP_TOKEN: "tok", CSP_BASE_URL: "http://csp.test" });
		await cspExtension.factory(api);

		for (const bad of ["abc" as unknown as number, -5, 0, Number.NaN, undefined]) {
			fetchMock.mockClear();
			await tools.get("csp_list_my_accounts")!.execute({ limit: bad });
			const url = fetchMock.mock.calls[0][0] as string;
			expect(url, `bad limit=${String(bad)} → fallback to default=20`).toContain("limit=20");
		}
	});

	it("returns a timeout error when the request exceeds CSP_TIMEOUT_MS", async () => {
		globalThis.fetch = (async (_url: unknown, opts: { signal?: AbortSignal }) =>
			new Promise((_resolve, reject) => {
				opts.signal?.addEventListener("abort", () => {
					const err = new Error("aborted");
					err.name = "AbortError";
					reject(err);
				});
			})) as never;

		const { api, tools } = makeApi({
			CSP_TOKEN: "tok",
			CSP_BASE_URL: "http://csp.test",
			CSP_TIMEOUT_MS: "30",
		});
		await cspExtension.factory(api);
		const result = await tools.get("csp_get_account")!.execute({ business_id: VALID_ID });

		expect(result.success).toBe(false);
		expect(result.content).toContain("timed out");
	});
});
