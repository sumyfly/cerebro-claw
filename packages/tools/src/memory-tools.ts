import { randomUUID } from "node:crypto";
import type { MemoryStore, ToolDefinition } from "@cerebro-claw/shared";

export function createMemoryTools(store: MemoryStore): ToolDefinition[] {
	const memoryRead: ToolDefinition = {
		name: "memory_read",
		kind: "observe",
		blastRadius: "none",
		description:
			"Read a customer's profile and current state. Returns company info, contacts, health status, open issues, and key dates.",
		parameters: {
			type: "object",
			properties: {
				customer_id: { type: "string", description: "The customer ID to look up" },
			},
			required: ["customer_id"],
		},
		async execute(params) {
			const id = params.customer_id as string;
			const profile = await store.getProfile(id);
			if (!profile) {
				return { content: `No customer found with ID: ${id}`, success: false };
			}
			const state = await store.getState(id);
			return {
				content: JSON.stringify({ profile, state }, null, 2),
				success: true,
				details: { profile, state },
			};
		},
	};

	const memorySearch: ToolDefinition = {
		name: "memory_search",
		kind: "observe",
		blastRadius: "none",
		description:
			"Search a customer's history and instinct notes by keyword. Returns matching interactions, events, decisions, and CSM notes.",
		parameters: {
			type: "object",
			properties: {
				customer_id: { type: "string", description: "The customer ID to search" },
				query: { type: "string", description: "Search query" },
			},
			required: ["customer_id", "query"],
		},
		async execute(params) {
			const id = params.customer_id as string;
			const query = params.query as string;
			const [historyResults, instinctResults] = await Promise.all([
				store.searchHistory(id, query),
				store.searchInstincts(id, query),
			]);
			return {
				content: JSON.stringify({ history: historyResults, instincts: instinctResults }, null, 2),
				success: true,
				details: { historyCount: historyResults.length, instinctCount: instinctResults.length },
			};
		},
	};

	const memoryUpdate: ToolDefinition = {
		name: "memory_update",
		kind: "act",
		blastRadius: "internal",
		description:
			"Update a customer's state (health, open issues, usage trend) or add a history entry.",
		parameters: {
			type: "object",
			properties: {
				customer_id: { type: "string", description: "The customer ID" },
				health: {
					type: "string",
					description: "New health status",
					enum: ["good", "at-risk", "critical"],
				},
				open_issues: { type: "number", description: "Number of open issues" },
				usage_trend: {
					type: "string",
					description: "Current usage trend",
					enum: ["up", "flat", "dropping"],
				},
				history_type: {
					type: "string",
					description: "Type of history entry to add",
					enum: ["call", "email", "ticket", "message", "event", "decision"],
				},
				history_summary: { type: "string", description: "Summary of what happened" },
			},
			required: ["customer_id"],
		},
		async execute(params) {
			const id = params.customer_id as string;
			const existing = await store.getState(id);
			if (existing) {
				const updated = { ...existing, updatedAt: new Date() };
				if (params.health) updated.health = params.health as typeof updated.health;
				if (params.open_issues !== undefined) updated.openIssues = params.open_issues as number;
				if (params.usage_trend)
					updated.usageTrend = params.usage_trend as typeof updated.usageTrend;
				await store.updateState(updated);
			}

			if (params.history_type && params.history_summary) {
				await store.addHistory({
					id: randomUUID(),
					customerId: id,
					type: params.history_type as
						| "call"
						| "email"
						| "ticket"
						| "message"
						| "event"
						| "decision",
					summary: params.history_summary as string,
					timestamp: new Date(),
				});
			}

			return { content: `Customer ${id} updated.`, success: true };
		},
	};

	const memoryInstinct: ToolDefinition = {
		name: "memory_instinct",
		kind: "act",
		blastRadius: "internal",
		description:
			"Store an instinct note — informal knowledge the CSM shared about a customer that no system captures. Example: 'Mike is the real decision maker' or 'they are evaluating a competitor'.",
		parameters: {
			type: "object",
			properties: {
				customer_id: { type: "string", description: "The customer ID" },
				note: { type: "string", description: "The instinct note to remember" },
				source: {
					type: "string",
					description: "Who provided this info (e.g. CSM name, or 'brain-loop')",
				},
			},
			required: ["customer_id", "note"],
		},
		async execute(params) {
			const id = randomUUID();
			await store.addInstinct({
				id,
				customerId: params.customer_id as string,
				content: params.note as string,
				source: (params.source as string) ?? "csm",
				createdAt: new Date(),
			});
			// The id is the citable artifact — usable as `act` evidence {kind:"other", id}.
			return {
				content: `Instinct noted for customer ${params.customer_id} (id: ${id}).`,
				success: true,
				details: { instinctId: id },
			};
		},
	};

	return [memoryRead, memorySearch, memoryUpdate, memoryInstinct];
}
