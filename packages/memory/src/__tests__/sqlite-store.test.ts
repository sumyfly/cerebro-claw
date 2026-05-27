import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { SqliteStore } from "../sqlite-store.js";
import { unlinkSync } from "node:fs";

const TEST_DB = "/tmp/cerebro-claw-test.db";

describe("SqliteStore", () => {
	let store: SqliteStore;

	beforeEach(() => {
		try { unlinkSync(TEST_DB); } catch {}
		store = new SqliteStore(TEST_DB);
	});

	afterEach(() => {
		store.close();
		try { unlinkSync(TEST_DB); } catch {}
	});

	it("persists and retrieves a profile", async () => {
		await store.upsertProfile({
			id: "acme",
			companyName: "Acme Corp",
			contacts: [],
			csmOwnerId: "sarah",
			createdAt: new Date("2026-01-01"),
			updatedAt: new Date("2026-01-01"),
		});
		const profile = await store.getProfile("acme");
		expect(profile?.companyName).toBe("Acme Corp");
		expect(profile?.createdAt).toEqual(new Date("2026-01-01"));
	});

	it("lists all profiles", async () => {
		await store.upsertProfile({
			id: "acme",
			companyName: "Acme",
			contacts: [],
			csmOwnerId: "sarah",
			createdAt: new Date(),
			updatedAt: new Date(),
		});
		await store.upsertProfile({
			id: "globex",
			companyName: "Globex",
			contacts: [],
			csmOwnerId: "sarah",
			createdAt: new Date(),
			updatedAt: new Date(),
		});
		expect(await store.listProfiles()).toHaveLength(2);
	});

	it("persists and retrieves state", async () => {
		await store.updateState({
			customerId: "acme",
			health: "at-risk",
			openIssues: 3,
			lastContactDate: new Date("2026-05-01"),
			usageTrend: "dropping",
			updatedAt: new Date(),
		});
		const state = await store.getState("acme");
		expect(state?.health).toBe("at-risk");
		expect(state?.openIssues).toBe(3);
		expect(state?.lastContactDate).toEqual(new Date("2026-05-01"));
	});

	it("persists and searches history", async () => {
		await store.addHistory({
			id: "h1",
			customerId: "acme",
			type: "call",
			summary: "Discussed renewal pricing",
			timestamp: new Date(),
		});
		await store.addHistory({
			id: "h2",
			customerId: "acme",
			type: "ticket",
			summary: "Bug in dashboard widget",
			timestamp: new Date(),
		});
		const all = await store.getHistory("acme");
		expect(all).toHaveLength(2);
		const found = await store.searchHistory("acme", "renewal");
		expect(found).toHaveLength(1);
		expect(found[0].id).toBe("h1");
	});

	it("persists and searches instincts", async () => {
		await store.addInstinct({
			id: "i1",
			customerId: "acme",
			content: "Evaluating competitor Zendesk",
			source: "sarah",
			createdAt: new Date(),
		});
		const all = await store.getInstincts("acme");
		expect(all).toHaveLength(1);
		const found = await store.searchInstincts("acme", "competitor");
		expect(found).toHaveLength(1);
	});

	it("survives close and reopen", async () => {
		await store.upsertProfile({
			id: "acme",
			companyName: "Acme",
			contacts: [],
			csmOwnerId: "sarah",
			createdAt: new Date(),
			updatedAt: new Date(),
		});
		store.close();
		const store2 = new SqliteStore(TEST_DB);
		const profile = await store2.getProfile("acme");
		expect(profile?.companyName).toBe("Acme");
		store2.close();
	});
});
