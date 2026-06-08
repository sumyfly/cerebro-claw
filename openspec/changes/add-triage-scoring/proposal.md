## Outcome

Make the agent actually "work the accounts that matter": a cheap server-side **triage score** ranks every subject by risk × value × urgency, and the work loop spends its (expensive) agent turns only on the top-ranked subjects — instead of sweeping the entire portfolio equally every cycle.

## Why

The product promise is to absorb the **long tail** so the CSM only touches what matters. But the Work Loop currently iterates **every** account, task, and renewal **equally** each cycle, each triggering an `agent.prompt()` turn. That:

- **Doesn't match the promise** — there is no notion of "what matters"; a steady account and a churning one get the same attention.
- **Doesn't scale** — Andrew Lee has **1,327 accounts**. One agent turn per subject per cycle is infeasible; the loop must choose where to spend.
- **Wastes the model** — most subjects have no material change, yet each still costs a full turn.

A triage step turns the loop from "process everything" into "process what's worth processing," which is both the scale fix and the core promise made real.

## What Changes

- **Compute a triage score per subject, cheaply (no LLM).** In the Perceive phase, score each account/task/renewal from already-computed signals: **risk** (health/usage trend, decline), **value** (ARR/contract size), and **urgency** (renewal/checkpoint proximity, overdue). Pure arithmetic in the engine — no model call.
- **Spend agent turns by rank, under a budget.** Each cycle the loop works the **top-N** subjects per input (`TRIAGE_MAX`) whose score clears a **floor** (`TRIAGE_MIN_SCORE`); the rest are **deferred** (no agent turn) and logged, to be reconsidered next cycle when their signals change.
- **Never starve the floor cases.** A subject below the floor is skipped, not dropped — if its signals worsen (or a Situation checkpoint comes due), its score rises and it surfaces.
- **Make triage observable.** Expose the ranked queue + what was deferred (and why) so a CSM/operator can see the agent is choosing deliberately, not silently truncating.

## Capabilities

### New Capabilities
- `triage-scoring`: a side-effect-free scoring step that ranks subjects by risk × value × urgency, plus a work-loop budget that spends agent turns on the top-ranked subjects above a floor and defers the rest (logged), so attention goes where it matters and the loop scales.

## Impact

- **Engine (Perceive):** a `computeTriageScore(signals)` function + a small `TriageScore` type (score + component breakdown).
- **Work loop:** before evaluating, rank the cycle's subjects by score, take the top `TRIAGE_MAX` above `TRIAGE_MIN_SCORE`, evaluate those, log the deferred count. Applies to the account/task/renewal inputs.
- **Config:** `TRIAGE_MAX` (top-N per input per cycle) and `TRIAGE_MIN_SCORE` (floor); `.env.example`.
- **Observability:** `GET /api/triage` (the ranked queue + deferred) and/or a digest line; the deferred count is logged each cycle (no silent truncation).
- **Docs:** triage as the front of the Perceive phase in `docs/architecture.md`.

## Non-goals

- **Not** an LLM-based ranker — triage is cheap arithmetic on existing signals (the LLM is for the few subjects that clear triage).
- **Not** a unified cross-input priority queue in v1 — start with per-input top-N (account/task/renewal each get a budget); a single merged queue is a later refinement (design open question).
- **Not** changing how a subject is *worked* once selected — this only changes *which* subjects get an agent turn.
