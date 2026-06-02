import type {
	CustomerProfile,
	CustomerState,
	HistoryEntry,
	InstinctEntry,
} from "@cerebro-claw/shared";
import { beforeEach, describe, expect, it } from "vitest";
import { InMemoryStore } from "../in-memory-store.js";

function makeProfile(id: string): CustomerProfile {
	return {
		id,
		companyName: `Company ${id}`,
		contacts: [{ name: "Alice", role: "CTO", isDecisionMaker: true }],
		csmOwnerId: "sarah",
		createdAt: new Date(),
		updatedAt: new Date(),
	};
}

function makeState(customerId: string): CustomerState {
	return {
		customerId,
		health: "good",
		openIssues: 0,
		lastContactDate: new Date(),
		usageTrend: "flat",
		updatedAt: new Date(),
	};
}

describe("InMemoryStore", () => {
	let store: InMemoryStore;

	beforeEach(() => {
		store = new InMemoryStore();
	});

	describe("profiles", () => {
		it("returns null for unknown customer", async () => {
			expect(await store.getProfile("unknown")).toBeNull();
		});

		it("upserts and retrieves a profile", async () => {
			const profile = makeProfile("acme");
			await store.upsertProfile(profile);
			expect(await store.getProfile("acme")).toEqual(profile);
		});

		it("lists all profiles", async () => {
			await store.upsertProfile(makeProfile("acme"));
			await store.upsertProfile(makeProfile("globex"));
			const list = await store.listProfiles();
			expect(list).toHaveLength(2);
		});

		it("overwrites profile on upsert", async () => {
			await store.upsertProfile(makeProfile("acme"));
			const updated = { ...makeProfile("acme"), plan: "Enterprise" };
			await store.upsertProfile(updated);
			const result = await store.getProfile("acme");
			expect(result?.plan).toBe("Enterprise");
		});
	});

	describe("state", () => {
		it("returns null for unknown customer", async () => {
			expect(await store.getState("unknown")).toBeNull();
		});

		it("updates and retrieves state", async () => {
			const state = makeState("acme");
			await store.updateState(state);
			expect(await store.getState("acme")).toEqual(state);
		});

		it("overwrites state on update", async () => {
			await store.updateState(makeState("acme"));
			const updated = { ...makeState("acme"), health: "at-risk" as const };
			await store.updateState(updated);
			expect((await store.getState("acme"))?.health).toBe("at-risk");
		});
	});

	describe("history", () => {
		it("returns empty array for unknown customer", async () => {
			expect(await store.getHistory("unknown")).toEqual([]);
		});

		it("adds and retrieves history entries", async () => {
			const entry: HistoryEntry = {
				id: "h1",
				customerId: "acme",
				type: "call",
				summary: "Quarterly review call",
				timestamp: new Date(),
			};
			await store.addHistory(entry);
			const result = await store.getHistory("acme");
			expect(result).toHaveLength(1);
			expect(result[0].summary).toBe("Quarterly review call");
		});

		it("respects limit", async () => {
			for (let i = 0; i < 10; i++) {
				await store.addHistory({
					id: `h${i}`,
					customerId: "acme",
					type: "event",
					summary: `Event ${i}`,
					timestamp: new Date(),
				});
			}
			const result = await store.getHistory("acme", 3);
			expect(result).toHaveLength(3);
			expect(result[0].summary).toBe("Event 7");
		});

		it("searches history by keyword", async () => {
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
				summary: "Bug report on dashboard",
				timestamp: new Date(),
			});
			const results = await store.searchHistory("acme", "renewal");
			expect(results).toHaveLength(1);
			expect(results[0].id).toBe("h1");
		});
	});

	describe("instincts", () => {
		it("returns empty array for unknown customer", async () => {
			expect(await store.getInstincts("unknown")).toEqual([]);
		});

		it("adds and retrieves instinct entries", async () => {
			const entry: InstinctEntry = {
				id: "i1",
				customerId: "acme",
				content: "Mike is the real decision maker",
				source: "sarah",
				createdAt: new Date(),
			};
			await store.addInstinct(entry);
			const result = await store.getInstincts("acme");
			expect(result).toHaveLength(1);
			expect(result[0].content).toBe("Mike is the real decision maker");
		});

		it("searches instincts by keyword", async () => {
			await store.addInstinct({
				id: "i1",
				customerId: "acme",
				content: "Evaluating competitor product",
				source: "sarah",
				createdAt: new Date(),
			});
			await store.addInstinct({
				id: "i2",
				customerId: "acme",
				content: "Price sensitive right now",
				source: "sarah",
				createdAt: new Date(),
			});
			const results = await store.searchInstincts("acme", "competitor");
			expect(results).toHaveLength(1);
			expect(results[0].id).toBe("i1");
		});
	});
});

describe("InMemoryStore decision memory", () => {
	it("returns null before any decision and round-trips a recorded one", async () => {
		const store = new InMemoryStore();
		expect(await store.getLastDecision("c1")).toBeNull();
		const ts = new Date("2026-06-02T00:00:00Z");
		await store.recordDecision({ customerId: "c1", signalFingerprint: "fp-1", band: "act", ts });
		const got = await store.getLastDecision("c1");
		expect(got).toMatchObject({ customerId: "c1", signalFingerprint: "fp-1", band: "act" });
	});

	it("keeps only the latest decision per customer", async () => {
		const store = new InMemoryStore();
		const ts = new Date("2026-06-02T00:00:00Z");
		await store.recordDecision({ customerId: "c1", signalFingerprint: "fp-1", band: "act", ts });
		await store.recordDecision({
			customerId: "c1",
			signalFingerprint: "fp-2",
			band: "escalate",
			ts,
		});
		expect((await store.getLastDecision("c1"))?.signalFingerprint).toBe("fp-2");
	});
});
