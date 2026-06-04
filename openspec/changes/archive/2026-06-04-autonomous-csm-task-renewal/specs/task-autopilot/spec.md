## ADDED Requirements

### Requirement: Brain loop iterates open tasks

The brain loop SHALL iterate the CSM's open tasks each cycle, in addition to iterating accounts, building a side-effect-free per-task context (task detail plus linked account signals where available) that is fed to the agent. Task iteration SHALL be independent of account iteration so either can run when the other has nothing to do.

#### Scenario: Open tasks evaluated each cycle

- **WHEN** a brain-loop cycle runs and the task source reports open tasks
- **THEN** the agent is prompted once per open task with that task's context

#### Scenario: No tasks does not block account work

- **WHEN** the task source reports zero open tasks
- **THEN** the cycle still evaluates accounts and completes without error

### Requirement: Tasks run through the four-band action policy

For each task, the agent SHALL classify the work into exactly one band — Act, Notify-then-act, Escalate, or Prep — and take the corresponding action end-to-end using the existing action-policy tools. Approval SHALL be required only for the Escalate band; Act and Notify-then-act SHALL complete the task autonomously, and Prep SHALL ship a finished v1 for a CSM-owned conversation.

#### Scenario: Routine task auto-completed

- **WHEN** the agent classifies a task as Act
- **THEN** it performs the work, closes the task, and logs the outcome to the ledger without waiting for human approval

#### Scenario: High-stakes task escalated

- **WHEN** a task is irreversible, high-stakes, or ambiguous
- **THEN** the agent classifies it as Escalate, briefs the CSM with situation/options/recommendation, leaves the task open, and waits for `resolve_escalation`

#### Scenario: Customer-facing task paused before send

- **WHEN** the agent classifies a task as Notify-then-act
- **THEN** it notifies the CSM immediately and schedules the customer send after the pause window, cancellable via `cancel_pending_action`

### Requirement: Task outcomes are reportable in the digest

Task actions SHALL feed the same `action_ledger` so the daily digest counters and the dispatcher cover them without a separate reporting surface.

#### Scenario: Task actions counted in digest

- **WHEN** the agent completes tasks across a day
- **THEN** `/api/digest/counters` reflects those acts/notifies/escalations alongside account actions

### Requirement: Task queue visible in the ops console

The admin ops console SHALL surface the open task queue and the agent-driven outcome for each task so a CSM can see what the agent picked up and what it did.

#### Scenario: CSM reviews agent task activity

- **WHEN** a CSM opens the ops console
- **THEN** they can see open tasks, their assigned band, and the recorded outcome for completed ones
