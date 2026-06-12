import type {
	ActionLedger,
	ExtensionEvent,
	MemoryStore,
	RenewalSource,
	SituationStore,
	TaskSource,
} from "@cerebro-claw/shared";
import type { AgentBackend } from "./agent-backend.js";
import { mapWithConcurrency } from "./engine/concurrency.js";
import { cspToSnapshot, deriveHealthTrend } from "./engine/csp-snapshot.js";
import {
	renderDecisionContext,
	renderRecentActions,
	renderSituations,
} from "./engine/decision-context.js";
import { parseOverrideBand } from "./engine/overrides.js";
import { renderRenewalContext } from "./engine/renewal-context.js";
import { type AccountSnapshot, computeSignals } from "./engine/signals.js";
import { renderTaskContext } from "./engine/task-context.js";
import {
	type TriageInput,
	type TriageScore,
	computeTriageScore,
	selectByTriage,
} from "./engine/triage.js";
import { BAND_GUIDANCE, RENEWAL_GUIDANCE, TASK_GUIDANCE, reviewPointer } from "./review-prompt.js";

export interface EventEmitter {
	emit<T = unknown>(event: ExtensionEvent, payload: T): Promise<void>;
}

/** Per-sweep tally: how many subjects were worked vs. how many were eligible. */
export interface SweepCount {
	evaluated: number;
	available: number;
}

/** What one cycle did — returned by `runCycle`/`runOnce`. */
export interface CycleSummary {
	/** Always true here; the busy path returns `{ ran: false, reason }` instead. */
	ran: true;
	/** Effective per-sweep fan-out cap for this run (0 = no cap). */
	limit: number;
	accounts: SweepCount;
	tasks: SweepCount;
	renewals: SweepCount;
	actionsTaken: number;
	durationMs: number;
}

/**
 * The cheap pre-review computation for one account: the real triage inputs
 * plus everything the skip gate needs to decide whether an agent turn is
 * warranted at all. Produced by `AccountSource.prepare` — no LLM involved.
 */
export interface AccountReviewPlan {
	/** Real triage inputs (health, trend, renewal, value, override). */
	triage: TriageInput;
	/** First look, or the signal fingerprint moved since the last review. */
	changedSinceLastCycle: boolean;
	/** Open Situations always bypass the skip gate (a storyline is in flight). */
	hasOpenSituations: boolean;
	/** Days to the soonest open renewal (negative = overdue, null = none known). */
	daysToRenewal: number | null;
	/** When the agent last actually reviewed this account (null = never). */
	lastReviewedAt: Date | null;
}

/** Skip-gate knobs — what lets an unchanged account skip its agent turn. */
export interface AccountGateOptions {
	/** Gate on/off. Off = every listed account is eligible (legacy behavior). */
	enabled: boolean;
	/** A renewal within this many days always bypasses the gate. */
	renewalHorizonDays: number;
	/** Force a review after this many days skipped, even if unchanged. */
	maxSkipAgeDays: number;
}

export const DEFAULT_GATE: AccountGateOptions = {
	enabled: true,
	renewalHorizonDays: 90,
	maxSkipAgeDays: 7,
};

