# Dev Loop Throttle Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give the work loop a cheap on-demand "middle gear" — a manual single-cycle trigger with a fan-out cap, plus a switch to stop the loop firing a cycle on every dev restart.

**Architecture:** Refactor `BrainLoop` so its per-cycle work is a public `runOnce({ limit })` that returns a `CycleSummary`, with the per-sweep fan-out cap overridable per run (default 3, `0` = all). Add `POST /api/brain/cycle` (admin-auth) that calls it, gate the boot cycle behind `BRAIN_LOOP_RUN_ON_START` (default off), and add a "WORK LOOP" action panel to the Settings page.

**Tech Stack:** TypeScript (strict, ESM), Express 5, Vitest + supertest, React 19 + Ant Design, Biome.

**Spec:** `docs/superpowers/specs/2026-06-08-dev-loop-throttle-design.md`

---

## File Structure

- `packages/server/src/brain-loop.ts` — add `CycleSummary`/`SweepCount` types, `runOnce`, split `cycle()` into a guarded wrapper + `runCycle(cap)`, make `triageSelect`/`cycleTasks`/`cycleRenewals`/`evaluate*` return counts and accept a cap, add `runOnStart` flag, gate the boot cycle.
- `packages/server/src/config.ts` — add `brainLoopRunOnStart`.
- `packages/server/src/app.ts` — read `BRAIN_LOOP_RUN_ON_START`, pass to `BrainLoop`, add `POST /api/brain/cycle` route.
- `packages/server/src/__tests__/brain-loop-run-once.test.ts` — new: cap, busy-guard, summary, boot gate.
- `packages/server/src/__tests__/brain-cycle-endpoint.test.ts` — new: route behavior.
- `packages/web/src/lib/api.ts` — add `CycleSummary`/`CycleSweep` types.
- `packages/web/src/pages/Settings.tsx` — add WORK LOOP action panel.
- `.env.example`, `CLAUDE.md` — document the new var + dev profile.

**Constructor note:** `BrainLoop`'s constructor is positional with 12 args today (`store, agent, intervalMs, enabled, emitter, source, taskSource, ledger, renewalSource, situationStore, triageMax, triageMinScore`). We append a 13th, `runOnStart = false`. Existing call sites and tests pass fewer/positional args and are unaffected by an appended defaulted param.

---

## Task 1: Make `triageSelect` accept an explicit per-call cap

This is a pure refactor — no behavior change. `triageSelect` currently reads `this.triageMax` directly; we make the cap a parameter defaulting to `this.triageMax` so a manual run can override it.

**Files:**
- Modify: `packages/server/src/brain-loop.ts:286-300`
- Test: existing `packages/server/src/__tests__/brain-loop-triage.test.ts` must stay green.

- [ ] **Step 1: Change the `triageSelect` signature and body to use a `max` param**

Replace the method at `brain-loop.ts:286-300`:

```ts
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
```

- [ ] **Step 2: Run the existing triage tests to verify no regression**

Run: `pnpm --filter @cerebro-claw/server test -- brain-loop-triage`
Expected: PASS (2 tests) — the default `max = this.triageMax` preserves current behavior.

- [ ] **Step 3: Commit**

```bash
git add packages/server/src/brain-loop.ts
git commit -m "refactor(brain-loop): triageSelect takes an explicit cap param"
```

---

## Task 2: Return counts from the sweeps and add `CycleSummary`

Make `evaluate*` return the number of tool calls, `cycleTasks`/`cycleRenewals` return counts + a cap, and split `cycle()` into a guarded wrapper plus a `runCycle(cap)` that returns a `CycleSummary`. The interval path keeps calling the guarded `cycle()` and ignores the return value.

**Files:**
- Modify: `packages/server/src/brain-loop.ts` (types near top of file, `cycle`/`cycleTasks`/`evaluateTask`/`cycleRenewals`/`evaluateRenewal`/`evaluateCustomer`)
- Test: `packages/server/src/__tests__/brain-loop-run-once.test.ts` (created in Task 3); existing brain-loop tests must stay green.

- [ ] **Step 1: Add the summary types**

Insert just below the `EventEmitter` interface (after `brain-loop.ts:21`):

