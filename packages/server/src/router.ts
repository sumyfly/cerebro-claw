import type { InboundMessage } from "@cerebro-claw/shared";
import type { AgentBackend } from "./agent-runtime.js";

export interface SessionRoute {
	customerId: string;
	csmId: string;
}

export class Router {
	private routes = new Map<string, SessionRoute>();
	private agent: AgentBackend;

	constructor(agent: AgentBackend) {
		this.agent = agent;
	}

	addRoute(channelKey: string, route: SessionRoute): void {
		this.routes.set(channelKey, route);
	}

	resolve(message: InboundMessage): SessionRoute | null {
		const key = `${message.channelType}:${message.senderId}`;
		return this.routes.get(key) ?? this.routes.get(`${message.channelType}:${message.channelId}`) ?? null;
	}

	async handleMessage(message: InboundMessage, sessionId?: string): Promise<string> {
		const route = this.resolve(message);

		const context = route
			? `Current customer: ${route.customerId}. CSM: ${route.csmId}.`
			: "No customer context — this is a direct message from a CSM.";

		const response = await this.agent.prompt(message.text, context, sessionId);
		return response.text;
	}
}
