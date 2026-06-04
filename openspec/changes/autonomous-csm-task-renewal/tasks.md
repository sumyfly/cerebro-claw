## 1. Shared types & task abstraction

- [x] 1.1 Add `TaskRecord` and `TaskOutcome` types to `@cerebro-claw/shared` (task id, title, status, optional `businessId`/`renewalId`, context fields).
- [x] 1.2 Add the `TaskSource` interface to `@cerebro-claw/shared`: `label`, `listOpen()`, `getContext(id)`, `writeBack(id, outcome)`.
- [x] 1.3 Implement `StubTaskSource` (in-memory, like `StubCustomerChannel`) returning seed open tasks for tests/dev.
- [x] 1.4 Unit-test the stub: list returns open tasks, writeBack closes one, closed tasks drop from `listOpen()`.

## 2. Task connector extension & tools

- [x] 2.1 Scaffold task tools. **Deviation:** placed `createTaskTools` in `packages/tools` + a built-in `task-tools` extension (not `extensions/task-connector/`) because filesystem extensions have no `ActionLedger` access via `ExtensionAPI`; this matches the `action-policy` built-in precedent. The real backend transport (group 8) still binds behind the `TaskSource` interface.
- [x] 2.2 Register `task_list_open` tool (lists the CSM's open tasks via the configured `TaskSource`).
- [x] 2.3 Register `task_get` tool (fetch one task's full context by id, with id validation).
- [x] 2.4 Register `task_complete` / `task_block` tool(s) that write back an outcome and record an `action_ledger` entry tagged with the task id.
- [x] 2.5 Return structured errors (not throws) on invalid id or backend rejection; flip ledger entry to `failed` on write-back failure.
- [x] 2.6 Tests: tool validation, ledger linkage on completion, failed-write surfaced.

## 3. Brain loop task iteration

- [x] 3.1 Extend the brain loop to accept and iterate a `TaskSource` alongside the `AccountSource`.
- [x] 3.2 Render per-task decision context in the engine (task detail + linked account signals when `businessId` present), side-effect free.
- [x] 3.3 Ensure a cycle still completes when there are zero open tasks and when there are zero accounts.
- [x] 3.4 Skip tasks already acted on within a cycle via the ledger task-id link.
- [x] 3.5 Tests: open tasks prompt the agent once each; empty task source does not block account work.

## 4. Four-band policy over tasks

- [x] 4.1 Extend the system/review prompt so the agent classifies each task into Act / Notify-then-act / Escalate / Prep and closes it via the task tools.
- [x] 4.2 Verify Act/Notify auto-complete; Escalate leaves the task open pending `resolve_escalation`; Notify-then-act schedules via the dispatcher with a cancel window.
- [x] 4.3 Tests: routine task → Act + closed + ledger; high-stakes task → Escalate + open; customer-facing task → Notify-then-act pending send.

## 5. Renewal write-back

- [x] 5.1 Add `csp_update_renewal` (status/playbook) to `extensions/csp-connector/index.ts` with UUID validation and the existing timeout; add any needed renewal note write.
- [x] 5.2 Add agent guidance to advance renewals under the four bands (note=Act, nudge=Notify, brief=Prep, discount/contract=Escalate).
- [x] 5.3 Implement fallback-to-note/escalate when a mutation is not permitted; record what was/wasn't possible in the ledger.
- [x] 5.4 Tests: valid update succeeds; non-UUID rejected with no write; disallowed transition falls back and is logged.

## 6. Digest, dispatcher & config

- [x] 6.1 Confirm `/api/digest/counters` counts task + renewal actions from the ledger (add task-id tag to ledger entries if needed). Ledger entries carry `payload.taskId`; digest is band-driven so task acts/notifies/escalations count automatically (covered by task-endpoint test).
- [x] 6.2 Confirm the dispatcher sends notify-then-act task/renewal entries and records failures back to the ledger. Dispatcher is band/ledger-driven — task-originated notify-then-act entries dispatch unchanged.
- [x] 6.3 Add `TASK_API_BASE_URL`, `TASK_API_TOKEN`, `TASK_CSM_*` to `.env.example`; gate the `TaskSource` on them (skip + log when absent).

## 7. Ops console visibility

- [x] 7.1 Add a task-queue view to the web ops console showing open tasks, assigned band, and recorded outcome (new `Tasks` page + nav item, polls `GET /api/tasks`).
- [x] 7.2 Wire it to a read endpoint backed by the `TaskSource` + ledger (`GET /api/tasks`).
- [ ] 7.3 Manual UI verification per `docs/ui-verification.md`.

## 8. Backend binding (after backend confirmed)

- [x] 8.1 Resolved from the CSP source (`csp-v1-web`): tasks are **CSP CTA-derived tasks**. Read `GET /api/v1/tasks?scope=all&status=NOT_STARTED,IN_PROGRESS,BLOCKED` + `GET /tasks/:id`; account/renewal come via `cta.businessId`/`cta.renewalId`. Completion = `POST /tasks/:id/custom-fields` (required `renewalSignal` etc.) → `POST /csm-activities` (activityRequired) → `POST /tasks/:id/update {status}`. **Key alignment:** CSP's "band" is a due-date bucket, NOT the agent's action band — kept separate.
- [x] 8.2 Implemented `CspTaskSource` (`packages/server/src/csp-task-source.ts`) behind the `TaskSource` interface; extended `TaskRecord`/`TaskOutcome` with template `requiredFields` + `customFields` + `activity`; task tools accept `custom_fields`/`activity`; wired via `TASK_SOURCE=csp` (reuses `CSP_*`). Unit-tested with mocked fetch (+5 tests).
- [x] 8.3 **Verified live end-to-end** against CSP. Read: `listOpen` returns real `T-90/T-75/T-180` tasks, `getContext` maps `businessId`/`renewalId`/`renewalSignal`. Write: completed task `d8ef3fbf` (T-90 Satisfaction Survey - giannistrattoria) through the real `CspTaskSource.writeBack` — raw CSP now shows `status=COMPLETED`, `customFields={renewalSignal: Unsure}`, and a logged `MESSAGE` CSM activity. Full 3-step sequence confirmed.

## 9. Wrap-up

- [x] 9.1 `pnpm turbo build` and `pnpm turbo test` green across packages (282 tests, 10/10 turbo tasks).
- [x] 9.2 Biome (`pnpm check`) passes repo-wide.
- [x] 9.3 Update `CLAUDE.md` tool/extension tables and architecture notes for the task connector and renewal write-back.