/** Concurrency cap for the cheap per-account CSP GETs in the prepare fan-out. */
const PREPARE_CONCURRENCY = 4;

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
	 * Cheap pre-review pass: compute the signals/fingerprint and return the
	 * review plan the skip gate + triage rank on. MUST be side-effect free.
	 * Optional — sources without signals (local demo) skip the gate entirely.
	 * Return null on failure; the loop then treats the account as must-review.
	 */
	prepare?(id: string, companyName: string): Promise<AccountReviewPlan | null>;
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
export function createLocalAccountSource(store: MemoryStore): AccountSource {
	return {
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
	/** Action ledger — supplies the account's recent actions for the closed loop. */
	ledger?: ActionLedger;
	/** How many recent ledger entries to inject per account (default 5). */
	recentActionsLimit?: number;
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

	// Cache the fingerprint computed during the review pass so onEvaluated can
	// persist it exactly once per cycle (prepare/buildSummary stay side-effect free).
	const pendingSnapshot = new Map<string, { signalFingerprint: string; healthScore?: number }>();
	// Per-cycle cache so prepare() and buildSummary() share one CSP fetch — the
	// prepare fan-out already computed everything the summary needs.
	const prepared = new Map<string, { summary: string; plan: AccountReviewPlan }>();

	/** One full signal computation for an account: rendered summary + review plan. */
	async function compute(
		id: string,
		companyName: string,
	): Promise<{ summary: string; plan: AccountReviewPlan }> {
		const pointer = reviewPointer(companyName, id);
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
		// since prepare/buildSummary may run several times per cycle.
		pendingSnapshot.set(id, {
			signalFingerprint: signals.signalFingerprint,
			healthScore: mapped.healthScore?.overallScore,
		});
		const context = renderDecisionContext(signals, instincts);
		const situations = opts.situationStore ? await opts.situationStore.listOpen(id) : [];
		const situationBlock = renderSituations(situations, now);
		// Closed loop: the agent sees its own recent actions and their outcomes.
		const recent = opts.ledger
			? await opts.ledger.listRecentByCustomer(id, opts.recentActionsLimit ?? 5)
			: [];
		const recentBlock = renderRecentActions(recent, now);
		const summary = [context, situationBlock, recentBlock, pointer].filter(Boolean).join("\n\n");
		const plan: AccountReviewPlan = {
			triage: {
				healthScore: signals.healthScore ?? undefined,
				healthGrade: signals.healthGrade ?? undefined,
				healthTrend: (signals.healthTrend as TriageInput["healthTrend"]) ?? undefined,
				usageTrend: (signals.usageTrend as TriageInput["usageTrend"]) ?? undefined,
				contractValue: signals.contractValue ?? undefined,
				daysToRenewal: signals.daysToRenewal ?? undefined,
				overrideForcesBand: signals.overrideForcesBand ?? undefined,
			},
			changedSinceLastCycle: signals.changedSinceLastCycle,
			hasOpenSituations: situations.length > 0,
			daysToRenewal: signals.daysToRenewal,
			lastReviewedAt: last?.ts ?? null,
		};
		return { summary, plan };
	}

	return {
		label: `CSP (${opts.csmEmail})`,
		async list() {
			const ac = new AbortController();
			const t = setTimeout(() => ac.abort(), timeoutMs);
			// New cycle: drop every cached computation from the previous one. This
			// bounds both maps to one cycle's accounts and guarantees no stale
			// summary or fingerprint can outlive the cycle that computed it
			// (skipped/deferred accounts never reach onEvaluated's per-id delete).
			prepared.clear();
			pendingSnapshot.clear();
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
		async prepare(id, companyName) {
			// Evict any earlier result FIRST so a failed compute can never leave a
			// stale summary/fingerprint behind for buildSummary/onEvaluated to use.
			prepared.delete(id);
			pendingSnapshot.delete(id);
			try {
				const result = await compute(id, companyName);
				prepared.set(id, result);
				return result.plan;
			} catch (err) {
				console.error(`[work-loop] prepare failed for ${companyName}: ${(err as Error).message}`);
				return null; // caller treats as must-review
			}
		},
		async buildSummary(id, companyName) {
			// The prepare fan-out usually computed this already — reuse its fetch.
			const cached = prepared.get(id);
			if (cached) return cached.summary;
			// Compute the decision signals server-side and inject them so the agent
			// reasons with structured inputs (health/usage/renewal/override/change),
			// not just raw text. Degrade gracefully to the pointer prompt on failure.
			try {
				return (await compute(id, companyName)).summary;
			} catch (err) {
				console.error(
					`[work-loop] signal computation failed for ${companyName}: ${(err as Error).message}`,
				);
				return reviewPointer(companyName, id);
			}
		},
		async onEvaluated(id) {
			prepared.delete(id);
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
	private triageMax: number;
	private triageMinScore: number;
	private runOnStart: boolean;
	private gate: AccountGateOptions;
	private concurrency: number;

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
		triageMax = 0,
		triageMinScore = 0,
		runOnStart = false,
		gate: Partial<AccountGateOptions> = {},
		concurrency = 3,
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
		this.triageMax = triageMax;
		this.triageMinScore = triageMinScore;
		this.runOnStart = runOnStart;
		this.gate = { ...DEFAULT_GATE, ...gate };
		this.concurrency = Number.isFinite(concurrency) ? Math.max(1, Math.floor(concurrency)) : 1;
	}

	/**
	 * Run agent turns over subjects with bounded parallelism (1 = serial).
	 * Per-item throws (e.g. a getContext/buildSummary outside the evaluator's own
	 * try, or onEvaluated in its finally) are logged, never silently dropped —
	 * the old serial loop surfaced them via runCycle's catch.
	 */
	private async evaluateAll<T>(
		items: T[],
		evaluate: (item: T) => Promise<number>,
		label: string,
	): Promise<number> {
		const counts = await mapWithConcurrency(items, this.concurrency, evaluate, (item, err) => {
			const detail = err instanceof Error ? err.message : String(err);
			console.error(`[work-loop] ${label} evaluation failed: ${detail}`, item);
			return 0;
		});
		return counts.reduce((sum, n) => sum + n, 0);
	}

	/**
	 * The change-detection gate: an unchanged account with no open Situation and
	 * no renewal in the horizon skips its (expensive) agent turn this cycle.
	 * Never skips indefinitely — past maxSkipAgeDays the account is re-reviewed.
	 */
	private shouldSkipAccount(plan: AccountReviewPlan, now: Date): boolean {
		if (!this.gate.enabled) return false;
		if (plan.changedSinceLastCycle) return false;
		if (plan.hasOpenSituations) return false;
		if (plan.daysToRenewal != null && plan.daysToRenewal <= this.gate.renewalHorizonDays) {
			return false;
		}
		// Defensive: unchanged implies a prior review exists, but if it doesn't, review.
		if (!plan.lastReviewedAt) return false;
		const ageDays = (now.getTime() - plan.lastReviewedAt.getTime()) / 86_400_000;
		return ageDays < this.gate.maxSkipAgeDays;
	}

	/**
	 * Triage gate: when enabled (max > 0), rank candidates by score and keep only
	 * the top-N above the floor, logging what was deferred. When disabled (max = 0)
	 * every candidate is worked. `max` defaults to the configured `triageMax`; a
	 * manual single cycle passes its own cap to override it for that run only.
	 */
	private triageSelect<T>(
		items: T[],
		scoreOf: (t: T) => TriageScore,
		label: string,
		max: number = this.triageMax,
	): T[] {
		if (max <= 0 || items.length === 0) return items;
		const { selected, deferred } = selectByTriage(items, scoreOf, {
			max,
			minScore: this.triageMinScore,
		});
		if (deferred.length > 0) {
			const below = deferred.filter((d) => d.reason === "below-floor").length;
			const over = deferred.length - below;
			console.log(
				`[work-loop] ${label} triage: ${selected.length} worked, ${deferred.length} deferred (${below} below floor, ${over} over budget)`,
			);
		}
		return selected.map((s) => s.item);
	}

	/**
	 * Run exactly one cycle on demand (manual trigger / dashboard button). Returns
	 * the cycle summary, or a busy marker if a cycle is already running. `limit`
	 * caps the per-sweep fan-out for this run: omitted → cap of 3 (cheap by
	 * default for dev); 0 → no cap (full run); N>0 → top-N per sweep.
	 */
	async runOnce(opts?: { limit?: number }): Promise<CycleSummary | { ran: false; reason: string }> {
		if (this.running) return { ran: false, reason: "cycle already running" };
		const cap = opts?.limit === undefined ? 3 : opts.limit;
		return this.runCycle(cap);
	}

	start(): void {
		if (!this.enabled) {
			console.log("[work-loop] Disabled.");
			return;
		}
		if (this.timer) return;
		console.log(`[work-loop] Starting — cycle every ${this.intervalMs / 1000}s`);
		this.timer = setInterval(() => this.cycle(), this.intervalMs);
		if (this.runOnStart) this.cycle();
	}

	stop(): void {
		if (this.timer) {
			clearInterval(this.timer);
			this.timer = null;
		}
		console.log("[work-loop] Stopped");
	}

	/** Interval-driven cycle: guards against overlap, ignores the summary. */
	private async cycle(): Promise<void> {
		if (this.running) {
			console.log("[work-loop] Previous cycle still running, skipping");
			return;
		}
		await this.runCycle();
	}

	/**
	 * Run one full cycle (accounts → tasks → renewals) and return a summary.
	 * `cap` overrides the per-sweep fan-out for this run: undefined → use the
	 * configured triageMax; 0 → no cap (work all); N>0 → top-N per sweep.
	 * Callers MUST ensure no cycle is already running (`this.running`).
	 */
	private async runCycle(cap?: number): Promise<CycleSummary> {
		if (this.running) {
			throw new Error("[work-loop] runCycle called while a cycle is already running");
		}
		const startedAt = Date.now();
		this.running = true;
		console.log(`[work-loop] Cycle starting — source: ${this.source.label}`);
		await this.emitter?.emit("brain_loop_cycle_start", { ts: startedAt });

		let actionsTaken = 0;
		let accounts: SweepCount = { evaluated: 0, available: 0 };
		let tasks: SweepCount = { evaluated: 0, available: 0 };
		let renewals: SweepCount = { evaluated: 0, available: 0 };

		try {
			// 1) Accounts — the change-detection sweep over the CSM's portfolio.
			const allAccounts = await this.source.list();
			if (allAccounts.length === 0) {
				console.log("[work-loop] No customers from source");
			}
			let worked: { id: string; companyName: string }[];
			if (this.source.prepare) {
				// Cheap pre-review pass: compute signals for every listed account (a
				// few CSP GETs each, bounded), gate out the unchanged ones, and rank
				// the rest on REAL triage inputs. The expensive LLM turn is spent
				// only where something changed.
				const prepare = this.source.prepare.bind(this.source);
				const planned = await mapWithConcurrency(
					allAccounts,
					PREPARE_CONCURRENCY,
					async (a) => ({ a, plan: await prepare(a.id, a.companyName) }),
					(a) => ({ a, plan: null }),
				);
				const gateNow = new Date();
				const eligible: typeof planned = [];
				let skipped = 0;
				for (const p of planned) {
					if (p.plan && this.shouldSkipAccount(p.plan, gateNow)) skipped += 1;
					else eligible.push(p);
				}
				if (skipped > 0) {
					console.log(
						`[work-loop] Accounts gate: ${skipped} skipped (no change), ${eligible.length} eligible`,
					);
				}
				worked = this.triageSelect(
					eligible,
					(p) => computeTriageScore(p.plan?.triage ?? {}),
					"Accounts",
					cap,
				).map((p) => p.a);
			} else {
				worked = this.triageSelect(allAccounts, () => computeTriageScore({}), "Accounts", cap);
			}
			actionsTaken += await this.evaluateAll(
				worked,
				(a) => this.evaluateCustomer(a.id, a.companyName),
				"Account",
			);
			accounts = { evaluated: worked.length, available: allAccounts.length };

			// 2) Tasks — independent of accounts.
			const taskRes = await this.cycleTasks(cap);
			tasks = taskRes.summary;
			actionsTaken += taskRes.actions;

			// 3) Renewals — independent of accounts and tasks.
			const renewalRes = await this.cycleRenewals(cap);
			renewals = renewalRes.summary;
			actionsTaken += renewalRes.actions;

			if (worked.length === 0 && !this.taskSource && !this.renewalSource) {
				console.log("[work-loop] Nothing to do this cycle");
			}
		} catch (err) {
			console.error("[work-loop] Cycle error:", err);
		} finally {
			this.running = false;
			console.log("[work-loop] Cycle complete");
			await this.emitter?.emit("brain_loop_cycle_end", { ts: Date.now() });
		}

		return {
			ran: true,
			limit: cap ?? this.triageMax,
			accounts,
			tasks,
			renewals,
			actionsTaken,
			durationMs: Date.now() - startedAt,
		};
	}

	/**
	 * Iterate the CSM's open tasks and work each one. Tasks that already have an
	 * open ledger action tagged with their id are skipped (mid-flight dedup) — re-
	 * actioning them would double-fire. `cap` caps per-cycle fan-out.
	 */
	private async cycleTasks(cap?: number): Promise<{ summary: SweepCount; actions: number }> {
		const empty = { summary: { evaluated: 0, available: 0 }, actions: 0 };
		if (!this.taskSource) return empty;
		let tasks: Awaited<ReturnType<TaskSource["listOpen"]>>;
		try {
			tasks = await this.taskSource.listOpen();
		} catch (err) {
			console.error(`[work-loop] Task list error: ${(err as Error).message}`);
			return empty;
		}
		if (tasks.length === 0) {
			console.log("[work-loop] No open tasks");
			return empty;
		}

		const inFlight = await this.tasksWithOpenActions();
		const open = tasks.filter((t) => !inFlight.has(t.id));
		const skipped = tasks.length - open.length;
		const worked = this.triageSelect(
			open,
			(t) => computeTriageScore({ priority: t.priority }),
			"Tasks",
			cap,
		);
		const actions = await this.evaluateAll(worked, (task) => this.evaluateTask(task), "Task");
		console.log(`[work-loop] Tasks: ${worked.length} evaluated, ${skipped} skipped (mid-flight)`);
		// `available` is post-dedup (eligible) tasks, not the raw queue — mid-flight
		// tasks are intentionally excluded since they can't be worked this cycle.
		return { summary: { evaluated: worked.length, available: open.length }, actions };
	}

	/**
	 * Task ids that already have an open (in-flight / claimed / needs-csm)
	 * ledger action. The harness now stamps task_id on the row itself; legacy
	 * rows only carry payload.taskId. Read both so a half-migrated DB still
	 * dedups correctly.
	 */
	private async tasksWithOpenActions(): Promise<Set<string>> {
		const ids = new Set<string>();
		if (!this.ledger) return ids;
		try {
			for (const entry of await this.ledger.listOpen()) {
				if (entry.taskId) ids.add(entry.taskId);
				const legacy = (entry.payload as { taskId?: unknown } | undefined)?.taskId;
				if (typeof legacy === "string") ids.add(legacy);
			}
		} catch (err) {
			console.error(`[work-loop] Ledger dedup scan failed: ${(err as Error).message}`);
		}
		return ids;
	}

	private async evaluateTask(task: { id: string; title: string }): Promise<number> {
		const full = (await this.taskSource?.getContext(task.id)) ?? null;
		const context = full
			? renderTaskContext(full)
			: `# Cerebro task\n- ${task.title} (id: ${task.id})`;

		const prompt = `You have a task to work from the CSM's Cerebro queue.

${context}

${TASK_GUIDANCE}`;

		try {
			const response = await this.agent.prompt(prompt, undefined, `brain:task:${task.id}`, {
				subject: { kind: "task", taskId: task.id, accountId: full?.businessId ?? undefined },
			});
			const taken = await this.countActions(response);
			if (taken > 0) console.log(`[work-loop] task ${task.id}: ${taken} actions taken`);
			return taken;
		} catch (err) {
			const detail = err instanceof Error ? err.message : String(err);
			console.error(`[work-loop] Error evaluating task ${task.id}: ${detail}`);
			return 0;
		}
	}

	/**
	 * Renewal sweep — iterate the CSM's open (upcoming/at-risk) renewals and work
	 * each on its timeline, independent of the account and task sweeps. `cap` caps
	 * per-cycle fan-out.
	 */
	private async cycleRenewals(cap?: number): Promise<{ summary: SweepCount; actions: number }> {
		const empty = { summary: { evaluated: 0, available: 0 }, actions: 0 };
		if (!this.renewalSource) return empty;
		let renewals: Awaited<ReturnType<RenewalSource["listOpen"]>>;
		try {
			renewals = await this.renewalSource.listOpen();
		} catch (err) {
			console.error(`[work-loop] Renewal list error: ${(err as Error).message}`);
			return empty;
		}
		if (renewals.length === 0) {
			console.log("[work-loop] No open renewals");
			return empty;
		}
		const worked = this.triageSelect(
			renewals,
			(r) =>
				computeTriageScore({
					atRisk: r.atRisk,
					daysToRenewal: r.daysToRenewal,
					contractValue: r.arr,
				}),
			"Renewals",
			cap,
		);
		const actions = await this.evaluateAll(
			worked,
			(renewal) => this.evaluateRenewal(renewal.id),
			"Renewal",
		);
		console.log(`[work-loop] Renewals: ${worked.length} evaluated`);
		return { summary: { evaluated: worked.length, available: renewals.length }, actions };
	}

	private async evaluateRenewal(id: string): Promise<number> {
		const full = (await this.renewalSource?.getContext(id)) ?? null;
		if (!full) {
			console.error(`[work-loop] Renewal ${id} has no context — skipping`);
			return 0;
		}
		const renewalContext = renderRenewalContext(full);
		const situations = this.situationStore
			? await this.situationStore.listOpen(full.businessId)
			: [];
		const situationBlock = renderSituations(situations, new Date());

		const prompt = `You have a renewal to work from the CSM's portfolio.

${renewalContext}

${situationBlock}

${RENEWAL_GUIDANCE}`;

		try {
			const response = await this.agent.prompt(prompt, undefined, `brain:renewal:${id}`, {
				subject: { kind: "renewal", renewalId: id, accountId: full.businessId },
			});
			const taken = await this.countActions(response);
			if (taken > 0) console.log(`[work-loop] renewal ${id}: ${taken} actions taken`);
			return taken;
		} catch (err) {
			const detail = err instanceof Error ? err.message : String(err);
			console.error(`[work-loop] Error evaluating renewal ${id}: ${detail}`);
			return 0;
		}
	}

	private async evaluateCustomer(customerId: string, companyName: string): Promise<number> {
		const summary = await this.source.buildSummary(customerId, companyName);

		const prompt = `You are reviewing customer "${companyName}". Decide if any action is needed right now.

${summary}

${BAND_GUIDANCE}

If nothing needs doing, say "No action needed for ${companyName}." and move on.`;

		try {
			const response = await this.agent.prompt(prompt, undefined, `brain:${customerId}`, {
				subject: { kind: "account", accountId: customerId },
			});
			const taken = await this.countActions(response);
			if (taken > 0) console.log(`[work-loop] ${companyName}: ${taken} actions taken`);
			return taken;
		} catch (err) {
			const detail = err instanceof Error ? err.message : String(err);
			console.error(`[work-loop] Error evaluating ${companyName}: ${detail}`);
			return 0;
		} finally {
			// Persist this cycle's signal snapshot exactly once, after the review.
			await this.source.onEvaluated?.(customerId);
		}
	}

	/**
	 * How many band-actions an agent turn produced. Ledger count by turn_id is
	 * the truth (the harness stamps it on every record). Falls back to the
	 * runtime's `toolCalls.length` when no turn id was returned (legacy / chat).
	 */
	private async countActions(response: {
		turnId?: string;
		toolCalls: { toolName: string }[];
	}): Promise<number> {
		if (response.turnId && this.ledger) {
			try {
				return await this.ledger.countByTurn(response.turnId);
			} catch (err) {
				console.error(`[work-loop] countByTurn failed: ${(err as Error).message}`);
			}
		}
		return response.toolCalls.length;
	}
}
