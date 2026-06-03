import type { InboundMessage, MemoryStore } from "@cerebro-claw/shared";
import type { AgentBackend } from "./agent-backend.js";

export interface SessionRoute {
	customerId: string;
	csmId: string;
}

export interface RouterOptions {
	/** Optional memory store, used to enrich the agent's context with the CSM's portfolio. */
	store?: MemoryStore;
}

export class Router {
	private routes = new Map<string, SessionRoute>();
	private agent: AgentBackend;
	private store: MemoryStore | undefined;

	constructor(agent: AgentBackend, options: RouterOptions = {}) {
		this.agent = agent;
		this.store = options.store;
	}

	addRoute(channelKey: string, route: SessionRoute): void {
		this.routes.set(channelKey, route);
	}

	resolve(message: InboundMessage): SessionRoute | null {
		const key = `${message.channelType}:${message.senderId}`;
		return (
			this.routes.get(key) ?? this.routes.get(`${message.channelType}:${message.channelId}`) ?? null
		);
	}

	async handleMessage(message: InboundMessage, sessionId?: string): Promise<string> {
		const route = this.resolve(message);
		const context = await this.buildContext(message, route);
		const response = await this.agent.prompt(message.text, context, sessionId);
		return response.text;
	}

	private async buildContext(message: InboundMessage, route: SessionRoute | null): Promise<string> {
		const parts: string[] = [];

		if (route) {
			parts.push(`Current customer: ${route.customerId}. CSM: ${route.csmId}.`);
		} else {
			parts.push(
				`Inbound channel: ${message.channelType}. Sender: ${message.senderId} (${message.senderName}).`,
			);
		}

		// Enrich with the CSM's portfolio so the agent can map names like "Acme"
		// to customer IDs without a separate lookup tool call.
		if (this.store) {
			try {
				const profiles = await this.store.listProfiles();
				const owned = profiles.filter((p) =>
					p.csmLarkUserId
						? p.csmLarkUserId === message.senderId
						: p.csmOwnerId === message.senderId,
				);
				const portfolio = owned.length > 0 ? owned : profiles;
				if (portfolio.length > 0) {
					const list = portfolio.map((p) => `- ${p.companyName} (id: ${p.id})`).join("\n");
					const label = owned.length > 0 ? "Your customers" : "Known customers";
					parts.push(`${label}:\n${list}`);
				}
			} catch (err) {
				console.error("[router] Failed to enrich context with portfolio:", err);
			}
		}

		return parts.join("\n\n");
	}
}
