import { describe, it, expect, beforeEach, vi } from "vitest";
import { Router } from "../router.js";
import type { InboundMessage } from "@cerebro-claw/shared";

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

describe("Router", () => {
	let router: Router;

	beforeEach(() => {
		vi.clearAllMocks();
		router = new Router(mockAgent as any);
	});

	describe("resolve", () => {
		it("returns null for unknown sender", () => {
			const result = router.resolve(makeMessage());
			expect(result).toBeNull();
		});

		it("resolves by sender ID", () => {
			router.addRoute("lark:user-456", { customerId: "acme", csmId: "sarah" });
			const result = router.resolve(makeMessage());
			expect(result).toEqual({ customerId: "acme", csmId: "sarah" });
		});

		it("falls back to channel ID", () => {
			router.addRoute("lark:chat-123", { customerId: "globex", csmId: "sarah" });
			const result = router.resolve(makeMessage());
			expect(result).toEqual({ customerId: "globex", csmId: "sarah" });
		});

		it("prefers sender ID over channel ID", () => {
			router.addRoute("lark:user-456", { customerId: "acme", csmId: "sarah" });
			router.addRoute("lark:chat-123", { customerId: "globex", csmId: "sarah" });
			const result = router.resolve(makeMessage());
			expect(result).toEqual({ customerId: "acme", csmId: "sarah" });
		});
	});

	describe("handleMessage", () => {
		it("calls agent with customer context when route exists", async () => {
			router.addRoute("lark:user-456", { customerId: "acme", csmId: "sarah" });
			await router.handleMessage(makeMessage(), "session-1");
			expect(mockAgent.prompt).toHaveBeenCalledWith(
				"What's going on with Acme?",
				"Current customer: acme. CSM: sarah.",
				"session-1",
			);
		});

		it("calls agent without customer context for unknown sender", async () => {
			await router.handleMessage(makeMessage());
			expect(mockAgent.prompt).toHaveBeenCalledWith(
				"What's going on with Acme?",
				"No customer context — this is a direct message from a CSM.",
				undefined,
			);
		});

		it("returns agent response text", async () => {
			const result = await router.handleMessage(makeMessage());
			expect(result).toBe("Agent response");
		});
	});
});
