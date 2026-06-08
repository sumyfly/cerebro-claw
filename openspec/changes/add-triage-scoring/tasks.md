# Tasks — Triage Scoring

> Planning only. Ordered: score → loop budget → observability → tests.

## 1. The score

- [x] 1.1 Added `TriageInput` / `TriageScore` / `TriageWeights` to `engine/triage.ts`.
- [x] 1.2 `computeTriageScore(input, weights?)` — pure arithmetic, no LLM; default weights (risk .5 / value .2 / urgency .3).
- [x] 1.3 Renewal (atRisk/days/ARR) and task (priority) are richly scored. **Account scoring is a budget cap** — the account `list()` carries no signals, so accounts score neutral (capped per cycle, not ranked); rich account ranking needs the source to expose triage fields (scoped follow-up). Situation-checkpoint urgency bump is supported by the score (`checkpointDue`), wired where available.

## 2. Work-loop budget

- [x] 2.1 Config `TRIAGE_MAX` (per-input top-N, 0=disabled) + `TRIAGE_MIN_SCORE`; `.env.example`.
- [x] 2.2 Each sweep (account/task/renewal) ranks candidates and works the top-N above the floor via `triageSelect`; the rest are deferred. Disabled (max=0) = work all (prior behavior, all existing tests pass).
- [x] 2.3 Logs "<Input> triage: N worked, M deferred (X below floor, Y over budget)".
- [x] 2.4 Per-input budgets (D2); `selectByTriage` is generic so a future unified queue can reuse it.

## 3. Observability

- [x] 3.1 `GET /api/triage` — ranked renewal + task queues with score breakdown, the budget, and deferred subjects + reason.
- [x] 3.2 Triage documented at the front of Perceive in `docs/architecture.md`.

## 4. Tests

- [x] 4.1 `triage.test`: deterministic, no LLM; higher risk/value/urgency ⇒ higher; breakdown present.
- [x] 4.2 Loop budget: `brain-loop-triage` — triageMax=1 works only the top renewal; disabled works all. `selectByTriage` floor ⇒ zero selected.
- [x] 4.3 Deferred-not-dropped: a worsening deferred item resurfaces when its score rises.
- [x] 4.4 Deferred count logged; `/api/triage` returns score-ordered queues with deferred + reason.
