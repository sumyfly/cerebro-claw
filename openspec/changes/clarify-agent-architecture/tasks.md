# Tasks — Clarify Agent Architecture

> Planning only — captured during explore mode. Nothing here is implemented yet.
> Ordered by the design's ship sequence: Situations → vocabulary → loop framing → extension surface.

## 1. Situations (Thread 1 — the load-bearing change)

- [x] 1.1 Add `Situation` and `SituationStatus` types to `@cerebro-claw/shared` (id, businessId, kind, title, status, openedAt, nextCheckpoint?, waitingFor?, needsAttention). Timeline is derived from ledger rows linked by `situationId` — not a stored field. **Also added `resolveNextCheckpoint`/`situationNeedsCsm` helpers.**
- [x] 1.2 Add optional `situationId` (and `renewalId`) to the action/ledger types; persisted in both ledger impls (SQLite via additive `ALTER TABLE`).
- [x] 1.3 Define a `SituationStore` interface (open, get, findOpen, listOpen, listNeedingCsm, listWatching, update, resolve) in shared.
- [x] 1.4 Implement an in-memory `SituationStore` for tests/dev.
- [x] 1.5 Implement the SQLite `SituationStore` + `situations` table in `@cerebro-claw/memory` (partial-unique index enforces the identity invariant).
- [x] 1.6 Perceive: account sweep loads open situations via `renderSituations` and injects them into the agent's context. (task-context wiring pending in group 1b.)
- [x] 1.7 Remember: situation lifecycle agent-driven via `situation_open/advance/resolve`; the four action-policy tools now accept optional `situation_id`/`renewal_id` and stamp the ledger link.
- [x] 1.8 Dedup-by-situation: a `watching` situation whose checkpoint hasn't passed is surfaced as an explicit "leave it" signal in context; the agent advances rather than re-flags (no `act` duplicate).
- [x] 1.9 Situation tools (open/advance/resolve/list) created in `@cerebro-claw/tools` and registered via the built-in `situation-tools` extension wired in `app.ts`.
- [x] 1.10 System prompt: added the "Situations — your memory across cycles" section ("watching" opens a Situation, not an `act`).
- [x] 1.11 Tests: store-level (idempotent open, two-renewals-two-situations, checkpoint default/clamp, needs-CSM, resolve) + brain-loop renewal-sweep convergence test (no duplicate situation across cycles).

## 1b. Renewals as a first-class input (renewal-source)

- [x] 1b.1 Added a `RenewalSource` interface to `@cerebro-claw/shared` (`label`, `listOpen()`, `getContext(id)`); write-back reuses `csp_update_renewal`, so the source is read-only.
- [x] 1b.2 Implemented `StubRenewalSource` (in-memory) in `@cerebro-claw/tools`.
- [x] 1b.3 Implemented `createCspRenewalSource` (D6): iterate accounts + per-account renewals, filter to `RENEWAL_WINDOW_DAYS` (default 90) or at-risk.
- [x] 1b.4 `RENEWAL_SOURCE=csp|stub|unset` selection in `config.ts` + `app.ts` (unset → renewal sweep skipped, logged). `.env.example` documented.
- [x] 1b.5 Work loop: `cycleRenewals()` + `evaluateRenewal()` (independent sweep); `renderRenewalContext` in the engine.
- [x] 1b.6 Converge on the shared per-`renewalId` `renewal-risk` Situation; situations injected into the renewal context; `RENEWAL_GUIDANCE` instructs task-first / don't-double-work.
- [x] 1b.7 Drive each renewal through the four bands; ledger entries link `renewalId` + `situationId` via the action tools.
- [x] 1b.8 Tests: `StubRenewalSource` list/fetch; renewal sweep opens a renewal-scoped situation + links the ledger; converges (no duplicate) across cycles.

## 2. Vocabulary (Thread 3)

- [x] 2.1 Canonical glossary written to `docs/glossary.md`; `CLAUDE.md` Source-docs section points to it.
- [x] 2.2 Web "Pipeline" page → "Activity" (nav label + page title "ACTIVITY — AGENT ACTION STREAM"); "Agent Task Stream" wording removed.
- [x] 2.3 Audited web — no user-facing "Pipeline"/"Task Stream" remains (only the internal component symbol).
- [x] 2.4 Confirmed: Tasks page renders only CSP work-items, with a "NO TASK SOURCE BOUND — SET TASK_SOURCE=CSP" empty state.
- [x] 2.5 `[brain-loop]` logs → `[work-loop]`; sweeps named (account/task/renewal) in code + docs. (Class symbol `BrainLoop` kept internally.)

## 3. Loop framing (Thread 2)

- [x] 3.1 `CLAUDE.md` architecture section re-told as Perceive → Decide → Act → Remember (Work Loop + three sweeps).
- [x] 3.2 Added `docs/architecture.md` with the loop diagram + phase→code mapping + the three-sweep inputs table.
- [~] 3.3 (Optional) Physical `server/src` reorg deferred — `engine/` already groups Perceive; the phase mapping is documented rather than enforced by folders.

## 4. Extension surface (Thread 4)

- [x] 4.1 Wrote `docs/extending.md` — the seam map with interface + registration + a minimal extension example.
- [x] 4.2 Action policy is a registered set: `ExtensionHost.getBands()` seeded with `DEFAULT_BANDS` (the four), behavior identical.
- [x] 4.3 Added `registerBand(ActionBandDef)` to `ExtensionAPI` + `ExtensionHost` (dedupes by id) — no built-in behavior change.
- [x] 4.4 `SituationStore` listed in the `docs/extending.md` persistence seam alongside `MemoryStore`/`ActionLedger`.
- [x] 4.5 Tests: `extension-host-bands` — enumerates default four, an extension adds a band, duplicate id ignored.

## 5. Resolved decisions (see design.md §Decisions — now reflected in specs)

- [x] 5.1 **D1** Observe-only = a Situation, no fifth band. Bands stay four.
- [x] 5.2 **D2** Situations keyed by `(businessId, kind)` with `kind` a closed enum; one open per key; both sweeps converge.
- [x] 5.3 **D3** `nextCheckpoint` agent-chosen, default 72h, clamped `[1h, 30d]`.
- [x] 5.4 **D4** Start fresh — no history back-fill (optional later).
- [x] 5.5 **D5** Keep three-number headline; the third number becomes "N situations need you," each expandable to its storyline.
- [x] 5.6 **D6** Renewal queue derived from accounts + `csp_get_renewals`, filtered to `RENEWAL_WINDOW_DAYS` (default 90) or at-risk.
- [x] 5.7 **D7** Task-first for steps; renewal sweep owns no-task renewals, renewal-level status, and the shared Situation.
