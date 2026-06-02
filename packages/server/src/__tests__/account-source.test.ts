import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { InMemoryStore } from "@cerebro-claw/memory";
import {
	createCspAccountSource,
	createLocalAccountSource,
} from "../brain-loop.js";

describe("createLocalAccountSource", () => {
	it("lists profiles from the store", async () => {
		const store = new InMemoryStore();
		await store.upsertProfile({
			id: "acme",
			companyName: "Acme",
			contacts: [],
			csmOwnerId: "sarah",
			createdAt: new Date(),
			updatedAt: new Date(),
		});
		const src = createLocalAccountSource(store);
		const list = await src.list();
		expect(list).toEqual([{ id: "acme", companyName: "Acme" }]);
		expect(src.label).toContain("local");
	});

	it("buildSummary returns rich context from the store", async () => {
		const store = new InMemoryStore();
		await store.upsertProfile({
			id: "acme",
			companyName: "Acme",
			plan: "Enterprise",
			contractValue: 50000,
			contacts: [],
			csmOwnerId: "sarah",
			createdAt: new Date(),
			updatedAt: new Date(),
		});
		await store.updateState({
			customerId: "acme",
			health: "at-risk",
			openIssues: 2,
			lastContactDate: new Date("2026-05-01"),
			usageTrend: "dropping",
			updatedAt: new Date(),
		});
		const summary = await createLocalAccountSource(store).buildSummary("acme", "Acme");
		expect(summary).toContain("Acme");
		expect(summary).toContain("Plan: Enterprise");
		expect(summary).toContain("at-risk");
		expect(summary).toContain("dropping");
	});

	it("buildSummary gracefully handles missing profile", async () => {
		const store = new InMemoryStore();
		const summary = await createLocalAccountSource(store).buildSummary("ghost", "Ghost Co");
		expect(summary).toContain("no profile data");
	});
});

describe("createCspAccountSource", () => {
	const originalFetch = globalThis.fetch;
	afterEach(() => {
		globalThis.fetch = originalFetch;
	});

	it("calls /api/v1/accounts with CSM filter and limit, returns id+name pairs", async () => {
		const fetchMock = vi.fn(async () => ({
			ok: true,
			status: 200,
			json: async () => ({
				data: [
					{ id: "id-1", name: "Acme Co" },
					{ id: "id-2", name: "Beta Co" },
				],
			}),
		}));
		globalThis.fetch = fetchMock as never;

		const src = createCspAccountSource({
			baseUrl: "http://csp.test",
			token: "tok",
			csmEmail: "sarah@example.com",
			maxAccounts: 5,
		});
		const list = await src.list();

		expect(list).toEqual([
			{ id: "id-1", companyName: "Acme Co" },
			{ id: "id-2", companyName: "Beta Co" },
		]);
		const url = fetchMock.mock.calls[0][0] as string;
		expect(url).toContain("/api/v1/accounts?");
		expect(url).toContain("assignedCsmId=sarah%40example.com");
		expect(url).toContain("limit=5");
		const init = fetchMock.mock.calls[0][1] as RequestInit;
		expect((init.headers as Record<string, string>).Authorization).toBe("Bearer tok");
	});

	it("returns [] (not throws) on HTTP failure", async () => {
		globalThis.fetch = (async () => ({
			ok: false,
			status: 500,
			json: async () => ({}),
		})) as never;
		const src = createCspAccountSource({
			baseUrl: "http://csp.test",
			token: "tok",
			csmEmail: "x@y.com",
		});
		const list = await src.list();
		expect(list).toEqual([]);
	});

	it("returns [] on network error without crashing the loop", async () => {
		globalThis.fetch = (async () => {
			throw new Error("ECONNREFUSED");
		}) as never;
		const src = createCspAccountSource({
			baseUrl: "http://csp.test",
			token: "tok",
			csmEmail: "x@y.com",
		});
		const list = await src.list();
		expect(list).toEqual([]);
	});

	it("buildSummary is a pointer prompt telling the agent to fetch live data and steer through the action policy", async () => {
		const src = createCspAccountSource({
			baseUrl: "http://csp.test",
			token: "tok",
			csmEmail: "x@y.com",
		});
		const summary = await src.buildSummary("biz-id-123", "Acme");
		expect(summary).toContain("Acme");
		expect(summary).toContain("biz-id-123");
		// The pointer steers the agent to fetch live detail. The band menu is no
		// longer embedded here — the caller (evaluateCustomer / a runner's user
		// message) appends BAND_GUIDANCE once, so it's never listed twice.
		expect(summary).toContain("csp_get_account");
		expect(summary).toContain("csp_get_health_score");
	});
});
