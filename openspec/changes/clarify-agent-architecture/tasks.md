# Tasks — Clarify Agent Architecture

> Planning only — captured during explore mode. Nothing here is implemented yet.
> Ordered by the design's ship sequence: Situations → vocabulary → loop framing → extension surface.

## 1. Situations (Thread 1 — the load-bearing change)

- [ ] 1.1 Add `Situation` and `SituationStatus` types to `@cerebro-claw/shared` (id, businessId, kind, title, status, openedAt, nextCheckpoint?, waitingFor?, needsAttention). Timeline is derived from ledger rows linked by `situationId` — not a stored field.
- [ ] 1.2 Add optional `situationId` to the action/ledger types.
- [ ] 1.3 Define a `SituationStore` interface (open, get, listOpen(businessId), update, resolve) in shared.
- [ ] 1.4 Implement an in-memory `SituationStore` for tests/dev.
- [ ] 1.5 Implement the SQLite `SituationStore` + `situations` table in `@cerebro-claw/memory`.
- [ ] 1.6 Perceive: extend `engine/decision-context` and `task-context` to load open situations for the subject.
- [ ] 1.7 Remember: after each action, open/advance/resolve the relevant situation; link the ledger entry via `situationId`.
- [ ] 1.8 Dedup-by-situation: skip re-flagging a subject with a `watching` situation whose `nextCheckpoint` is in the future.
- [ ] 1.9 Situation tools for the agent (open/advance/resolve) registered as a built-in extension (ledger + situation access).
- [ ] 1.10 System prompt: teach the agent to consult and maintain situations; "watching" opens a Situation, not an `act`.
- [ ] 1.11 Tests: persistence across cycles, no-re-discovery, checkpoint revisit, escalation→situation resolution, storyline reconstruction.

## 1b. Renewals as a first-class input (renewal-source)

- [ ] 1b.1 Add a `RenewalSource` interface to `@cerebro-claw/shared` (`label`, `listOpen()`, `getContext(id)`, `writeBack(id, outcome)`) — parallel to `TaskSource`.
- [ ] 1b.2 Implement `StubRenewalSource` (in-memory) for tests/dev.
- [ ] 1b.3 Implement `CspRenewalSource`: derive the open-renewal queue per **D6** — iterate accounts + per-account `csp_get_renewals`, filter to `RENEWAL_WINDOW_DAYS` (default 90) or at-risk; reuse `CSP_*`.
- [ ] 1b.4 `RENEWAL_SOURCE=csp|stub|unset` selection mirroring `TASK_SOURCE`; unset → renewal sweep skipped (logged).
- [ ] 1b.5 Work loop: add the renewal sweep (independent of account/task sweeps); render renewal-context in the engine.
- [ ] 1b.6 Converge on the shared `renewal-risk` Situation (D2); dedup against open task/ledger linkage so renewal+task don't double-work.
- [ ] 1b.7 Drive each renewal through the four bands; write back via existing `renewal-writeback` tools; ledger entries link `renewalId` + `situationId`.
- [ ] 1b.8 Tests: renewal evaluated each cycle; empty source doesn't block others; renewal+account+task converge on one Situation; renewal-with-open-task not worked twice.

## 2. Vocabulary (Thread 3)

- [ ] 2.1 Write the canonical glossary into `CLAUDE.md` and a `docs/glossary.md`.
- [ ] 2.2 Rename the web "Pipeline" page to "Activity"; remove "Agent Task Stream" wording.
- [ ] 2.3 Audit UI labels, API field names, and docs for forbidden synonyms (Pipeline / Task-as-activity); align to glossary.
- [ ] 2.4 Confirm the Tasks page renders only CSP work-items with a clear "no task source configured" empty state.
- [ ] 2.5 Rename "Brain Loop" → "Work Loop" in code comments, logs, and docs; name the account/task sweeps.

## 3. Loop framing (Thread 2)

- [ ] 3.1 Re-tell `CLAUDE.md` architecture section as Perceive → Decide → Act → Remember.
- [ ] 3.2 Add `docs/architecture.md` with the loop diagram and the module-to-phase mapping table.
- [ ] 3.3 (Optional) Reorganize `server/src` so Perceive (`engine/`), Decide, Act, Remember are visibly grouped.

## 4. Extension surface (Thread 4)

- [ ] 4.1 Write `docs/extending.md` — the seven-seam map with interface + registration + minimal example each.
- [ ] 4.2 Refactor the four-band policy into a registered set (enumerable at runtime), default = the existing four, behavior identical.
- [ ] 4.3 Add the band-registration seam to `ExtensionAPI` (register a band: id, tool, guidance) — no built-in behavior change.
- [ ] 4.4 Add `SituationStore` to the extension-surface map as a swappable persistence seam.
- [ ] 4.5 Tests: bands enumerable and default-identical; a registered extra band becomes available without core edits.

## 5. Resolved decisions (see design.md §Decisions — now reflected in specs)

- [x] 5.1 **D1** Observe-only = a Situation, no fifth band. Bands stay four.
- [x] 5.2 **D2** Situations keyed by `(businessId, kind)` with `kind` a closed enum; one open per key; both sweeps converge.
- [x] 5.3 **D3** `nextCheckpoint` agent-chosen, default 72h, clamped `[1h, 30d]`.
- [x] 5.4 **D4** Start fresh — no history back-fill (optional later).
- [x] 5.5 **D5** Keep three-number headline; the third number becomes "N situations need you," each expandable to its storyline.
- [x] 5.6 **D6** Renewal queue derived from accounts + `csp_get_renewals`, filtered to `RENEWAL_WINDOW_DAYS` (default 90) or at-risk.
- [x] 5.7 **D7** Task-first for steps; renewal sweep owns no-task renewals, renewal-level status, and the shared Situation.
