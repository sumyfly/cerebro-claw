# Dev loop throttle — a cheap middle gear for the work loop

**Date:** 2026-06-08
**Status:** Approved, ready for planning

## Problem

During rapid development the `BrainLoop` is either *off* (`BRAIN_LOOP_ENABLED=false`,
which is the current `.env` state — can't test anything) or a *firehose*. There is no
cheap way to exercise the loop while developing.

### Where the tokens actually go (from the code)

Each cycle calls `this.agent.prompt()` — a full Claude Code subprocess, the real
token cost — **once per subject**:

- up to `CSP_MAX_ACCOUNTS` accounts (default **25**) — `brain-loop.ts:341-343`
- up to `TASK_MAX` tasks (default **25**) — `brain-loop.ts:394-396`
- every renewal in the window — `brain-loop.ts:467-469`

With `TRIAGE_MAX=0` (the default, = *no cap*, `brain-loop.ts:287`), one cycle is
**~50+ subprocess LLM calls**. Then `start()` fires a cycle **immediately on boot**
*and* every `BRAIN_LOOP_INTERVAL_MS` (5 min) — `brain-loop.ts:309-310`. In
`pnpm turbo dev` watch mode, every file-save restart re-fires the boot cycle.

Two multipliers stack: **fan-out per cycle** (dominant) × **cadence** (unattended
repeat). That is the drain.

## Goal

Add a cheap, on-demand middle gear so the loop can be tested for cents during rapid
development, without changing production firehose behavior and without blocking dev.

Non-goals: no change to the four-band action policy, triage *scoring*, the dispatcher,
or production defaults. Production keeps current behavior unless its own env says
otherwise.

## Design

Three changes. All additive; defaults preserve existing behavior except where called
out.

### 1. Manual trigger — `POST /api/brain/cycle`

Runs exactly **one** cycle on demand and returns a summary. Lets the loop stay off
(`BRAIN_LOOP_ENABLED=false`) while still being testable: you fire a cycle by hand
only when you want to.

- **Request:** `POST /api/brain/cycle` with optional query `?limit=N`.
  - `limit` omitted → default fan-out cap of **3** per sweep (≤3 accounts + ≤3 tasks
    + ≤3 renewals = ≤9 LLM calls). Triage still ranks, so the *most important* few
    are worked.
  - `limit=0` → no cap (full firehose; explicit opt-in).
  - `limit=N` (N>0) → cap each sweep at N.
- **Response (200):**
  ```json
  {
    "ran": true,
    "limit": 3,
    "accounts": { "evaluated": 3, "available": 25 },
    "tasks": { "evaluated": 3, "available": 12 },
    "renewals": { "evaluated": 2, "available": 2 },
    "actionsTaken": 4,
    "durationMs": 41210
  }
  ```
- **Concurrency:** if a cycle (manual or interval) is already running, return
  `409 { "ran": false, "reason": "cycle already running" }`. Reuses the existing
  `this.running` guard (`brain-loop.ts:322-325`) — never run two cycles at once.
- **Auth:** behind the existing `createAdminAuth` middleware like every other
  `/api/*` route — no new auth surface.

#### `BrainLoop` changes to support it

- New public `async runOnce(opts?: { limit?: number }): Promise<CycleSummary>` that
  wraps the existing private `cycle()`. Returns the summary (or throws/returns a
  "busy" marker the route maps to 409).
- `cycle()` gains an optional per-run fan-out cap and tallies counts:
  - Thread an effective cap into the three `triageSelect(...)` calls. When a manual
    `limit` is supplied it overrides `this.triageMax` **for that run only**; the
    interval-driven cycle keeps using `this.triageMax` unchanged.
  - Collect `{ accounts, tasks, renewals, actionsTaken }` as it goes (the
    `evaluate*` methods already know when `toolCalls.length > 0`; sum those for
    `actionsTaken`) and return a `CycleSummary`.
  - Smallest viable refactor: `cycle()` builds and returns the summary; the existing
    interval path (`setInterval(() => this.cycle(), ...)`) ignores the return value.
- `CycleSummary` type lives in `brain-loop.ts` (server-internal); the web mirror is a
  plain interface in `web/src/lib/api.ts` (the repo's existing pattern — no shared
  type needed for a server-only response shape).

### 2. Gate the boot cycle — `BRAIN_LOOP_RUN_ON_START` (default `false`)

`start()` currently calls `this.cycle()` immediately (`brain-loop.ts:310`). Gate that
single immediate call behind `BRAIN_LOOP_RUN_ON_START`:

- default `false` → when the loop is enabled it waits one `intervalMs` before its
  first cycle, instead of firing on every watch-mode restart. Kills the boot token tax.
- `true` → preserves today's run-immediately-on-start behavior.

The recurring `setInterval` is unaffected. `BRAIN_LOOP_ENABLED=false` still short-
circuits everything (`brain-loop.ts:303-306`).

Plumb a boolean into the `BrainLoop` constructor (defaulted) and read the env in
`app.ts` next to `brainLoopEnabled` (`app.ts:284`).

### 3. Dashboard control + docs

**Web (`packages/web`)** — a "WORK LOOP" action panel on the Settings page
(`pages/Settings.tsx`):
- A "RUN ONE CYCLE" button → `postJson("/api/brain/cycle?limit=" + limit, {})`.
- A small numeric input for `limit` (default `3`, `0` = full).
- While running: disable the button, show a spinner/"RUNNING…".
- On result: render the summary (accounts/tasks/renewals evaluated, actions taken,
  duration). On 409: show "a cycle is already running". On error: show the message.
- Settings is currently labelled `[READ-ONLY]`; this panel is the one action area —
  drop/adjust that label or scope it to the status panels. Use the existing
  `postJson` helper and `Panel`/primitives so it matches the console's look.

**Docs** — `.env.example` gains `BRAIN_LOOP_RUN_ON_START` (default `false`) and a
short "dev profile" note:
- *Hands-on:* `BRAIN_LOOP_ENABLED=false` + trigger via `POST /api/brain/cycle`.
- *Light auto:* `BRAIN_LOOP_ENABLED=true`, `BRAIN_LOOP_INTERVAL_MS=1800000` (30m),
  `TRIAGE_MAX=2`, `BRAIN_LOOP_RUN_ON_START=false`.

`CLAUDE.md`'s Environment table gains the new var; the brain-loop / API sections note
the manual trigger.

## Data flow

```
Dashboard "RUN ONE CYCLE" (limit=3)
  └─ POST /api/brain/cycle?limit=3   (admin-auth)
       └─ brainLoop.runOnce({ limit: 3 })
            └─ cycle(cap=3)
                 ├─ accounts: triageSelect(top 3) → evaluateCustomer ×≤3
                 ├─ tasks:    triageSelect(top 3) → evaluateTask ×≤3
                 ├─ renewals: triageSelect(top 3) → evaluateRenewal ×≤3
                 └─ returns CycleSummary
       └─ 200 { summary }  |  409 if a cycle is already running
```

## Error handling

- Cycle already running → `409`, no second cycle (existing `this.running` guard).
- A subject's `agent.prompt()` throwing is already caught per-subject
  (`brain-loop.ts:432, 500, 522`); it does not abort the cycle and counts as
  evaluated-with-error. Summary still returns.
- Bad `limit` (non-numeric / negative) → treat as omitted (default cap 3).

## Testing

- `runOnce({ limit })` caps each sweep at `limit` (assert evaluate-count via a stub
  agent that records calls); `limit=0` works all.
- `runOnce()` returns 409-marker when `this.running` is already true.
- `runOnce()` summary tallies accounts/tasks/renewals/actionsTaken correctly with a
  stub source + stub agent.
- `start()` does **not** call `cycle()` when `BRAIN_LOOP_RUN_ON_START=false`; **does**
  when `true`; the interval timer is set in both cases.
- Route test: `POST /api/brain/cycle` returns the summary; `?limit=` is parsed;
  busy → 409.

## Files touched

- `packages/server/src/brain-loop.ts` — `runOnce`, `CycleSummary`, capped `cycle()`,
  gated boot cycle, constructor flag.
- `packages/server/src/app.ts` — `POST /api/brain/cycle` route; read
  `BRAIN_LOOP_RUN_ON_START`; pass flag to `BrainLoop`.
- `packages/web/src/lib/api.ts` — `CycleSummary` interface.
- `packages/web/src/pages/Settings.tsx` — WORK LOOP action panel.
- `.env.example`, `CLAUDE.md` — new var + dev profile docs.
- Tests in `packages/server` (brain-loop + route).
