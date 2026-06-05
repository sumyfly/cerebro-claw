import type {
	ActionLedger,
	ExtensionEvent,
	MemoryStore,
	RenewalSource,
	SituationStore,
	TaskSource,
} from "@cerebro-claw/shared";
import type { AgentBackend } from "./agent-backend.js";
import { cspToSnapshot, deriveHealthTrend } from "./engine/csp-snapshot.js";
import { renderDecisionContext, renderSituations } from "./engine/decision-context.js";
import { parseOverrideBand } from "./engine/overrides.js";
import { renderRenewalContext } from "./engine/renewal-context.js";
import { type AccountSnapshot, computeSignals } from "./engine/signals.js";
import { renderTaskContext } from "./engine/task-context.js";
import { BAND_GUIDANCE, RENEWAL_GUIDANCE, TASK_GUIDANCE, reviewPointer } from "./review-prompt.js";

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
	 * Build the per-account context fed to the agent. MUST be side-effect free —
	 * it may run several times per account within a cycle. Persisting state here
	 * would corrupt change-detection; record that in `onEvaluated` instead.
	 */
	buildSummary(id: string, companyName: string): Promise<string>;
	/**
	 * Called once, after the agent has actually reviewed an account in a cycle.
	 * The CSP source persists this cycle's signal fingerprint here (not in
	 * buildSummary) so cross-cycle change-detection sees exactly one snapshot per
	 * cycle. Optional — the local source has nothing to persist.
	 */
	onEvaluated?(id: string): Promise<void>;
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
	/** Situation store — supplies open storylines so the agent advances, not re-discovers. */
	situationStore?: SituationStore;
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

	// Cache the fingerprint computed in buildSummary so onEvaluated can persist
	// it exactly once per cycle (buildSummary itself must stay side-effect free).
	const pendingSnapshot = new Map<string, { signalFingerprint: string; healthScore?: number }>();

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
					console.error(`[work-loop] CSP list failed: HTTP ${res.status}`);
					return [];
				}
				const body = (await res.json()) as { data?: { id: string; name: string }[] };
				return (body.data ?? []).map((a) => ({ id: a.id, companyName: a.name }));
			} catch (err) {
				console.error(`[work-loop] CSP list error: ${(err as Error).message}`);
				return [];
			} finally {
				clearTimeout(t);
			}
		},
		async buildSummary(id, companyName) {
			const pointer = reviewPointer(companyName, id);

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
				const mapped = cspToSnapshot({ account, health, engagement }, now);
				// Derive the health TREND from last cycle's score (CSP has no trend field).
				const healthTrend = deriveHealthTrend(mapped.healthScore?.overallScore, last?.healthScore);
				const snapshot: AccountSnapshot = {
					...mapped,
					healthScore: mapped.healthScore
						? { ...mapped.healthScore, trend: healthTrend }
						: mapped.healthScore,
					instincts,
					overrides: overrideBand ? [{ rule: "stored override", forcesBand: overrideBand }] : [],
					lastDecision: last
						? { signalFingerprint: last.signalFingerprint, band: last.band, reason: last.reason }
						: undefined,
				};
				const signals = computeSignals(snapshot);
				// Stash this cycle's fingerprint; onEvaluated persists it ONCE after
				// the agent reviews. Recording here would corrupt change-detection,
				// since buildSummary may run several times per cycle.
				pendingSnapshot.set(id, {
					signalFingerprint: signals.signalFingerprint,
					healthScore: mapped.healthScore?.overallScore,
				});
				const context = renderDecisionContext(signals, instincts);
				const situations = opts.situationStore ? await opts.situationStore.listOpen(id) : [];
				const situationBlock = renderSituations(situations, now);
				return `${context}\n\n${situationBlock}\n\n${pointer}`;
			} catch (err) {
				console.error(
					`[work-loop] signal computation failed for ${companyName}: ${(err as Error).message}`,
				);
				return pointer;
			}
		},
		async onEvaluated(id) {
			const snap = pendingSnapshot.get(id);
			if (!snap || !opts.store) return;
			pendingSnapshot.delete(id);
			const prior = await opts.store.getLastDecision(id);
			// Record exactly one snapshot per cycle for cross-cycle change detection.
			// Band is carried from the prior decision (informational); the fingerprint
			// is what drives dedup. The ledger holds the band the agent actually fired.
			await opts.store.recordDecision({
				customerId: id,
				signalFingerprint: snap.signalFingerprint,
				band: prior?.band ?? "reviewed",
				reason: "auto: brain-loop signal snapshot",
				ts: (opts.now ?? (() => new Date()))(),
				healthScore: snap.healthScore,
			});
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
	private taskSource: TaskSource | null;
	private ledger: ActionLedger | null;
	private renewalSource: RenewalSource | null;
	private situationStore: SituationStore | null;

	constructor(
		store: MemoryStore,
		agent: AgentBackend,
		intervalMs: number,
		enabled = true,
		emitter: EventEmitter | null = null,
		source?: AccountSource,
		taskSource: TaskSource | null = null,
		ledger: ActionLedger | null = null,
		renewalSource: RenewalSource | null = null,
		situationStore: SituationStore | null = null,
	) {
		this.store = store;
		this.agent = agent;
		this.intervalMs = intervalMs;
		this.enabled = enabled;
		this.emitter = emitter;
		this.source = source ?? createLocalAccountSource(store);
		this.taskSource = taskSource;
		this.ledger = ledger;
		this.renewalSource = renewalSource;
		this.situationStore = situationStore;
	}

	start(): void {
		if (!this.enabled) {
			console.log("[work-loop] Disabled.");
			return;
		}
		if (this.timer) return;
		console.log(`[work-loop] Starting — cycle every ${this.intervalMs / 1000}s`);
		this.timer = setInterval(() => this.cycle(), this.intervalMs);
		this.cycle();
	}

	stop(): void {
		if (this.timer) {
			clearInterval(this.timer);
			this.timer = null;
		}
		console.log("[work-loop] Stopped");
	}

	private async cycle(): Promise<void> {
		if (this.running) {
			console.log("[work-loop] Previous cycle still running, skipping");
			return;
		}

		this.running = true;
		console.log(`[work-loop] Cycle starting — source: ${this.source.label}`);
		await this.emitter?.emit("brain_loop_cycle_start", { ts: Date.now() });

		try {
			// 1) Accounts — the change-detection sweep over the CSM's portfolio.
			const accounts = await this.source.list();
			if (accounts.length === 0) {
				console.log("[work-loop] No customers from source");
			}
			for (const a of accounts) {
				await this.evaluateCustomer(a.id, a.companyName);
			}

			// 2) Tasks — the CSM's actual work queue. Independent of accounts: an
			// empty portfolio must not stop task work, and vice versa.
			await this.cycleTasks();

			// 3) Renewals — the highest-value, time-sensitive work, swept directly.
			// Independent of accounts and tasks.
			await this.cycleRenewals();

			if (accounts.length === 0 && !this.taskSource && !this.renewalSource) {
				console.log("[work-loop] Nothing to do this cycle");
			}
		} catch (err) {
			console.error("[work-loop] Cycle error:", err);
		} finally {
			this.running = false;
			console.log("[work-loop] Cycle complete");
			await this.emitter?.emit("brain_loop_cycle_end", { ts: Date.now() });
		}
	}

	/**
	 * Iterate the CSM's open tasks and work each one. Tasks that already have an
	 * open action in the ledger (a needs-csm escalation or an in-flight notify
	 * tagged with the task id) are skipped — they're mid-flight, re-actioning
	 * them would double-fire. This is the ledger task-id link doing dedup.
	 */
	private async cycleTasks(): Promise<void> {
		if (!this.taskSource) return;
		let tasks: Awaited<ReturnType<TaskSource["listOpen"]>>;
		try {
			tasks = await this.taskSource.listOpen();
		} catch (err) {
			console.error(`[work-loop] Task list error: ${(err as Error).message}`);
			return;
		}
		if (tasks.length === 0) {
			console.log("[work-loop] No open tasks");
			return;
		}

		const inFlight = await this.tasksWithOpenActions();
		let skipped = 0;
		for (const task of tasks) {
			if (inFlight.has(task.id)) {
				skipped += 1;
				continue;
			}
			await this.evaluateTask(task);
		}
		console.log(
			`[work-loop] Tasks: ${tasks.length - skipped} evaluated, ${skipped} skipped (mid-flight)`,
		);
	}

	/** Task ids that already have an open (in-flight / needs-csm) ledger action. */
	private async tasksWithOpenActions(): Promise<Set<string>> {
		const ids = new Set<string>();
		if (!this.ledger) return ids;
		try {
			for (const entry of await this.ledger.listOpen()) {
				const taskId = (entry.payload as { taskId?: unknown } | undefined)?.taskId;
				if (typeof taskId === "string") ids.add(taskId);
			}
		} catch (err) {
			console.error(`[work-loop] Ledger dedup scan failed: ${(err as Error).message}`);
		}
		return ids;
	}

	private async evaluateTask(task: { id: string; title: string }): Promise<void> {
		const full = (await this.taskSource?.getContext(task.id)) ?? null;
		const context = full
			? renderTaskContext(full)
			: `# Cerebro task\n- ${task.title} (id: ${task.id})`;

		const prompt = `You have a task to work from the CSM's Cerebro queue.

${context}

${TASK_GUIDANCE}`;

		try {
			const response = await this.agent.prompt(prompt, undefined, `brain:task:${task.id}`);
			if (response.toolCalls.length > 0) {
				console.log(`[work-loop] task ${task.id}: ${response.toolCalls.length} actions taken`);
			}
		} catch (err) {
			const detail = err instanceof Error ? err.message : String(err);
			console.error(`[work-loop] Error evaluating task ${task.id}: ${detail}`);
		}
	}

	/**
	 * Renewal sweep — iterate the CSM's open (upcoming/at-risk) renewals and work
	 * each on its timeline. Independent of the account and task sweeps. Each
	 * renewal converges on the single per-renewalId `renewal-risk` Situation.
	 */
	private async cycleRenewals(): Promise<void> {
		if (!this.renewalSource) return;
		let renewals: Awaited<ReturnType<RenewalSource["listOpen"]>>;
		try {
			renewals = await this.renewalSource.listOpen();
		} catch (err) {
			console.error(`[work-loop] Renewal list error: ${(err as Error).message}`);
			return;
		}
		if (renewals.length === 0) {
			console.log("[work-loop] No open renewals");
			return;
		}
		for (const renewal of renewals) {
			await this.evaluateRenewal(renewal.id);
		}
		console.log(`[work-loop] Renewals: ${renewals.length} evaluated`);
	}

	private async evaluateRenewal(id: string): Promise<void> {
		const full = (await this.renewalSource?.getContext(id)) ?? null;
		if (!full) {
			console.error(`[work-loop] Renewal ${id} has no context — skipping`);
			return;
		}
		const renewalContext = renderRenewalContext(full);
		// Inject the account's open situations so the agent advances the renewal's
		// storyline instead of re-discovering it (convergence by renewalId).
		const situations = this.situationStore
			? await this.situationStore.listOpen(full.businessId)
			: [];
		const situationBlock = renderSituations(situations, new Date());

		const prompt = `You have a renewal to work from the CSM's portfolio.

${renewalContext}

${situationBlock}

${RENEWAL_GUIDANCE}`;

		try {
			const response = await this.agent.prompt(prompt, undefined, `brain:renewal:${id}`);
			if (response.toolCalls.length > 0) {
				console.log(`[work-loop] renewal ${id}: ${response.toolCalls.length} actions taken`);
			}
		} catch (err) {
			const detail = err instanceof Error ? err.message : String(err);
			console.error(`[work-loop] Error evaluating renewal ${id}: ${detail}`);
		}
	}

	private async evaluateCustomer(customerId: string, companyName: string): Promise<void> {
		const summary = await this.source.buildSummary(customerId, companyName);

		const prompt = `You are reviewing customer "${companyName}". Decide if any action is needed right now.

${summary}

${BAND_GUIDANCE}

If nothing needs doing, say "No action needed for ${companyName}." and move on.`;

		try {
			const response = await this.agent.prompt(prompt, undefined, `brain:${customerId}`);
			if (response.toolCalls.length > 0) {
				console.log(`[work-loop] ${companyName}: ${response.toolCalls.length} actions taken`);
			}
		} catch (err) {
			const detail = err instanceof Error ? err.message : String(err);
			console.error(`[work-loop] Error evaluating ${companyName}: ${detail}`);
		} finally {
			// Persist this cycle's signal snapshot exactly once, after the review —
			// never from buildSummary (which may run several times per cycle).
			await this.source.onEvaluated?.(customerId);
		}
	}
}
