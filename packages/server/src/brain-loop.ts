import type { ExtensionEvent, MemoryStore } from "@cerebro-claw/shared";
import { type AgentBackend, friendlyAnthropicError } from "./agent-runtime.js";
import { cspToSnapshot } from "./engine/csp-snapshot.js";
import { renderDecisionContext } from "./engine/decision-context.js";
import { parseOverrideBand } from "./engine/overrides.js";
import { type AccountSnapshot, computeSignals } from "./engine/signals.js";

export interface EventEmitter {
	emit<T = unknown>(event: ExtensionEvent, payload: T): Promise<void>;
}

/**
 * What the brain loop iterates over each cycle. Implementations decide where
 * accounts come from — the local SqliteStore (demo mode) or the live CSP
 * backend (production mode).
 */
export interface AccountSource {
	/** Short label for logs/banners. */
	label: string;
	/** List the accounts to evaluate this cycle. Should be cheap. */
	list(): Promise<{ id: string; companyName: string }[]>;
	/**
	 * Build the per-account context fed to the agent. Local source loads
	 * profile/state/history/instinct from SQLite. CSP source returns a
	 * pointer prompt that tells the agent to fetch live data via csp_* tools.
	 */
	buildSummary(id: string, companyName: string): Promise<string>;
}

/** Local store source: full context from SQLite, used in demo mode. */
export function createLocalAccountSource(
	store: MemoryStore,
): AccountSource & { _store: MemoryStore } {
	return {
		_store: store,
		label: "local SQLite",
		async list() {
			const profiles = await store.listProfiles();
			return profiles.map((p) => ({ id: p.id, companyName: p.companyName }));
		},
		async buildSummary(id, companyName) {
			const profile = await store.getProfile(id);
			if (!profile) return `Customer ${companyName} (${id}) — no profile data.`;
			const state = await store.getState(id);
			const recentHistory = await store.getHistory(id, 10);
			const instincts = await store.getInstincts(id);
			const ownership = profile.csmLarkUserId
				? `CSM owner: ${profile.csmOwnerId} (Lark recipient_id=${profile.csmLarkUserId}).`
				: `CSM owner: ${profile.csmOwnerId}. No Lark ID mapped.`;
			return [
				`Customer: ${profile.companyName} (${profile.id})`,
				`Plan: ${profile.plan ?? "N/A"}, Contract: $${profile.contractValue?.toLocaleString() ?? "N/A"}/yr`,
				ownership,
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
		},
	};
}

/**
 * CSP source: list comes from the live backend, summary is a pointer prompt
 * that tells the agent to fetch detail itself via csp_get_account /
 * csp_get_health_score / csp_get_engagement. This way the agent's tool calls
 * are the freshest possible data, and the brain loop stays thin.
 */
export interface CspAccountSourceOptions {
	baseUrl: string;
	token: string;
	csmEmail: string;
	timeoutMs?: number;
	maxAccounts?: number;
	/** Memory store — supplies instinct notes + stored overrides for the signals. */
	store?: MemoryStore;
	/** Clock override (tests). */
	now?: () => Date;
}

export function createCspAccountSource(opts: CspAccountSourceOptions): AccountSource {
	const baseUrl = opts.baseUrl.replace(/\/$/, "");
	const timeoutMs = opts.timeoutMs ?? 10_000;
	const max = opts.maxAccounts ?? 25;

	/** GET a CSP path, returning the parsed `.data` payload or null on any failure. */
	async function getData(path: string): Promise<Record<string, unknown> | undefined> {
		const ac = new AbortController();
		const t = setTimeout(() => ac.abort(), timeoutMs);
		try {
			const res = await fetch(`${baseUrl}${path}`, {
				headers: { Authorization: `Bearer ${opts.token}`, Accept: "application/json" },
				signal: ac.signal,
			});
			if (!res.ok) return undefined;
			const body = (await res.json()) as { data?: unknown };
			return body.data && typeof body.data === "object"
				? (body.data as Record<string, unknown>)
				: undefined;
		} catch {
			return undefined;
		} finally {
			clearTimeout(t);
		}
	}

	return {
		label: `CSP (${opts.csmEmail})`,
		async list() {
			const ac = new AbortController();
			const t = setTimeout(() => ac.abort(), timeoutMs);
			try {
				const qs = new URLSearchParams();
				qs.set("assignedCsmId", opts.csmEmail);
				qs.set("limit", String(max));
				const res = await fetch(`${baseUrl}/api/v1/accounts?${qs}`, {
					headers: {
						Authorization: `Bearer ${opts.token}`,
						Accept: "application/json",
					},
					signal: ac.signal,
				});
				if (!res.ok) {
					console.error(`[brain-loop] CSP list failed: HTTP ${res.status}`);
					return [];
				}
				const body = (await res.json()) as { data?: { id: string; name: string }[] };
				return (body.data ?? []).map((a) => ({ id: a.id, companyName: a.name }));
			} catch (err) {
				console.error(`[brain-loop] CSP list error: ${(err as Error).message}`);
				return [];
			} finally {
				clearTimeout(t);
			}
		},
		async buildSummary(id, companyName) {
			const pointer = [
				`You are reviewing customer "${companyName}" (CSP business id: ${id}).`,
				"",
				"The Decision signals above are computed from live CSP data + memory. You may also fetch fresh detail with csp_get_account, csp_get_health_score, csp_get_engagement, csp_get_notes, csp_get_renewals.",
				"",
				"Pick the right band and CALL ITS TOOL so the work is recorded:",
				"- act — reversible, low-stakes, fact-based (log + watch). Don't escalate routine observations.",
				"- notify_then_send_to_customer — routine customer-facing touch (heads-up to CSM first).",
				"- escalate — genuinely high-stakes/irreversible/ambiguous; brief the CSM with situation + options + recommendation.",
				"- prep — finished v1 artifact for a CSM-owned conversation.",
				"",
				"If nothing needs doing, do not call any tool — just say so. Don't draft and wait — that's the bug, not the feature.",
			].join("\n");

			// Compute the decision signals server-side and inject them so the agent
			// reasons with structured inputs (health/usage/renewal/override/change),
			// not just raw text. Degrade gracefully to the pointer prompt on failure.
			try {
				const [account, health, engagement] = await Promise.all([
					getData(`/api/v1/accounts/${id}`),
					getData(`/api/v1/accounts/${id}/health-score`),
					getData(`/api/v1/accounts/${id}/engagement`),
				]);
				const instinctEntries = opts.store ? await opts.store.getInstincts(id) : [];
				const instincts = instinctEntries.map((i) => i.content);
				const overrideBand = parseOverrideBand(instincts);
				const last = opts.store ? await opts.store.getLastDecision(id) : null;
				const now = (opts.now ?? (() => new Date()))();
				// Map the REAL CSP shapes into the engine snapshot, then layer in
				// agent-private memory (instincts, overrides, last decision).
				const snapshot: AccountSnapshot = {
					...cspToSnapshot({ account, health, engagement }, now),
					instincts,
					overrides: overrideBand ? [{ rule: "stored override", forcesBand: overrideBand }] : [],
					lastDecision: last
						? { signalFingerprint: last.signalFingerprint, band: last.band, reason: last.reason }
						: undefined,
				};
				const signals = computeSignals(snapshot);
				// Persist this cycle's signal fingerprint so next cycle can detect
				// whether anything material changed (cross-cycle dedup). Band carries
				// the last known decision; it's informational — the fingerprint is
				// what drives change detection.
				if (opts.store) {
					await opts.store.recordDecision({
						customerId: id,
						signalFingerprint: signals.signalFingerprint,
						band: last?.band ?? "reviewed",
						reason: "auto: brain-loop signal snapshot",
						ts: now,
					});
				}
				const context = renderDecisionContext(signals, instincts);
				return `${context}\n\n${pointer}`;
			} catch (err) {
				console.error(
					`[brain-loop] signal computation failed for ${companyName}: ${(err as Error).message}`,
				);
				return pointer;
			}
		},
	};
}

export class BrainLoop {
	private store: MemoryStore;
	private agent: AgentBackend;
	private intervalMs: number;
	private timer: ReturnType<typeof setInterval> | null = null;
	private running = false;
	private enabled: boolean;
	private emitter: EventEmitter | null;
	private source: AccountSource;

	constructor(
		store: MemoryStore,
		agent: AgentBackend,
		intervalMs: number,
		enabled = true,
		emitter: EventEmitter | null = null,
		source?: AccountSource,
	) {
		this.store = store;
		this.agent = agent;
		this.intervalMs = intervalMs;
		this.enabled = enabled;
		this.emitter = emitter;
		this.source = source ?? createLocalAccountSource(store);
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
		const accounts = await this.source.list();
		if (accounts.length === 0) return "No customers yet.";

		const summaries = await Promise.all(
			accounts.map((a) => this.source.buildSummary(a.id, a.companyName)),
		);

		const prompt = `You are preparing the daily digest for the CSM. Their accounts:

${summaries.join("\n\n---\n\n")}

Produce the headline in exactly this format, filling in real counts from today's ledger:
"Yesterday: N acts, M notifies in-flight, K escalations need you."

Then list:
1. Escalations needing the CSM (≤5). Each: customer, situation in one line, your recommendation.
2. Top notifies in flight (≤5).
3. What's going well — one line.

Be terse. The CSM scans this in 30 seconds. If you need to take additional action while writing the digest, use the matching action-policy tool (act / notify_then_send_to_customer / escalate / prep). Do not draft messages and wait.`;

		const response = await this.agent.prompt(prompt, undefined, "brain:digest");
		return response.text;
	}

	private async cycle(): Promise<void> {
		if (this.running) {
			console.log("[brain-loop] Previous cycle still running, skipping");
			return;
		}

		this.running = true;
		console.log(`[brain-loop] Cycle starting — source: ${this.source.label}`);
		await this.emitter?.emit("brain_loop_cycle_start", { ts: Date.now() });

		try {
			const accounts = await this.source.list();
			if (accounts.length === 0) {
				console.log("[brain-loop] No customers from source, nothing to do");
				return;
			}

			for (const a of accounts) {
				await this.evaluateCustomer(a.id, a.companyName);
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
		const summary = await this.source.buildSummary(customerId, companyName);

		const prompt = `You are reviewing customer "${companyName}". Decide if any action is needed right now.

${summary}

Pick the right band from the action policy:
- act — log something you noticed (csp_create_note for team-visible, memory_instinct for agent-private).
- notify_then_send_to_customer — routine customer-facing touch (heads-up to CSM, dispatched after pause window).
- escalate — high-stakes or ambiguous (brief CSM with options + recommendation).
- prep — finished v1 artifact for a CSM-owned conversation.

If nothing needs doing, say "No action needed for ${companyName}." and move on.`;

		try {
			const response = await this.agent.prompt(prompt, undefined, `brain:${customerId}`);
			if (response.toolCalls.length > 0) {
				console.log(`[brain-loop] ${companyName}: ${response.toolCalls.length} actions taken`);
			}
		} catch (err) {
			console.error(`[brain-loop] Error evaluating ${companyName}: ${friendlyAnthropicError(err)}`);
		}
	}
}
