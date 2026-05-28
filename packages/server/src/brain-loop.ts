import type { MemoryStore, CustomerProfile, ExtensionEvent } from "@cerebro-claw/shared";
import type { AgentRuntime } from "./agent-runtime.js";

export interface EventEmitter {
	emit<T = unknown>(event: ExtensionEvent, payload: T): Promise<void>;
}

export class BrainLoop {
	private store: MemoryStore;
	private agent: AgentRuntime;
	private intervalMs: number;
	private timer: ReturnType<typeof setInterval> | null = null;
	private running = false;
	private enabled: boolean;
	private emitter: EventEmitter | null;

	constructor(
		store: MemoryStore,
		agent: AgentRuntime,
		intervalMs: number,
		enabled = true,
		emitter: EventEmitter | null = null,
	) {
		this.store = store;
		this.agent = agent;
		this.intervalMs = intervalMs;
		this.enabled = enabled;
		this.emitter = emitter;
	}

	start(): void {
		if (!this.enabled) {
			console.log("[brain-loop] Disabled (no ANTHROPIC_API_KEY). Set it to enable proactive mode.");
			return;
		}
		if (this.timer) return;
		console.log(`[brain-loop] Starting — cycle every ${this.intervalMs / 1000}s`);
		this.timer = setInterval(() => this.cycle(), this.intervalMs);
		this.cycle();
	}

	stop(): void {
		if (this.timer) {
			clearInterval(this.timer);
			this.timer = null;
		}
		console.log("[brain-loop] Stopped");
	}

	async runDigest(): Promise<string> {
		const profiles = await this.store.listProfiles();
		if (profiles.length === 0) return "No customers yet.";

		const summaries = await Promise.all(
			profiles.map((p) => this.buildCustomerSummary(p)),
		);

		const prompt = `You are preparing a daily briefing for the CSM. Here are all their customers:

${summaries.join("\n\n---\n\n")}

Write a concise daily digest that:
1. Highlights what needs immediate attention (critical health, approaching renewals, usage drops)
2. Lists what's going well
3. Suggests 2-3 specific actions for today

Format it as a brief that a busy CSM can scan in 30 seconds. Use the tools to send the digest to the CSM or draft any urgent messages.`;

		const response = await this.agent.prompt(prompt, undefined, "brain:digest");
		return response.text;
	}

	private async cycle(): Promise<void> {
		if (this.running) {
			console.log("[brain-loop] Previous cycle still running, skipping");
			return;
		}

		this.running = true;
		console.log("[brain-loop] Cycle starting");
		await this.emitter?.emit("brain_loop_cycle_start", { ts: Date.now() });

		try {
			const profiles = await this.store.listProfiles();
			if (profiles.length === 0) {
				console.log("[brain-loop] No customers yet, nothing to do");
				return;
			}

			for (const profile of profiles) {
				await this.evaluateCustomer(profile.id, profile.companyName);
			}
		} catch (err) {
			console.error("[brain-loop] Cycle error:", err);
		} finally {
			this.running = false;
			console.log("[brain-loop] Cycle complete");
			await this.emitter?.emit("brain_loop_cycle_end", { ts: Date.now() });
		}
	}

	private async evaluateCustomer(customerId: string, companyName: string): Promise<void> {
		const profile = await this.store.getProfile(customerId);
		if (!profile) return;

		const summary = await this.buildCustomerSummary(profile);

		const prompt = `You are reviewing customer "${companyName}". Based on the context below, decide if any action is needed right now.

${summary}

If something needs attention, use the appropriate tools (send_message to alert the CSM, memory_update to update state, draft_message for customer-facing communication).

If everything looks fine, just say "No action needed for ${companyName}." and move on.`;

		try {
			const response = await this.agent.prompt(prompt, undefined, `brain:${customerId}`);
			if (response.toolCalls.length > 0) {
				console.log(
					`[brain-loop] ${companyName}: ${response.toolCalls.length} actions taken`,
				);
			}
		} catch (err) {
			console.error(`[brain-loop] Error evaluating ${companyName}:`, err);
		}
	}

	private async buildCustomerSummary(profile: CustomerProfile): Promise<string> {
		const state = await this.store.getState(profile.id);
		const recentHistory = await this.store.getHistory(profile.id, 10);
		const instincts = await this.store.getInstincts(profile.id);

		return [
			`Customer: ${profile.companyName} (${profile.id})`,
			`Plan: ${profile.plan ?? "N/A"}, Contract: $${profile.contractValue?.toLocaleString() ?? "N/A"}/yr`,
			state
				? `Health: ${state.health}, Open issues: ${state.openIssues}, Usage trend: ${state.usageTrend}, Last contact: ${state.lastContactDate.toISOString()}, Renewal: ${state.renewalDate?.toISOString() ?? "N/A"}`
				: "No state data yet.",
			recentHistory.length > 0
				? `Recent history:\n${recentHistory.map((h) => `- [${h.type}] ${h.summary}`).join("\n")}`
				: "No history yet.",
			instincts.length > 0
				? `CSM instinct notes:\n${instincts.map((i) => `- ${i.content}`).join("\n")}`
				: "No instinct notes.",
		].join("\n\n");
	}
}
