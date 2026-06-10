# loop-throughput Specification (delta)

## ADDED Requirements

### Requirement: Bounded parallel sweep evaluation

The brain loop SHALL evaluate sweep subjects (accounts, tasks, renewals) through a bounded concurrency pool configured by environment (default small, e.g. 3) instead of strictly serially. A concurrency of 1 SHALL reproduce current serial behavior. The overlap guard SHALL still prevent two cycles from running at once.

#### Scenario: Parallel evaluation within a cycle

- **WHEN** a cycle has 6 selected accounts and concurrency 3
- **THEN** at most 3 agent turns run at once and all 6 complete before the sweep ends

#### Scenario: Serial fallback

- **WHEN** concurrency is configured to 1
- **THEN** subjects are evaluated one at a time as today

### Requirement: Cheap model for the critic verifier

The critic verifier SHALL be runnable on a separately configured, cheaper/faster model than the main agent. The fail-safe SHALL be preserved: a verifier error blocks the gated action.

#### Scenario: Critic uses the configured cheap model

- **WHEN** a notify-then-act passes through the verify gate and a verifier model is configured
- **THEN** the critic turn runs on that model, not the main agent model

#### Scenario: Verifier failure still blocks

- **WHEN** the critic errors or times out
- **THEN** the gated action is blocked and recorded as failed with the verifier error
