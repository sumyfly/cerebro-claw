# task-autopilot Specification (delta)

## RENAMED Requirements

- FROM: `### Requirement: Brain loop iterates open tasks`
- TO: `### Requirement: Work loop iterates open tasks`

## MODIFIED Requirements

### Requirement: Work loop iterates open tasks

The **work loop** (formerly "brain loop") SHALL iterate the CSM's open tasks each cycle in a named **task sweep**, in addition to the **account sweep**, building a side-effect-free per-task context (task detail plus linked account signals where available) that is fed to the agent. Before deciding, the task sweep SHALL load any open Situations linked to the task's account so the agent does not re-discover an in-flight storyline. Task iteration SHALL remain independent of account iteration so either sweep can run when the other has nothing to do.

#### Scenario: Open tasks evaluated each cycle

- **WHEN** a work-loop cycle runs and the task source reports open tasks
- **THEN** the agent is prompted once per open task with that task's context, including any open Situations for the linked account

#### Scenario: No tasks does not block account work

- **WHEN** the task source reports zero open tasks
- **THEN** the account sweep still runs and the cycle completes without error

#### Scenario: Task work does not re-discover an open situation

- **WHEN** a task's account already has a `watching` Situation whose `nextCheckpoint` is in the future
- **THEN** the agent advances or appends to that Situation rather than opening a duplicate, and any action it records is linked to that Situation
