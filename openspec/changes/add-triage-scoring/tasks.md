# Tasks — Triage Scoring

> Planning only. Ordered: score → loop budget → observability → tests.

## 1. The score

- [ ] 1.1 Add `TriageScore` type (overall + {risk, value, urgency} breakdown) to the engine/shared.
- [ ] 1.2 Implement `computeTriageScore(signals, opts?)` — pure arithmetic, no LLM; weights as constants/config.
- [ ] 1.3 Map each input's signals into the score: account (health/usage/ARR/renewal), task (priority/linked account), renewal (days-to-renewal/ARR/at-risk); bump urgency when a Situation checkpoint is due.

## 2. Work-loop budget

- [ ] 2.1 Config: `TRIAGE_MAX` (top-N per input per cycle) + `TRIAGE_MIN_SCORE` (floor); `.env.example`.
- [ ] 2.2 In each sweep: score all candidates, sort desc, take top `TRIAGE_MAX` above the floor, evaluate those; defer the rest.
- [ ] 2.3 Log "evaluated N, deferred M (below floor / over budget)" each cycle.
- [ ] 2.4 Keep per-input budgets (D2); leave a seam for a future unified queue.

## 3. Observability

- [ ] 3.1 `GET /api/triage` — the ranked queue with breakdown + deferred subjects and reason.
- [ ] 3.2 Document triage at the front of Perceive in `docs/architecture.md`.

## 4. Tests

- [ ] 4.1 Score: deterministic, no LLM; higher risk/value/urgency ⇒ higher score; breakdown present.
- [ ] 4.2 Loop budget: more candidates than `TRIAGE_MAX` ⇒ only top-N evaluated; all-below-floor ⇒ zero turns.
- [ ] 4.3 Deferred-not-dropped: a worsening deferred subject resurfaces in a later cycle.
- [ ] 4.4 Observability: deferred count logged; `/api/triage` returns score-ordered queue.
