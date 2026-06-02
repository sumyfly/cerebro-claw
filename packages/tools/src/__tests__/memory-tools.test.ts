import { InMemoryStore } from "@cerebro-claw/memory";
import type { ToolDefinition } from "@cerebro-claw/shared";
import { beforeEach, describe, expect, it } from "vitest";
import { createMemoryTools } from "../memory-tools.js";

describe("memory tools", () => {
	let store: InMemoryStore;
	let tools: ToolDefinition[];
	let toolMap: Map<string, ToolDefinition>;

	beforeEach(async () => {
		store = new InMemoryStore();
		tools = createMemoryTools(store);
		toolMap = new Map(tools.map((t) => [t.name, t]));

		await store.upsertProfile({
			id: "acme",
			companyName: "Acme Corp",
			plan: "Enterprise",
			contacts: [{ name: "John", role: "CTO", isDecisionMaker: true }],
			csmOwnerId: "sarah",
			createdAt: new Date(),
			updatedAt: new Date(),
		});
		await store.updateState({
			customerId: "acme",
			health: "good",
			openIssues: 2,
			lastContactDate: new Date(),
			usageTrend: "up",
			updatedAt: new Date(),
		});
	});

	it("registers 4 tools", () => {
		expect(tools).toHaveLength(4);
		expect(toolMap.has("memory_read")).toBe(true);
		expect(toolMap.has("memory_search")).toBe(true);
		expect(toolMap.has("memory_update")).toBe(true);
		expect(toolMap.has("memory_instinct")).toBe(true);
	});

	describe("memory_read", () => {
		it("returns profile and state for known customer", async () => {
			const result = await toolMap.get("memory_read")!.execute({ customer_id: "acme" });
			expect(result.success).toBe(true);
			const data = JSON.parse(result.content);
			expect(data.profile.companyName).toBe("Acme Corp");
			expect(data.state.health).toBe("good");
		});

		it("fails for unknown customer", async () => {
			const result = await toolMap.get("memory_read")!.execute({ customer_id: "unknown" });
			expect(result.success).toBe(false);
		});
	});

	describe("memory_update", () => {
		it("updates customer state", async () => {
			await toolMap.get("memory_update")!.execute({
				customer_id: "acme",
				health: "at-risk",
				open_issues: 5,
			});
			const state = await store.getState("acme");
			expect(state?.health).toBe("at-risk");
			expect(state?.openIssues).toBe(5);
		});

		it("adds history entry", async () => {
			await toolMap.get("memory_update")!.execute({
				customer_id: "acme",
				history_type: "call",
				history_summary: "Discussed Q3 renewal",
			});
			const history = await store.getHistory("acme");
			expect(history).toHaveLength(1);
			expect(history[0].summary).toBe("Discussed Q3 renewal");
		});
	});

	describe("memory_search", () => {
		it("searches across history and instincts", async () => {
			await store.addHistory({
				id: "h1",
				customerId: "acme",
				type: "call",
				summary: "Renewal discussion",
				timestamp: new Date(),
			});
			await store.addInstinct({
				id: "i1",
				customerId: "acme",
				content: "Sensitive about renewal pricing",
				source: "sarah",
				createdAt: new Date(),
			});
			const result = await toolMap.get("memory_search")!.execute({
				customer_id: "acme",
				query: "renewal",
			});
			expect(result.success).toBe(true);
			const data = JSON.parse(result.content);
			expect(data.history).toHaveLength(1);
			expect(data.instincts).toHaveLength(1);
		});
	});

	describe("memory_instinct", () => {
		it("stores an instinct note", async () => {
			const result = await toolMap.get("memory_instinct")!.execute({
				customer_id: "acme",
				note: "Mike is the real decision maker",
				source: "sarah",
			});
			expect(result.success).toBe(true);
			const instincts = await store.getInstincts("acme");
			expect(instincts).toHaveLength(1);
			expect(instincts[0].content).toBe("Mike is the real decision maker");
		});
	});
});
