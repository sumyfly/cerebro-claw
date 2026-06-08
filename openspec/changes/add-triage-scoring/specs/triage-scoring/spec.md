# triage-scoring Specification

## Purpose

Rank subjects (accounts, tasks, renewals) by a cheap, deterministic triage score (risk × value × urgency) computed from existing signals, and have the work loop spend its agent turns only on the top-ranked subjects above a floor — deferring the rest (logged) so attention goes where it matters and the loop scales to large portfolios.

## ADDED Requirements

### Requirement: Deterministic triage score from existing signals

The system SHALL compute a triage score for a subject from already-available signals — combining risk (health/usage trend), value (ARR/contract size), and urgency (renewal proximity, overdue, and due Situation checkpoints) — using pure arithmetic, with NO model/LLM call. The result SHALL include the overall score and its component breakdown.

#### Scenario: Score is computed without a model call

- **WHEN** a subject's signals are available
- **THEN** a triage score and its risk/value/urgency breakdown are produced synchronously without any LLM call

#### Scenario: Higher risk/value/urgency ranks higher

- **WHEN** two subjects are equal except one has worse health (or larger ARR, or a nearer renewal)
- **THEN** that subject receives the higher triage score

### Requirement: The work loop spends agent turns by rank, under a budget

Each cycle, the work loop SHALL rank the cycle's candidate subjects by triage score and evaluate (spend an `agent.prompt` turn on) only those in the top `TRIAGE_MAX` whose score meets `TRIAGE_MIN_SCORE`. Subjects below the floor or beyond the budget SHALL be deferred (no agent turn) for that cycle.

#### Scenario: Only top-ranked subjects get an agent turn

- **WHEN** a cycle has more candidate subjects than `TRIAGE_MAX`
- **THEN** only the top `TRIAGE_MAX` (above the floor) are evaluated, and the rest are deferred

#### Scenario: A calm portfolio costs near-zero turns

- **WHEN** every subject scores below `TRIAGE_MIN_SCORE`
- **THEN** no agent turns are spent that cycle

### Requirement: Deferred subjects are skipped, not dropped

A deferred subject SHALL remain a candidate in future cycles; because the score is recomputed each cycle from fresh signals, a worsening subject SHALL rise in rank and eventually be worked. The system SHALL NOT permanently exclude any subject.

#### Scenario: A worsening deferred subject resurfaces

- **WHEN** a subject deferred in one cycle has materially worse signals in a later cycle
- **THEN** its triage score rises and it is evaluated once it enters the top `TRIAGE_MAX` above the floor

### Requirement: Triage coverage is observable — no silent truncation

The system SHALL make triage decisions visible: the number of subjects evaluated vs deferred SHALL be logged each cycle, and the ranked queue (with deferred subjects and the reason — below floor / over budget) SHALL be queryable.

#### Scenario: Deferred count is logged each cycle

- **WHEN** a cycle defers one or more subjects
- **THEN** it logs how many were evaluated and how many were deferred

#### Scenario: The ranked queue is queryable

- **WHEN** the triage queue is requested
- **THEN** subjects are returned in score order with their breakdown, including which were deferred and why