```ts
/** Per-sweep tally: how many subjects were worked vs. how many were eligible. */
export interface SweepCount {
	evaluated: number;
	available: number;
}

/** What one cycle did — returned by `runCycle`/`runOnce`. */
export interface CycleSummary {
	ran: true;
	/** Effective per-sweep fan-out cap for this run (0 = no cap). */
	limit: number;
	accounts: SweepCount;
	tasks: SweepCount;
	renewals: SweepCount;
	actionsTaken: number;
	durationMs: number;
}
```

- [ ] **Step 2: Make `cycle()` a guarded wrapper and add `runCycle(cap)`**

Replace the whole `cycle()` method at `brain-loop.ts:321-363` with:

```ts
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
			const worked = this.triageSelect(allAccounts, () => computeTriageScore({}), "Accounts", cap);
			for (const a of worked) {
				actionsTaken += await this.evaluateCustomer(a.id, a.companyName);
			}
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
```

- [ ] **Step 3: Make `cycleTasks` accept a cap and return counts**

Replace `cycleTasks` at `brain-loop.ts:371-398` with:

```ts
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
		let actions = 0;
		for (const task of worked) {
			actions += await this.evaluateTask(task);
		}
		console.log(`[work-loop] Tasks: ${worked.length} evaluated, ${skipped} skipped (mid-flight)`);
		return { summary: { evaluated: worked.length, available: open.length }, actions };
	}
```

- [ ] **Step 4: Make `evaluateTask` return its tool-call count**

Replace `evaluateTask` at `brain-loop.ts:415-436` with (only the signature and the `try/catch` change — body identical otherwise):

```ts
	private async evaluateTask(task: { id: string; title: string }): Promise<number> {
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
			return response.toolCalls.length;
		} catch (err) {
			const detail = err instanceof Error ? err.message : String(err);
			console.error(`[work-loop] Error evaluating task ${task.id}: ${detail}`);
			return 0;
		}
	}
```

- [ ] **Step 5: Make `cycleRenewals` accept a cap and return counts**

Replace `cycleRenewals` at `brain-loop.ts:443-471` with:

```ts
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
		let actions = 0;
		for (const renewal of worked) {
			actions += await this.evaluateRenewal(renewal.id);
		}
		console.log(`[work-loop] Renewals: ${worked.length} evaluated`);
		return { summary: { evaluated: worked.length, available: renewals.length }, actions };
	}
```

- [ ] **Step 6: Make `evaluateRenewal` return its tool-call count**

Replace `evaluateRenewal` at `brain-loop.ts:473-504` — change the return type to `Promise<number>`, add an early `return 0` on the no-context branch, and return `response.toolCalls.length` / `0`:

```ts
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
			const response = await this.agent.prompt(prompt, undefined, `brain:renewal:${id}`);
			if (response.toolCalls.length > 0) {
				console.log(`[work-loop] renewal ${id}: ${response.toolCalls.length} actions taken`);
			}
			return response.toolCalls.length;
		} catch (err) {
			const detail = err instanceof Error ? err.message : String(err);
			console.error(`[work-loop] Error evaluating renewal ${id}: ${detail}`);
			return 0;
		}
	}
```

- [ ] **Step 7: Make `evaluateCustomer` return its tool-call count**

Replace `evaluateCustomer` at `brain-loop.ts:506-530` with (return type `Promise<number>`, return inside try/catch, `onEvaluated` stays in `finally`):

```ts
	private async evaluateCustomer(customerId: string, companyName: string): Promise<number> {
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
			return response.toolCalls.length;
		} catch (err) {
			const detail = err instanceof Error ? err.message : String(err);
			console.error(`[work-loop] Error evaluating ${companyName}: ${detail}`);
			return 0;
		} finally {
			// Persist this cycle's signal snapshot exactly once, after the review.
			await this.source.onEvaluated?.(customerId);
		}
	}
```

- [ ] **Step 8: Build the server package to confirm it type-checks**

Run: `pnpm --filter @cerebro-claw/server build`
Expected: build succeeds (no TS errors).

- [ ] **Step 9: Run the full brain-loop test suite to confirm no regression**

Run: `pnpm --filter @cerebro-claw/server test -- brain-loop`
Expected: PASS — all existing brain-loop tests (csp-source, triage, renewals, events, tasks) still pass; the interval path (`cycle()`) is unchanged in behavior.

