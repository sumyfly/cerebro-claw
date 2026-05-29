import { describe, it, expect, vi } from "vitest";
import { createMessageTools } from "../message-tools.js";
import type { PendingAction, ToolDefinition } from "@cerebro-claw/shared";

describe("draft_message → onActionCreated", () => {
	it("fires the hook with the created action", async () => {
		const pendingActions = new Map<string, PendingAction>();
		const onActionCreated = vi.fn();
		const tools = createMessageTools({
			pendingActions,
			sendToChannel: vi.fn().mockResolvedValue(undefined),
			onActionCreated,
		});
		const draft = tools.find((t) => t.name === "draft_message") as ToolDefinition;

		await draft.execute({
			customer_id: "acme",
			recipient_id: "user-1",
			text: "Hi there",
			description: "Check-in",
		});

		expect(onActionCreated).toHaveBeenCalledTimes(1);
		const action = onActionCreated.mock.calls[0][0] as PendingAction;
		expect(action.customerId).toBe("acme");
		expect(action.draft?.text).toBe("Hi there");
		expect(action.status).toBe("pending");
	});

	it("isolates hook errors so the draft still succeeds", async () => {
		const pendingActions = new Map<string, PendingAction>();
		const tools = createMessageTools({
			pendingActions,
			sendToChannel: vi.fn().mockResolvedValue(undefined),
			onActionCreated: async () => {
				throw new Error("hook boom");
			},
		});
		const draft = tools.find((t) => t.name === "draft_message") as ToolDefinition;

		const result = await draft.execute({
			customer_id: "acme",
			recipient_id: "user-1",
			text: "Hi",
			description: "Check-in",
		});
		expect(result.success).toBe(true);
		expect(pendingActions.size).toBe(1);
	});

	it("works without a hook", async () => {
		const pendingActions = new Map<string, PendingAction>();
		const tools = createMessageTools({
			pendingActions,
			sendToChannel: vi.fn().mockResolvedValue(undefined),
		});
		const draft = tools.find((t) => t.name === "draft_message") as ToolDefinition;

		const result = await draft.execute({
			customer_id: "acme",
			recipient_id: "user-1",
			text: "Hi",
			description: "Check-in",
		});
		expect(result.success).toBe(true);
	});
});
