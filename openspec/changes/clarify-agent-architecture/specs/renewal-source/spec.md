# renewal-source Specification

## Purpose

Make **Renewals** a first-class input the work loop sweeps directly — not only reached via an account or a task. The domain hierarchy is **Renewal → CTA → Task**: a Renewal is the commercial object, a CTA binds work to it, and a Task is a discrete step spawned under the CTA (carrying `cta.renewalId`). Upcoming and at-risk renewals are the highest-value, most time-sensitive CSM work; a dedicated **renewal sweep** lets the agent work them on the renewal timeline (T-90 / T-60 / T-30) and converge with the account and task sweeps on a single `renewal-risk` Situation keyed by `renewalId`. Write-back reuses the existing `renewal-writeback` capability.

## ADDED Requirements

### Requirement: Pluggable renewal source abstraction

The system SHALL expose the CSM's upcoming and at-risk renewals behind a `RenewalSource` abstraction (`label`, `listOpen()`, `getContext(id)`, `writeBack(id, outcome)`), parallel to `AccountSource` and `TaskSource`, so the backing API can be swapped. Source selection SHALL mirror the task source: `RENEWAL_SOURCE=csp` binds the live CSP renewals (reusing `CSP_*`); `=stub` uses an in-memory queue; unset SHALL skip the renewal sweep and log that it was skipped. Because CSP exposes renewals only per account, the CSP-backed `listOpen()` SHALL derive its queue by iterating the CSM's accounts and collecting renewals that are within a due-window (`RENEWAL_WINDOW_DAYS`, default 90) or already flagged at-risk.

#### Scenario: Queue is limited to the due/at-risk window

- **WHEN** the CSP-backed renewal source builds its queue
- **THEN** it includes renewals due within `RENEWAL_WINDOW_DAYS` or flagged at-risk, and excludes renewals outside that window that are not at-risk

#### Scenario: Configured renewal source lists renewals

- **WHEN** `RENEWAL_SOURCE=csp` and the CSM has upcoming renewals
- **THEN** `listOpen()` returns those renewals for the renewal sweep to work

#### Scenario: Unset renewal source skips the sweep

- **WHEN** `RENEWAL_SOURCE` is unset
- **THEN** the renewal sweep is skipped (logged) and the account and task sweeps still run

### Requirement: Work loop runs a renewal sweep

The work loop SHALL iterate open renewals each cycle in a named **renewal sweep**, independent of the account sweep and the task sweep, building a side-effect-free per-renewal context (renewal record plus linked account signals). Each renewal SHALL be run through the four-band action policy and advanced via the `renewal-writeback` tools; every action SHALL land in the action ledger.

#### Scenario: Upcoming renewal evaluated each cycle

- **WHEN** a work-loop cycle runs and the renewal source reports open renewals
- **THEN** the agent is prompted once per open renewal with that renewal's context

#### Scenario: Empty renewal source does not block other sweeps

- **WHEN** the renewal source reports zero open renewals
- **THEN** the account and task sweeps still run and the cycle completes without error

### Requirement: Renewal work converges on one situation keyed by renewalId

A renewal worked via the renewal sweep SHALL open or advance the single `renewal-risk` Situation for that renewal, keyed on `renewalId` (see situation-threads identity rule). This is the same thread the task sweep converges on via the task's `cta.renewalId`, and the account sweep converges on via the account's renewals. It SHALL NOT create a second situation when an open `renewal-risk` situation already exists for that `renewalId`.

#### Scenario: Renewal sweep and task sweep converge on the renewal's thread

- **WHEN** the renewal sweep works renewal R and a renewal-reminder task with `cta.renewalId = R` is also worked by the task sweep
- **THEN** both advance the single `renewal-risk` Situation keyed on `renewalId = R`, not two

### Requirement: A task is a sub-step of its renewal, not a competing duplicate

Because the domain hierarchy is **Renewal → CTA → Task**, a renewal-reminder task is a discrete *step* in working its renewal, not a separate piece of work. The renewal sweep and task sweep SHALL coordinate through the shared per-`renewalId` Situation and the ledger's `renewalId` linkage so the same step is not performed twice in a cycle, while still allowing the renewal sweep to handle renewal-level work that no task covers.

#### Scenario: Step already handled by a task is not repeated by the renewal sweep

- **WHEN** a renewal's current step is already being handled as an open task (or an in-flight ledger action linked to that `renewalId`)
- **THEN** the renewal sweep does not repeat that step in the same cycle, but MAY still act on renewal-level work not represented by any task

#### Scenario: Renewal with no task is still worked

- **WHEN** a renewal is at risk but has no associated open CSP task
- **THEN** the renewal sweep works it directly through the four bands rather than waiting for a task to exist

### Requirement: Renewal and task are independent status levels

A renewal and a task are **two levels, each with its own status lifecycle.** The renewal carries its own renewal/playbook status, advanced only via the `renewal-writeback` tools (e.g. `csp_update_renewal`). A task carries its own status (`NOT_STARTED` / `IN_PROGRESS` / `BLOCKED` / `COMPLETED`), advanced only via the task tools (`task_complete` / `task_block`). The renewal sweep SHALL advance the renewal's status and SHALL NOT write task status; the task sweep SHALL advance task status and SHALL NOT write renewal status. Neither of these CSP statuses SHALL be mapped onto the other, nor onto the agent's action bands, nor onto the Situation's `status` — these are four distinct concepts.

#### Scenario: Renewal sweep advances renewal status only

- **WHEN** the renewal sweep advances a renewal via `renewal-writeback`
- **THEN** the renewal's own status changes and no task's status is altered as a side effect

#### Scenario: Completing a task does not move the renewal status

- **WHEN** the task sweep completes a renewal-reminder task via `task_complete`
- **THEN** the task's status becomes `COMPLETED` and the renewal's status is unchanged unless the renewal sweep separately advances it via `renewal-writeback`
