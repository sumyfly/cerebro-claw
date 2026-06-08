# Design — Triage Scoring

## The shift: from "process everything" to "process what matters"

```
TODAY                                  WITH TRIAGE
─────                                  ───────────
for each of 1,327 accounts:            score all 1,327 (cheap arithmetic)
   agent.prompt()  ← infeasible        rank; take top-N above a floor
                                       for each of the top-N:
                                          agent.prompt()  ← affordable
                                       defer the rest (logged), revisit
                                       when their signals change
```

Triage sits at the **front of Perceive**: the loop already computes signals per subject; triage turns those signals into a single comparable score *before* deciding whether the subject is worth a (costly) Decide turn.

## The score

Cheap, deterministic, no model call:

```
score = wRisk·risk + wValue·value + wUrgency·urgency
```

- **risk** — from health grade + usage trend (declining usage, health drop, at-risk flag).
- **value** — normalized ARR / contract size (a $50k account outranks a $2k one at equal risk).
- **urgency** — renewal proximity (T-90 → T-0 ramps up; overdue is max), plus a bump when an open Situation's `nextCheckpoint` is due.

Weights are config/constants; the breakdown is returned alongside the score so the queue is explainable ("ranked high: renewal in 9d + ARR $48k").

## Budget and floor

- **`TRIAGE_MAX`** — top-N subjects worked per input per cycle (the spend ceiling).
- **`TRIAGE_MIN_SCORE`** — a floor; below it a subject is not worth a turn even if there's budget left. A calm portfolio should cost *near zero* agent turns.
- Deferred subjects are **logged, never dropped** — "evaluated N, deferred M (below floor / over budget)."

## Decisions (resolved)

### D1 — Triage is arithmetic on existing signals, not an LLM call
The whole point is to *avoid* spending a model turn to decide whether to spend a model turn. Scoring reuses the signals already computed in Perceive. The LLM is reserved for subjects that clear triage.

### D2 — Per-input top-N in v1 (account / task / renewal each get a budget)
Simplest correct start: each input ranks its own subjects and works its own top-N. A single merged cross-input priority queue (one budget across all three) is cleaner long-term but needs comparable cross-type scores; deferred to a later change (open question).

### D3 — Floor + budget, deferred-not-dropped
A subject below the floor or over budget is skipped this cycle and logged. Because the score is recomputed each cycle from fresh signals, a worsening subject naturally rises and surfaces — no separate "starvation" bookkeeping needed.

### D4 — Triage is observable; no silent truncation
The deferred count is logged every cycle and exposed (`GET /api/triage`), so capping coverage is always visible. Silent truncation would read as "covered everything" when it didn't — the one thing we must not do.

### D5 — Composes with verification and situations, doesn't depend on them
Triage selects *which* subjects get a turn; the verifier checks *whether* a chosen action is sound; Situations carry *memory* across cycles. Independent concerns — triage ships without the others, and the Situation-checkpoint bump (urgency) is a nice-to-have, not a hard dependency.

## Open questions (build-time)

1. **Unified vs per-input budget** (D2) — when cross-type scores are calibrated, merge into one ranked queue with a single budget so a hot renewal outranks a lukewarm account globally.
2. **Weight tuning** — start with sensible constants; later, learn weights from which deferred subjects *should* have been worked (ties into the future reflection/learning capability).
3. **Interaction with a checkpoint-driven loop** — triage ranks what the loop sweeps; a future event-driven loop (wake on due checkpoints/new signals) would shrink the candidate set before triage even runs. Complementary, separate change.
