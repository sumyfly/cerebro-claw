import type { MemoryStore } from "@cerebro-claw/shared";
import type { AgentRuntime } from "./agent-runtime.js";

export class BrainLoop {
	private store: MemoryStore;
	private agent: AgentRuntime;
	private intervalMs: number;
	private timer: ReturnType<typeof setInterval> | null = null;
	private running = false;

	constructor(store: MemoryStore, agent: AgentRuntime, intervalMs: number) {
		this.store = store;
		this.agent = agent;
		this.intervalMs = intervalMs;
	}

	start(): void {
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

	private async cycle(): Promise<void> {
		if (this.running) {
			console.log("[brain-loop] Previous cycle still running, skipping");
			return;
		}

		this.running = true;
		console.log("[brain-loop] Cycle starting");

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
		}
	}

	private async evaluateCustomer(customerId: string, companyName: string): Promise<void> {
		const state = await this.store.getState(customerId);
		const recentHistory = await this.store.getHistory(customerId, 10);
		const instincts = await this.store.getInstincts(customerId);

		const context = [
			`Customer: ${companyName} (${customerId})`,
			state ? `Health: ${state.health}, Open issues: ${state.openIssues}, Usage trend: ${state.usageTrend}, Last contact: ${state.lastContactDate.toISOString()}, Renewal: ${state.renewalDate?.toISOString() ?? "N/A"}` : "No state data yet.",
			recentHistory.length > 0
				? `Recent history:\n${recentHistory.map((h) => `- [${h.type}] ${h.summary}`).join("\n")}`
				: "No history yet.",
			instincts.length > 0
				? `CSM instinct notes:\n${instincts.map((i) => `- ${i.content}`).join("\n")}`
				: "No instinct notes.",
		].join("\n\n");

		const prompt = `You are reviewing customer "${companyName}". Based on the context below, decide if any action is needed right now.

${context}

If something needs attention, use the appropriate tools (send_message to alert the CSM, memory_update to update state, draft_message for customer-facing communication).

If everything looks fine, just say "No action needed for ${companyName}." and move on.`;

		try {
			const response = await this.agent.prompt(prompt);
			if (response.toolCalls.length > 0) {
				console.log(
					`[brain-loop] ${companyName}: ${response.toolCalls.length} actions taken`,
				);
			}
		} catch (err) {
			console.error(`[brain-loop] Error evaluating ${companyName}:`, err);
		}
	}
}