- [ ] **Step 10: Commit**

```bash
git add packages/server/src/brain-loop.ts
git commit -m "refactor(brain-loop): sweeps return counts; cycle splits into runCycle(cap)"
```

---

## Task 3: Add `runOnce` with the busy-guard and default cap

Public entry point for a manual single cycle. Returns the summary, or a busy marker mapped to 409 by the route. Default cap of 3 when `limit` is omitted; `0` = no cap.

**Files:**
- Modify: `packages/server/src/brain-loop.ts` (add `runOnce` method, near `start()`)
- Test: `packages/server/src/__tests__/brain-loop-run-once.test.ts` (create)

- [ ] **Step 1: Write the failing test**

Create `packages/server/src/__tests__/brain-loop-run-once.test.ts`:

```ts
import { InMemoryStore } from "@cerebro-claw/memory";
import type { RenewalRecord } from "@cerebro-claw/shared";
import { StubRenewalSource } from "@cerebro-claw/tools";
import { describe, expect, it, vi } from "vitest";
import { BrainLoop, type CycleSummary } from "../brain-loop.js";

const renewals: RenewalRecord[] = [
	{ id: "R-high", businessId: "b1", atRisk: true, daysToRenewal: 5, arr: 50_000 },
	{ id: "R-mid", businessId: "b2", daysToRenewal: 60, arr: 10_000 },
	{ id: "R-low", businessId: "b3", daysToRenewal: 200, arr: 1_000 },
];

function loop(triageMax = 0) {
	const prompt = vi.fn(async () => ({ text: "done", toolCalls: [{ name: "act" }] }));
	const l = new BrainLoop(
		new InMemoryStore(),
		{ prompt } as never,
		999_999,
		true,
		null,
		undefined,
		null,
		null,
		new StubRenewalSource({ renewals }),
		null,
		triageMax,
		0,
	);
	return { l, prompt };
}

describe("BrainLoop.runOnce", () => {
	it("defaults to a fan-out cap of 3 per sweep when no limit is given", async () => {
		const { l, prompt } = loop();
		const res = (await l.runOnce()) as CycleSummary;
		expect(res.ran).toBe(true);
		// 3 renewals available, cap 3 → all 3 (boundary), 0 accounts, 0 tasks
		expect(res.renewals.evaluated).toBe(3);
		expect(res.limit).toBe(3);
		expect(prompt).toHaveBeenCalledTimes(3);
	});

	it("caps the sweep at the requested limit", async () => {
		const { l, prompt } = loop();
		const res = (await l.runOnce({ limit: 1 })) as CycleSummary;
		expect(res.renewals.evaluated).toBe(1);
		expect(res.renewals.available).toBe(3);
		expect(prompt).toHaveBeenCalledTimes(1);
		expect(prompt.mock.calls[0][0] as string).toContain("R-high");
	});

	it("limit=0 means no cap — works all subjects", async () => {
		const { l, prompt } = loop();
		const res = (await l.runOnce({ limit: 0 })) as CycleSummary;
		expect(res.limit).toBe(0);
		expect(res.renewals.evaluated).toBe(3);
		expect(prompt).toHaveBeenCalledTimes(3);
	});

	it("tallies actionsTaken from tool calls", async () => {
		const { l } = loop();
		const res = (await l.runOnce({ limit: 0 })) as CycleSummary;
		expect(res.actionsTaken).toBe(3); // one tool call per renewal
	});

	it("returns a busy marker when a cycle is already running", async () => {
		const { l } = loop();
		(l as unknown as { running: boolean }).running = true;
		const res = await l.runOnce();
		expect(res).toEqual({ ran: false, reason: "cycle already running" });
	});
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter @cerebro-claw/server test -- brain-loop-run-once`
Expected: FAIL — `l.runOnce is not a function`.

- [ ] **Step 3: Add the `runOnce` method**

Insert immediately above `start()` (before `brain-loop.ts:302`):

