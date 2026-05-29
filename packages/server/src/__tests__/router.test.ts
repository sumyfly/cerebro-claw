import { describe, it, expect, beforeEach, vi } from "vitest";
import { Router } from "../router.js";
import { InMemoryStore } from "@cerebro-claw/memory";
import type { CustomerProfile, InboundMessage } from "@cerebro-claw/shared";

const mockAgent = {
	prompt: vi.fn().mockResolvedValue({ text: "Agent response", toolCalls: [] }),
};

function makeMessage(overrides: Partial<InboundMessage> = {}): InboundMessage {
	return {
		channelType: "lark",
		channelId: "chat-123",
		senderId: "user-456",
		senderName: "Sarah",
		text: "What's going on with Acme?",
		timestamp: new Date(),
		...overrides,
	};
}

function makeProfile(id: string, opts: Partial<CustomerProfile> = {}): CustomerProfile {
	return {
		id,
		companyName: id.toUpperCase(),
		contacts: [],
		csmOwnerId: "sarah",
		createdAt: new Date(),
		updatedAt: new Date(),
		...opts,
	};
}

describe("Router", () => {
	let router: Router;

	beforeEach(() => {
		vi.clearAllMocks();
		router = new Router(mockAgent as any);
	});

	describe("resolve", () => {
		it("returns null for unknown sender", () => {
			expect(router.resolve(makeMessage())).toBeNull();
		});

		it("resolves by sender ID", () => {
			router.addRoute("lark:user-456", { customerId: "acme", csmId: "sarah" });
			expect(router.resolve(makeMessage())).toEqual({
				customerId: "acme",
				csmId: "sarah",
			});
		});

		it("falls back to channel ID", () => {
			router.addRoute("lark:chat-123", { customerId: "globex", csmId: "sarah" });
			expect(router.resolve(makeMessage())).toEqual({
				customerId: "globex",
				csmId: "sarah",
			});
		});

		it("prefers sender ID over channel ID", () => {
			router.addRoute("lark:user-456", { customerId: "acme", csmId: "sarah" });
			router.addRoute("lark:chat-123", { customerId: "globex", csmId: "sarah" });
			expect(router.resolve(makeMessage())).toEqual({
				customerId: "acme",
				csmId: "sarah",
			});
		});
	});

	describe("handleMessage", () => {
		it("includes route context when route exists", async () => {
			router.addRoute("lark:user-456", { customerId: "acme", csmId: "sarah" });
			await router.handleMessage(makeMessage(), "session-1");
			expect(mockAgent.prompt).toHaveBeenCalledWith(
				"What's going on with Acme?",
				"Current customer: acme. CSM: sarah.",
				"session-1",
			);
		});

		it("falls back to sender info when no route", async () => {
			await router.handleMessage(makeMessage());
			expect(mockAgent.prompt).toHaveBeenCalledWith(
				"What's going on with Acme?",
				expect.stringContaining("Sender: user-456"),
				undefined,
			);
		});

		it("returns agent response text", async () => {
			const result = await router.handleMessage(makeMessage());
			expect(result).toBe("Agent response");
		});
	});

	describe("portfolio enrichment", () => {
		it("lists the CSM's owned customers by Lark ID match", async () => {
			const store = new InMemoryStore();
			await store.upsertProfile(makeProfile("acme", { csmLarkUserId: "user-456" }));
			await store.upsertProfile(makeProfile("globex", { csmLarkUserId: "user-456" }));
			await store.upsertProfile(makeProfile("other", { csmLarkUserId: "someone-else" }));
			router = new Router(mockAgent as any, { store });

			await router.handleMessage(makeMessage());
			const context = mockAgent.prompt.mock.calls[0][1];
			expect(context).toContain("Your customers:");
			expect(context).toContain("ACME (id: acme)");
			expect(context).toContain("GLOBEX (id: globex)");
			expect(context).not.toContain("OTHER");
		});

		it("falls back to csmOwnerId when no Lark mapping is set", async () => {
			const store = new InMemoryStore();
			await store.upsertProfile(makeProfile("acme", { csmOwnerId: "user-456" }));
			router = new Router(mockAgent as any, { store });

			await router.handleMessage(makeMessage());
			const context = mockAgent.prompt.mock.calls[0][1];
			expect(context).toContain("Your customers:");
			expect(context).toContain("ACME");
		});

		it("falls back to all customers when sender owns none", async () => {
			const store = new InMemoryStore();
			await store.upsertProfile(makeProfile("acme", { csmOwnerId: "different-csm" }));
			router = new Router(mockAgent as any, { store });

			await router.handleMessage(makeMessage());
			const context = mockAgent.prompt.mock.calls[0][1];
			expect(context).toContain("Known customers:");
			expect(context).toContain("ACME");
		});

		it("omits portfolio section gracefully when store is empty", async () => {
			const store = new InMemoryStore();
			router = new Router(mockAgent as any, { store });
			await router.handleMessage(makeMessage());
			const context = mockAgent.prompt.mock.calls[0][1];
			expect(context).not.toContain("customers:");
		});

		it("does not crash if store throws", async () => {
			const broken = {
				listProfiles: () => {
					throw new Error("db down");
				},
			};
			router = new Router(mockAgent as any, { store: broken as any });
			await expect(router.handleMessage(makeMessage())).resolves.toBe("Agent response");
		});
	});
});
