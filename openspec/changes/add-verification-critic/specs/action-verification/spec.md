# action-verification Specification

## Purpose

Gate the high-stakes action bands (`notify-then-act`, `escalate`) with a pluggable verifier (critic) that checks an action follows from the subject's signals before it commits. Failing verification blocks the action and records why. This complements — does not replace — the override gate (policy floor) and the pause window (human cancel).

## ADDED Requirements

### Requirement: Pluggable verifier seam

The system SHALL define a `Verifier` abstraction that, given a proposed action (band, customer, summary, reason, and optional signals/situation/payload), returns a result `{ pass: boolean, reason: string, suggestedBand?: string }`. The verifier SHALL be swappable, with a default adversarial LLM critic and the ability to disable verification (a no-op verifier that always passes).

#### Scenario: Verifier returns a structured verdict

- **WHEN** the verifier is asked to verify a proposed action
- **THEN** it returns `pass` (boolean) and a human-readable `reason`, and MAY include a `suggestedBand`

#### Scenario: Verification can be disabled

- **WHEN** verification is disabled
- **THEN** every action proceeds exactly as it does without this feature (the verifier always passes)

### Requirement: High-stakes bands are verified before they commit

Before `notify_then_send_to_customer` schedules a customer send, and before `escalate` briefs the CSM, the system SHALL run the verifier. Verification SHALL run after the override gate and before the action is recorded/sent. The `act` and `prep` bands SHALL NOT be verified by default.

#### Scenario: Notify is verified before scheduling

- **WHEN** the agent calls `notify_then_send_to_customer` and verification is enabled
- **THEN** the verifier runs before the entry is recorded in-flight or any send is scheduled

#### Scenario: Act and prep are not gated

- **WHEN** the agent calls `act` or `prep`
- **THEN** no verification runs and the action proceeds as today

#### Scenario: Override gate runs first

- **WHEN** an action is both blocked by the override gate and would fail verification
- **THEN** the override block is returned and the verifier is not invoked

### Requirement: A failed verification blocks the action and is recorded

When the verifier returns `pass: false`, the action SHALL NOT be taken: no customer send is scheduled and no needs-csm escalation is created. The system SHALL record the blocked attempt (a `failed`-status ledger entry whose note carries the verifier's reason) and return a failure result to the agent so it can choose a different band or take no action. The system SHALL NOT silently rewrite the action to a different band.

#### Scenario: Failed verification stops a customer send

- **WHEN** the verifier fails a `notify_then_send_to_customer` action
- **THEN** no send is scheduled, a `failed` ledger entry with the verifier's reason is recorded, and the tool returns a failure result

#### Scenario: Failed verification is visible

- **WHEN** an action is blocked by the verifier
- **THEN** it appears in the Activity log / digest as a failed action with the critic's reason, not silently dropped

#### Scenario: Passed verification proceeds normally

- **WHEN** the verifier passes an action
- **THEN** the action is recorded and (for notify) scheduled exactly as without verification, including the existing pause window
