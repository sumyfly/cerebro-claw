# closed-loop-perception Specification (delta)

## ADDED Requirements

### Requirement: Recent agent actions in the decision context

The per-account decision context built by the brain loop SHALL include the account's most recent action-ledger entries (default 5), each showing band, summary, status, age, and any failure note, so the agent observes the outcomes of its own past actions before deciding.

#### Scenario: Prior notify visible next cycle

- **WHEN** an account is reviewed and it has a notify-then-act entry executed 5 days ago
- **THEN** the decision context contains a recent-actions block listing that entry with its status and age

#### Scenario: Failed action surfaced to the agent

- **WHEN** an account has a `failed` ledger entry from a prior cycle
- **THEN** the decision context shows the failure and its note so the agent can retry, escalate, or adjust

### Requirement: Ledger queryable by customer

The `ActionLedger` SHALL expose listing the most recent entries for a single customer, ordered newest first, with a count limit.

#### Scenario: Recent entries fetched per account

- **WHEN** the brain loop builds context for customer X with limit 5
- **THEN** the ledger returns at most 5 of X's entries, newest first
