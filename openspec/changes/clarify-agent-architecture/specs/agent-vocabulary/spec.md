# agent-vocabulary Specification

## Purpose

Establish a canonical glossary — one concept, one name — and enforce it across the database, API, UI, and docs. This resolves the collisions that demonstrably confuse users: "Task" meaning both a CSP work-item and the action stream, and the single action ledger being called "Pipeline," "ledger," and "Activity" in different places.

## ADDED Requirements

### Requirement: Canonical glossary is the single source of truth

The project SHALL maintain a canonical glossary mapping each concept to exactly one user-facing term. At minimum it SHALL define:

| Concept | Canonical term | Must NOT be called |
|---|---|---|
| The agent's stream of recorded actions | **Activity** (storage: *ledger*) | "Pipeline", "Task Stream" |
| A CSP-assigned unit of work | **Task** | (reserved — not used for activity) |
| A persistent storyline of related actions | **Situation** | "watch"/"thread" as a *noun* (informal). Note: `watching` is a valid Situation **status** and is fine in that sense. |
| The per-cycle engine that runs the agent | **Work Loop** | "Brain Loop" (legacy) |
| One pass over accounts within a cycle | **account sweep** | — |
| One pass over tasks within a cycle | **task sweep** | — |
| One pass over renewals within a cycle | **renewal sweep** | — |
| The four action classes | **bands** (`act`/`notify-then-act`/`escalate`/`prep`) | (unchanged — preserve) |

#### Scenario: A concept resolves to one term

- **WHEN** any concept in the glossary is referenced in user-facing UI, API field names, or docs
- **THEN** the canonical term is used, and forbidden synonyms for that concept do not appear

### Requirement: "Task" is reserved for CSP work-items only

The word "Task" (in UI labels, page titles, and docs) SHALL refer exclusively to a CSP-assigned work-item exposed via the task source. The agent's action stream SHALL NOT be labeled with the word "Task."

#### Scenario: Activity view is not called a task stream

- **WHEN** the action-stream view is rendered
- **THEN** its title uses "Activity" and does not contain the word "Task"

#### Scenario: Tasks page reflects only CSP work-items

- **WHEN** the Tasks page is rendered
- **THEN** it shows CSP work-items, and is empty (with a clear "no task source configured" state) when no task source is configured — never populated from the action ledger

### Requirement: One name for the action stream end to end

The action stream SHALL be presented as **Activity** to users; internal storage MAY retain the `action_ledger`/`ledger` name, but no user-facing surface SHALL introduce a third synonym such as "Pipeline."

#### Scenario: No "Pipeline" in user-facing surfaces

- **WHEN** a user navigates the ops console
- **THEN** the action-stream page is labeled "Activity" and the term "Pipeline" does not appear as a page name

### Requirement: The four-band names are preserved verbatim

The vocabulary pass SHALL NOT rename the four bands. `act`, `notify-then-act`, `escalate`, and `prep` SHALL remain the canonical band identifiers everywhere.

#### Scenario: Band identifiers unchanged

- **WHEN** an action is classified into a band
- **THEN** the band is one of `act`, `notify-then-act`, `escalate`, `prep` with those exact names in tools, ledger, and UI
