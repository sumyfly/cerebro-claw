import { describe, it, expect, beforeEach, vi } from "vitest";
import { ExtensionHost } from "../extension-host.js";
import { InMemoryStore } from "@cerebro-claw/memory";
import type {
	ChannelAdapter,
	ChannelMessageHandler,
	Extension,
	ToolDefinition,
} from "@cerebro-claw/shared";

function makeStore() {
	return new InMemoryStore();
}

function makeChannel(type: string): ChannelAdapter & { sent: { to: string; text: string }[] } {
	const sent: { to: string; text: string }[] = [];
	return {
		type,
		sent,
		async start(_handler: ChannelMessageHandler) {},
		async send(to, text) {
			sent.push({ to, text });
		},
	};
}

function makeTool(name: string): ToolDefinition {
	return {
		name,
		description: `tool ${name}`,
		parameters: { type: "object", properties: {} },
		async execute() {
			return { content: "ok", success: true };
		},
	};
}

describe("ExtensionHost", () => {
	let host: ExtensionHost;

	beforeEach(() => {
		host = new ExtensionHost({ store: makeStore(), config: {} });
	});

	it("loads extensions and runs their factory", async () => {
		const factory = vi.fn();
		const ext: Extension = { id: "test", factory };
		await host.load([ext]);
		expect(factory).toHaveBeenCalled();
		expect(host.getLoadedExtensions()).toContain("test");
	});

	it("aggregates tools from multiple extensions", async () => {
		await host.load([
			{ id: "a", factory: (api) => api.registerTool(makeTool("tool-a")) },
			{ id: "b", factory: (api) => api.registerTool(makeTool("tool-b")) },
		]);
		const tools = host.getTools();
		expect(tools.map((t) => t.name).sort()).toEqual(["tool-a", "tool-b"]);
	});

	it("aggregates channels from multiple extensions", async () => {
		await host.load([
			{ id: "lark", factory: (api) => api.registerChannel(makeChannel("lark")) },
			{ id: "email", factory: (api) => api.registerChannel(makeChannel("email")) },
		]);
		const channels = host.getChannels();
		expect(channels.map((c) => c.type).sort()).toEqual(["email", "lark"]);
	});

	it("getChannel finds by type", async () => {
		await host.load([
			{ id: "lark", factory: (api) => api.registerChannel(makeChannel("lark")) },
		]);
		expect(host.getChannel("lark")?.type).toBe("lark");
		expect(host.getChannel("missing")).toBeNull();
	});

	it("getChannelSender uses fallback when no type specified", async () => {
		await host.load([
			{ id: "lark", factory: (api) => api.registerChannel(makeChannel("lark")) },
		]);
		const sender = host.getChannelSender();
		expect(sender).not.toBeNull();
		await sender!.send("user-1", "hi");
	});

	it("getChannelSender returns null when no channels registered", () => {
		expect(host.getChannelSender()).toBeNull();
	});

	it("emit fires registered event handlers", async () => {
		const handler = vi.fn();
		await host.load([
			{ id: "t", factory: (api) => api.on("brain_loop_cycle_start", handler) },
		]);
		await host.emit("brain_loop_cycle_start", { ts: 1 });
		expect(handler).toHaveBeenCalledWith({ ts: 1 });
	});

	it("emit catches handler errors", async () => {
		await host.load([
			{
				id: "t",
				factory: (api) =>
					api.on("brain_loop_cycle_start", () => {
						throw new Error("boom");
					}),
			},
		]);
		// Should not throw
		await expect(host.emit("brain_loop_cycle_start", {})).resolves.toBeUndefined();
	});

	it("isolates extension failures", async () => {
		await host.load([
			{
				id: "broken",
				factory: () => {
					throw new Error("init failed");
				},
			},
			{ id: "good", factory: (api) => api.registerTool(makeTool("ok")) },
		]);
		expect(host.getLoadedExtensions()).toEqual(["good"]);
		expect(host.getTools()).toHaveLength(1);
	});

	it("shutdown stops all channels", async () => {
		const stopped: string[] = [];
		const channel: ChannelAdapter = {
			type: "test",
			async start() {},
			async send() {},
			async stop() {
				stopped.push("test");
			},
		};
		await host.load([{ id: "t", factory: (api) => api.registerChannel(channel) }]);
		await host.shutdown();
		expect(stopped).toEqual(["test"]);
	});

	it("provides extension API with store and config", async () => {
		let capturedStoreNull = true;
		let capturedConfig: Record<string, string> = {};
		await host.load([
			{
				id: "t",
				factory: (api) => {
					capturedStoreNull = api.getStore() === null;
					capturedConfig = api.getConfig();
				},
			},
		]);
		expect(capturedStoreNull).toBe(false);
		expect(capturedConfig).toBeDefined();
	});
});
