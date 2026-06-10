# account-triage-gate Specification (delta)

## ADDED Requirements

### Requirement: Change-detection gate skips unchanged accounts

The account sweep SHALL skip an account without spending an agent turn when its current signal fingerprint equals the last recorded fingerprint AND it has no open Situation AND no renewal within the configured horizon. Skipped accounts SHALL be counted and logged per cycle. An account SHALL NOT be skipped indefinitely: after a configured maximum age (default 7 days) since its last agent review, it SHALL be reviewed even if unchanged.

#### Scenario: Unchanged steady account skipped

- **WHEN** a cycle runs and an account's fingerprint is unchanged with no open Situation and no near renewal
- **THEN** no agent turn is spent on it and the cycle log reports it as skipped

#### Scenario: Changed account reviewed

- **WHEN** an account's fingerprint differs from the last recorded one
- **THEN** the account is eligible for triage selection and agent review

#### Scenario: Stale account force-reviewed

- **WHEN** an account has been skipped for longer than the maximum skip age
- **THEN** it is reviewed this cycle despite an unchanged fingerprint

### Requirement: Account triage ranks by real signals

Account triage SHALL score candidates from real inputs — health-score delta since last cycle, days to renewal, contract value, and forced-band overrides — replacing the constant score. Higher-risk accounts SHALL rank first when the per-sweep cap selects work.

#### Scenario: Health drop outranks steady account

- **WHEN** the sweep cap selects fewer accounts than are eligible and account A's health dropped while account B is unchanged on every signal
- **THEN** account A is selected before account B