```ts
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
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm --filter @cerebro-claw/server test -- brain-loop-run-once`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add packages/server/src/brain-loop.ts packages/server/src/__tests__/brain-loop-run-once.test.ts
git commit -m "feat(brain-loop): runOnce — manual single cycle with fan-out cap"
```

---

## Task 4: Gate the boot cycle behind `BRAIN_LOOP_RUN_ON_START`

`start()` fires a cycle immediately today. Make that immediate fire opt-in (default off) so watch-mode restarts stop costing tokens. The recurring interval is unchanged.

**Files:**
- Modify: `packages/server/src/brain-loop.ts` (field + constructor + `start()`)
- Modify: `packages/server/src/config.ts:36` (interface) and `:71` (loader)
- Modify: `packages/server/src/app.ts:284` and `:302-315`
- Test: append to `packages/server/src/__tests__/brain-loop-run-once.test.ts`

- [ ] **Step 1: Write the failing test**

Append to `packages/server/src/__tests__/brain-loop-run-once.test.ts`:

```ts
describe("BrainLoop boot cycle gate", () => {
	function loopWithRunOnStart(runOnStart: boolean) {
		const prompt = vi.fn(async () => ({ text: "done", toolCalls: [] }));
		const l = new BrainLoop(
			new InMemoryStore(),
			{ prompt } as never,
			999_999,
			true,
			null,
			undefined,
			null,
			null,
			new StubRenewalSource({ renewals }),
			null,
			0,
			0,
			runOnStart,
		);
		return { l, prompt };
	}

	it("does NOT run a cycle on start when runOnStart is false", async () => {
		const { l, prompt } = loopWithRunOnStart(false);
		l.start();
		await new Promise((r) => setTimeout(r, 10));
		expect(prompt).not.toHaveBeenCalled();
		l.stop();
	});

	it("runs a cycle on start when runOnStart is true", async () => {
		const { l, prompt } = loopWithRunOnStart(true);
		l.start();
		await new Promise((r) => setTimeout(r, 10));
		expect(prompt).toHaveBeenCalledTimes(3);
		l.stop();
	});
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter @cerebro-claw/server test -- brain-loop-run-once`
Expected: FAIL — "runs a cycle on start when runOnStart is true" fails because the 13th constructor arg is ignored and the current `start()` always fires a cycle (so the `false` test also fails).

- [ ] **Step 3: Add the `runOnStart` field and constructor param**

In `brain-loop.ts`, add the field after `private triageMinScore: number;` (`:251`):

```ts
	private runOnStart: boolean;
```

Add the constructor param after `triageMinScore = 0,` (`:265`):

```ts
		runOnStart = false,
```

Assign it at the end of the constructor body, after `this.triageMinScore = triageMinScore;` (`:278`):

```ts
		this.runOnStart = runOnStart;
```

- [ ] **Step 4: Gate the immediate cycle in `start()`**

In `start()` (`brain-loop.ts:302-311`), replace the unconditional final `this.cycle();` (`:310`) with:

```ts
		if (this.runOnStart) this.cycle();
```

- [ ] **Step 5: Add the config field**

In `config.ts`, add to the `ServerConfig` interface after `brainLoopIntervalMs: number;` (`:9`):

```ts
	/** Run a cycle immediately on boot. Default false — avoids a token tax on every dev restart. */
	brainLoopRunOnStart: boolean;
```

In `loadConfig()`'s return object, add after the `brainLoopIntervalMs:` line (`:52`):

```ts
		brainLoopRunOnStart: /^(1|true|yes)$/i.test(process.env.BRAIN_LOOP_RUN_ON_START ?? ""),
```

- [ ] **Step 6: Pass the flag through in `app.ts`**

In `app.ts`, the `BrainLoop` is constructed at `:302-315`. Add `config.brainLoopRunOnStart` as the final argument, after `config.triageMinScore` (`:314`):

```ts
		config.triageMinScore,
		config.brainLoopRunOnStart,
	);
```

- [ ] **Step 7: Run the tests + build**

Run: `pnpm --filter @cerebro-claw/server test -- brain-loop-run-once && pnpm --filter @cerebro-claw/server build`
Expected: PASS (7 tests now) and a clean build.

- [ ] **Step 8: Commit**

```bash
git add packages/server/src/brain-loop.ts packages/server/src/config.ts packages/server/src/app.ts packages/server/src/__tests__/brain-loop-run-once.test.ts
git commit -m "feat(brain-loop): gate boot cycle behind BRAIN_LOOP_RUN_ON_START (default off)"
```

---

## Task 5: Add the `POST /api/brain/cycle` route

**Files:**
- Modify: `packages/server/src/app.ts` (add route alongside the other `/api/*` routes, before `notFoundHandler` at `:556`)
- Test: `packages/server/src/__tests__/brain-cycle-endpoint.test.ts` (create)

- [ ] **Step 1: Write the failing test**

Create `packages/server/src/__tests__/brain-cycle-endpoint.test.ts`:

```ts
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Express } from "express";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createApp } from "../app.js";

/**
 * POST /api/brain/cycle runs one cycle on demand. With no sources configured the
 * cycle is a no-op but still returns a well-formed summary — enough to verify the
 * route, the limit parsing, and the response shape without spawning a real agent.
 */
describe("POST /api/brain/cycle", () => {
	let app: Express;
	let shutdown: () => Promise<void>;
	let tmpDir: string;
	const prev: Record<string, string | undefined> = {};

	beforeAll(async () => {
		tmpDir = mkdtempSync(join(tmpdir(), "brain-cycle-"));
		prev.DB_PATH = process.env.DB_PATH;
		prev.BRAIN_LOOP_ENABLED = process.env.BRAIN_LOOP_ENABLED;
		process.env.DB_PATH = join(tmpDir, "test.db");
		process.env.BRAIN_LOOP_ENABLED = "false"; // no interval timer during the test

		const handles = await createApp();
		app = handles.app;
		shutdown = handles.shutdown;
	});

	afterAll(async () => {
		await shutdown();
		for (const [k, v] of Object.entries(prev)) {
			if (v !== undefined) process.env[k] = v;
			else delete process.env[k];
		}
		rmSync(tmpDir, { recursive: true, force: true });
	});

	it("returns a cycle summary with the default cap of 3", async () => {
		const res = await request(app).post("/api/brain/cycle");
		expect(res.status).toBe(200);
		expect(res.body.ran).toBe(true);
		expect(res.body.limit).toBe(3);
		expect(res.body).toHaveProperty("accounts.evaluated");
		expect(res.body).toHaveProperty("actionsTaken");
		expect(res.body).toHaveProperty("durationMs");
	});

	it("parses ?limit=0 as no cap", async () => {
		const res = await request(app).post("/api/brain/cycle?limit=0");
		expect(res.status).toBe(200);
		expect(res.body.limit).toBe(0);
	});

	it("treats a non-numeric limit as omitted (default cap 3)", async () => {
		const res = await request(app).post("/api/brain/cycle?limit=abc");
		expect(res.status).toBe(200);
		expect(res.body.limit).toBe(3);
	});
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter @cerebro-claw/server test -- brain-cycle-endpoint`
Expected: FAIL — 404 (route not registered), so `res.body.ran` is undefined.

- [ ] **Step 3: Add the route**

In `app.ts`, insert this block right after the `GET /api/triage` route (after `:469`, before `GET /api/tasks`):

```ts
	// Manual single-cycle trigger — runs one work-loop cycle on demand. Lets the
	// loop stay disabled (BRAIN_LOOP_ENABLED=false) yet still be testable for cents
	// during development. ?limit caps per-sweep fan-out (omitted = 3, 0 = no cap).
	app.post("/api/brain/cycle", async (req, res) => {
		const raw = req.query.limit;
		let limit: number | undefined;
		if (raw !== undefined) {
			const n = Number(raw);
			limit = Number.isFinite(n) && n >= 0 ? n : undefined;
		}
		const result = await brainLoop.runOnce({ limit });
		if (result.ran === false) {
			res.status(409).json(result);
			return;
		}
		res.json(result);
	});
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm --filter @cerebro-claw/server test -- brain-cycle-endpoint`
Expected: PASS (3 tests).

- [ ] **Step 5: Run the whole server suite to confirm nothing else broke**

Run: `pnpm --filter @cerebro-claw/server test`
Expected: PASS (all server tests).

- [ ] **Step 6: Commit**

```bash
git add packages/server/src/app.ts packages/server/src/__tests__/brain-cycle-endpoint.test.ts
git commit -m "feat(server): POST /api/brain/cycle manual cycle trigger"
```

---

## Task 6: Add the WORK LOOP action panel to Settings

A button on the Settings page that fires the endpoint and shows the summary.

**Files:**
- Modify: `packages/web/src/lib/api.ts` (add types)
- Modify: `packages/web/src/pages/Settings.tsx` (add panel)

- [ ] **Step 1: Add the response types to the web API module**

In `packages/web/src/lib/api.ts`, add after the `Diagnostics` type (`:95`):

```ts
/** One sweep's tally in a manual cycle summary. */
export interface CycleSweep {
	evaluated: number;
	available: number;
}

/** Response of POST /api/brain/cycle. */
export interface CycleSummary {
	ran: true;
	limit: number;
	accounts: CycleSweep;
	tasks: CycleSweep;
	renewals: CycleSweep;
	actionsTaken: number;
	durationMs: number;
}
```

- [ ] **Step 2: Add the WORK LOOP panel to Settings**

In `packages/web/src/pages/Settings.tsx`:

Replace the import line (`:6`):

```ts
import {
	type CycleSummary,
	type Diagnostics,
	type ExtensionInfo,
	getJson,
	HttpError,
	postJson,
} from "../lib/api.js";
```

Add this component above `export function Settings()` (before `:40`):

```tsx
function WorkLoopPanel() {
	const [limit, setLimit] = useState(3);
	const [running, setRunning] = useState(false);
	const [summary, setSummary] = useState<CycleSummary | null>(null);
	const [error, setError] = useState<string | null>(null);

	async function runCycle() {
		setRunning(true);
		setError(null);
		setSummary(null);
		try {
			const res = await postJson<CycleSummary>(`/api/brain/cycle?limit=${limit}`, {});
			setSummary(res);
		} catch (err) {
			if (err instanceof HttpError && err.status === 409) {
				setError("A cycle is already running — try again in a moment.");
			} else {
				setError(err instanceof Error ? err.message : String(err));
			}
		} finally {
			setRunning(false);
		}
	}

	return (
		<Panel title="WORK LOOP" delay={260}>
			<div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 12 }}>
				<button type="button" className="cc-btn" disabled={running} onClick={runCycle}>
					{running ? "RUNNING…" : "RUN ONE CYCLE"}
				</button>
				<label className="cc-kv" style={{ gap: 6 }}>
					<span className="key">limit</span>
					<input
						type="number"
						min={0}
						value={limit}
						disabled={running}
						onChange={(e) => setLimit(Math.max(0, Number(e.target.value) || 0))}
						style={{ width: 56 }}
					/>
				</label>
				<span className="val" style={{ color: COLOR.grey }}>
					0 = full run
				</span>
			</div>
			{error && (
				<div className="val" style={{ color: COLOR.danger }}>
					{error}
				</div>
			)}
			{summary && (
				<>
					<KV k="cap" v={summary.limit === 0 ? "none" : summary.limit} />
					<KV k="accounts" v={`${summary.accounts.evaluated}/${summary.accounts.available}`} />
					<KV k="tasks" v={`${summary.tasks.evaluated}/${summary.tasks.available}`} />
					<KV k="renewals" v={`${summary.renewals.evaluated}/${summary.renewals.available}`} />
					<KV k="actions taken" v={summary.actionsTaken} />
					<KV k="duration" v={`${(summary.durationMs / 1000).toFixed(1)}s`} />
				</>
			)}
		</Panel>
	);
}
```

Then render it inside the right-hand column, after the `LOADED EXTENSIONS`/`WIRED CHANNELS` panels — add `<WorkLoopPanel />` as the last child of the `<div style={{ display: "flex", flexDirection: "column", gap: 16 }}>` block (after `:108`, before its closing `</div>` at `:109`):

```tsx
						<WorkLoopPanel />
```

- [ ] **Step 3: Confirm the web package builds**

Run: `pnpm --filter @cerebro-claw/web build`
Expected: build succeeds. If the build reports that `cc-btn` is an unknown class, that's only a style concern — confirm the class exists in `packages/web/src/theme.css`; if it does not, the button still works unstyled. Do not block on styling.

- [ ] **Step 4: Manual smoke check (optional but recommended)**

Run the dev server (`pnpm turbo dev`), open the Settings page, click RUN ONE CYCLE with `limit=1`, and confirm a summary renders. With no CSP/task/renewal source configured, all sweeps show `0/0` and `actions taken: 0` — that still proves the wiring end-to-end.

- [ ] **Step 5: Commit**

```bash
git add packages/web/src/lib/api.ts packages/web/src/pages/Settings.tsx
git commit -m "feat(web): WORK LOOP panel — run one cycle from Settings"
```

---

## Task 7: Document the new var and the dev profile

**Files:**
- Modify: `.env.example` (add `BRAIN_LOOP_RUN_ON_START` near `BRAIN_LOOP_INTERVAL_MS`)
- Modify: `CLAUDE.md` (Environment table + a note on the manual trigger)

- [ ] **Step 1: Add the env var + dev-profile note to `.env.example`**

Find the `BRAIN_LOOP_INTERVAL_MS` / `BRAIN_LOOP_ENABLED` lines in `.env.example` and add directly below them:

```bash
# Run a cycle immediately on boot. Default false — keeps watch-mode restarts from
# spending tokens. Set true only if you want an instant cycle on every server start.
BRAIN_LOOP_RUN_ON_START=false

# --- Dev profiles (balance testing vs token cost) ---
# Hands-on: leave the loop OFF and trigger a single cycle when you want to test:
#   BRAIN_LOOP_ENABLED=false
#   curl -X POST 'http://localhost:5100/api/brain/cycle?limit=3'   # ?limit=0 = full run
# Light auto: a slow interval with a small fan-out cap:
#   BRAIN_LOOP_ENABLED=true
#   BRAIN_LOOP_INTERVAL_MS=1800000   # 30 min
#   TRIAGE_MAX=2                      # ≤2 subjects per sweep
#   BRAIN_LOOP_RUN_ON_START=false
```

- [ ] **Step 2: Add the env var to the `CLAUDE.md` Environment table**

In `CLAUDE.md`, in the Environment table, add a row after the `DISPATCHER_INTERVAL_MS` / `DEFAULT_PAUSE_MINUTES` rows:

```markdown
| `BRAIN_LOOP_RUN_ON_START` | Run a cycle immediately on boot (default `false` — avoids a token tax on every dev restart) |
```

- [ ] **Step 3: Note the manual trigger in the loop/API description**

In `CLAUDE.md`, in the "Architecture — the loop" section, append to the Brain Loop bullet (item 4):

```markdown
   A single cycle can also be run on demand via `POST /api/brain/cycle?limit=N` (`limit` caps per-sweep fan-out; omitted = 3, `0` = full) — used by the Settings page "RUN ONE CYCLE" button and for cheap testing while the interval loop is off.
```

- [ ] **Step 4: Commit**

```bash
git add .env.example CLAUDE.md
git commit -m "docs: BRAIN_LOOP_RUN_ON_START + manual cycle trigger + dev profiles"
```

---

## Task 8: Final verification

- [ ] **Step 1: Run the full test suite across all packages**

Run: `pnpm turbo test`
Expected: PASS — the prior 287 tests plus the new run-once (7) and endpoint (3) tests.

- [ ] **Step 2: Build everything**

Run: `pnpm turbo build`
Expected: all packages build clean.

- [ ] **Step 3: Lint/format**

Run: `pnpm biome check --write packages/server packages/web`
Expected: no remaining errors (auto-fixes applied). Re-commit if anything changed:

```bash
git add -A && git commit -m "chore: biome format" || echo "nothing to format"
```

---

## Self-Review Notes

- **Spec coverage:** §1 manual trigger → Tasks 3 (`runOnce`) + 5 (route); fan-out cap default 3 / `0`=full → Tasks 1–3; `409` busy → Tasks 3 + 5; summary shape → Task 2. §2 boot-cycle gate → Task 4. §3 dashboard button → Task 6; docs → Task 7. All sections mapped.
- **Type consistency:** `CycleSummary`/`SweepCount` defined in Task 2 (`brain-loop.ts`), imported in Task 3's test, mirrored as `CycleSummary`/`CycleSweep` in `web/src/lib/api.ts` (Task 6). `runOnce` signature is identical in Tasks 3, 5, and 6 callers. The 13th constructor arg `runOnStart` is defined in Task 4 and used by the Task 4 test only.
- **Production behavior:** interval path (`cycle()` → `runCycle(undefined)`) preserves `triageMax` and existing semantics; `BRAIN_LOOP_RUN_ON_START` defaults `false` (a behavior change for boot only — documented and intentional).
