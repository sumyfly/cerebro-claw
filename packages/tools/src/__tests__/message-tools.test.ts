import { describe, it, expect, beforeEach, vi } from "vitest";
import { createMessageTools } from "../message-tools.js";
import type { PendingAction, ToolDefinition } from "@cerebro-claw/shared";

describe("message tools", () => {
	let tools: ToolDefinition[];
	let toolMap: Map<string, ToolDefinition>;
	let pendingActions: Map<string, PendingAction>;
	let sendToChannel: ReturnType<typeof vi.fn>;

	beforeEach(() => {
		pendingActions = new Map();
		sendToChannel = vi.fn().mockResolvedValue(undefined);
		tools = createMessageTools({ pendingActions, sendToChannel });
		toolMap = new Map(tools.map((t) => [t.name, t]));
	});

	it("registers 2 tools", () => {
		expect(tools).toHaveLength(2);
		expect(toolMap.has("draft_message")).toBe(true);
		expect(toolMap.has("send_message")).toBe(true);
	});

	describe("draft_message", () => {
		it("creates a pending action", async () => {
			const result = await toolMap.get("draft_message")!.execute({
				customer_id: "acme",
				recipient_id: "john@acme.com",
				text: "Hi John, checking in on your experience.",
				description: "Proactive check-in after usage drop",
			});
			expect(result.success).toBe(true);
			expect(pendingActions.size).toBe(1);
			const action = Array.from(pendingActions.values())[0];
			expect(action.status).toBe("pending");
			expect(action.type).toBe("send_message");
			expect(action.draft?.text).toContain("checking in");
		});
	});

	describe("send_message", () => {
		it("sends directly to channel", async () => {
			const result = await toolMap.get("send_message")!.execute({
				recipient_id: "sarah",
				text: "Acme usage dropped 30%",
			});
			expect(result.success).toBe(true);
			expect(sendToChannel).toHaveBeenCalledWith("default", "sarah", "Acme usage dropped 30%");
		});
	});
});
