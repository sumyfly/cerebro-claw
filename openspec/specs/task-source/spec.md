# task-source Specification

## Purpose

Decouple the brain loop from any specific task backend by defining a pluggable `TaskSource` abstraction and exposing task tools over MCP, so the agent can list, read, and write back tasks regardless of whether the backend is CSP task endpoints or a standalone Cerebro task system.

## Requirements

### Requirement: Pluggable task source abstraction

The system SHALL define a `TaskSource` abstraction in `@cerebro-claw/shared` that decouples the brain loop from any specific task backend. A `TaskSource` SHALL expose: listing open tasks for the current CSM, fetching a single task's full context, and writing back a task outcome (completed or blocked with a reason). The concrete backend (CSP task endpoints or a standalone Cerebro task system) SHALL be selectable via configuration without changes to the brain loop.

#### Scenario: Brain loop consumes any registered task source

- **WHEN** a `TaskSource` implementation is registered and the brain loop runs a cycle
- **THEN** the brain loop lists open tasks through the abstraction without referencing any backend-specific client

#### Scenario: Backend selected by configuration

- **WHEN** the task API base URL, token, and CSM identity are configured
- **THEN** the corresponding `TaskSource` is activated; **WHEN** they are absent, the loop SHALL skip task iteration and log that no task source is configured rather than erroring.

### Requirement: Task tools exposed over MCP

The system SHALL register task tools as `ToolDefinition`s through an extension so any MCP client (the Claude Code runtime) can call them. At minimum the tools SHALL cover: list open tasks, get a task by id, and complete/close a task with a result payload. Inputs SHALL be validated (task id format, required fields) and failures SHALL return a structured error rather than throwing.

#### Scenario: Agent lists and reads a task

- **WHEN** the agent calls the list-tasks tool followed by the get-task tool with a returned id
- **THEN** it receives the open task set and then that task's full context including the linked account where present

#### Scenario: Invalid task id rejected

- **WHEN** a task tool is called with a malformed task id
- **THEN** the tool returns a validation error and performs no write

### Requirement: Task write-back is recorded

The system SHALL ensure every task completion or block performed by the agent is written back to the task backend AND recorded in the `action_ledger`, linking the ledger entry to the originating task id.

#### Scenario: Completion lands in ledger and backend

- **WHEN** the agent completes a task
- **THEN** the task is marked done in the backend and a corresponding `action_ledger` entry references the task id

#### Scenario: Write-back failure is surfaced

- **WHEN** the task backend rejects a write-back
- **THEN** the ledger entry is recorded with a failed status and the failure is surfaced in the digest rather than silently dropped
