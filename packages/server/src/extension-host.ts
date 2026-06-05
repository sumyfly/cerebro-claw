import {
	type ActionBandDef,
	type ChannelAdapter,
	DEFAULT_BANDS,
	type EventHandler,
	type Extension,
	type ExtensionAPI,
	type ExtensionEvent,
	type MemoryStore,
	type ToolDefinition,
} from "@cerebro-claw/shared";

export interface ExtensionHostContext {
	store: MemoryStore;
	config: Record<string, string>;
}

export interface ChannelSender {
	send(recipientId: string, text: string): Promise<void>;
	sendCard?(recipientId: string, card: unknown): Promise<void>;
}

export class ExtensionHost {
	private tools: ToolDefinition[] = [];
	private channels: ChannelAdapter[] = [];
	private handlers = new Map<ExtensionEvent, EventHandler[]>();
	private ctx: ExtensionHostContext;
	private loaded: string[] = [];
	/** The action policy as a registered set — seeded with the default four bands. */
	private bands: ActionBandDef[] = [...DEFAULT_BANDS];

	constructor(ctx: ExtensionHostContext) {
		this.ctx = ctx;
	}

	async load(extensions: Extension[]): Promise<void> {
		for (const ext of extensions) {
			const api: ExtensionAPI = {
				extensionId: ext.id,
				registerTool: (tool) => this.tools.push(tool),
				registerChannel: (channel) => this.channels.push(channel),
				registerBand: (band) => {
					if (!this.bands.some((b) => b.id === band.id)) this.bands.push(band);
				},
				on: (event, handler) => {
					const arr = this.handlers.get(event) ?? [];
					arr.push(handler);
					this.handlers.set(event, arr);
				},
				getStore: () => this.ctx.store,
				getConfig: () => this.ctx.config,
			};

			try {
				await ext.factory(api);
				this.loaded.push(ext.id);
				console.log(`[extensions] Loaded: ${ext.id}`);
			} catch (err) {
				console.error(`[extensions] Failed to load ${ext.id}:`, err);
			}
		}
	}

	getTools(): ToolDefinition[] {
		return this.tools;
	}

	/** The action policy as an enumerable set — default four bands plus any registered. */
	getBands(): ActionBandDef[] {
		return [...this.bands];
	}

	getChannels(): ChannelAdapter[] {
		return this.channels;
	}

	getChannel(type: string): ChannelAdapter | null {
		return this.channels.find((c) => c.type === type) ?? null;
	}

	/**
	 * Get a sender for a channel by type, with fallback to the first registered channel.
	 * Returns null if no channels are registered.
	 */
	getChannelSender(type?: string): ChannelSender | null {
		const channel = type ? this.getChannel(type) : this.channels[0];
		if (!channel) return null;
		return {
			send: (recipientId, text) => channel.send(recipientId, text),
			sendCard: channel.sendCard
				? // biome-ignore lint/style/noNonNullAssertion: guarded by the ternary above
					(recipientId, card) => channel.sendCard!(recipientId, card)
				: undefined,
		};
	}

	getLoadedExtensions(): string[] {
		return [...this.loaded];
	}

	async emit<T = unknown>(event: ExtensionEvent, payload: T): Promise<void> {
		const handlers = this.handlers.get(event) ?? [];
		for (const handler of handlers) {
			try {
				await handler(payload);
			} catch (err) {
				console.error(`[extensions] Event handler error (${event}):`, err);
			}
		}
	}

	async shutdown(): Promise<void> {
		await this.emit("shutdown", undefined);
		for (const channel of this.channels) {
			if (channel.stop) {
				try {
					await channel.stop();
				} catch (err) {
					console.error(`[extensions] Channel ${channel.type} stop error:`, err);
				}
			}
		}
	}
}
