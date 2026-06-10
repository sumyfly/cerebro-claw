# console-approvals Specification (delta)

## ADDED Requirements

### Requirement: Pending sends listable and cancellable via the API

The system SHALL expose in-flight notify-then-act entries (`GET /api/actions/pending`) and a cancel transition (`POST /api/actions/:id/cancel`) that moves an entry to `cancelled` through the same validation as `cancel_pending_action`. (A dedicated Pending page was built and then removed by product decision — in-flight sends remain visible read-only on the Activity board; cancellation is API-only.)

#### Scenario: CSM cancels a pending send via the API

- **WHEN** a cancel is posted for a pending send before its `executeAt`
- **THEN** the entry becomes `cancelled` and the dispatcher never sends it

### Requirement: Escalations visible and resolvable in the console

The web console SHALL list all `needs-csm` escalations with situation, options, and recommendation, and SHALL let the CSM record their decision, transitioning the entry to `resolved` through the same path as `resolve_escalation`.

#### Scenario: CSM resolves an escalation

- **WHEN** the CSM submits a decision on an open escalation
- **THEN** the entry becomes `resolved` with the outcome recorded and leaves the needs-csm digest count

### Requirement: Approval endpoints under admin auth

The cancel/resolve endpoints SHALL live under `/api/*` with the same bearer-token auth as the rest of the admin API, performing the same ledger state validation as the tools (only in-flight entries cancel; only needs-csm escalations resolve).

#### Scenario: Invalid transition rejected

- **WHEN** a cancel is requested for an entry that is already `executed`
- **THEN** the API returns an error and the entry is unchanged
