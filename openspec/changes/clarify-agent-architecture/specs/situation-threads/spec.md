# situation-threads Specification

## Purpose

Give the agent a first-class, persistent **Situation** (a thread) so it works like a human CSM: a situation groups related ledger actions into one storyline, survives across work-loop cycles, knows when it next needs attention, and closes when resolved. Situations are loaded during Perceive and maintained during Remember, eliminating the cross-cycle re-discovery where the agent re-flags the same risk every cycle.

## ADDED Requirements

### Requirement: Situation is a first-class persistent entity

The system SHALL persist a `Situation` as durable, mutable state separate from the append-only action ledger and from free-form instinct memory. A Situation SHALL carry at minimum: a stable id, the account it concerns (`businessId`), a `kind` from a closed enum (`renewal-risk`, `adoption-gap`, `support-escalation`, `relationship-change`, `billing-issue`, `other`), an optional `renewalId` (set for renewal-scoped situations — the join through which a CTA's tasks and the renewal itself converge), a human-readable title, a `status` of `open` | `watching` | `escalated` | `resolved`, an `openedAt`, an optional `nextCheckpoint` timestamp, an optional `waitingFor` note, and a `needsAttention` boolean (default `false`) that marks an `open` or `watching` situation the CSM should look at even though it is not yet `escalated`. A situation "needs the CSM" when its `status` is `escalated` OR its `needsAttention` flag is `true`. The Situation's timeline is NOT a stored field — it is derived by querying the ledger entries linked to the situation's id.

#### Scenario: Situation persists across cycles

- **WHEN** a situation is opened in one work-loop cycle
- **THEN** it is still retrievable in subsequent cycles with its status and timeline intact, until it is resolved

#### Scenario: Situation is distinct from a ledger entry

- **WHEN** the agent records an action and also maintains a situation
- **THEN** the action is appended to the ledger immutably **and** the situation is updated in place — the two are stored separately, not merged

### Requirement: Situation identity scopes account-level vs renewal-level threads

A Situation SHALL be uniquely identified while unresolved by `(businessId, kind)` for account-level kinds. For **renewal-scoped** situations (`kind = renewal-risk`), identity SHALL additionally include `renewalId` — `(businessId, kind, renewalId)` — because one account can have multiple distinct renewals, each its own storyline. The system SHALL NOT hold more than one non-`resolved` Situation for the same identity. The account, task, and renewal sweeps SHALL look up open Situations by `businessId` (and `renewalId` where applicable) and match on `kind`, so a storyline reached from any sweep converges on the same thread.

Because a CSP Task is bound to a renewal through its CTA (the task carries `cta.renewalId`), a renewal-reminder task and the renewal itself resolve to the **same** `renewalId` and therefore the same Situation.

#### Scenario: Task and renewal converge via the CTA's renewalId

- **WHEN** a renewal-reminder task (whose `cta.renewalId` = R) is reached from the task sweep, and the same renewal R is reached from the renewal sweep
- **THEN** both resolve to the single open `renewal-risk` Situation keyed on `renewalId = R`, and no second one is created

#### Scenario: Two renewals on one account get two situations

- **WHEN** an account has two distinct open renewals, R1 and R2, both at risk
- **THEN** two distinct `renewal-risk` Situations exist — one per `renewalId` — and they are not collapsed into one

#### Scenario: Duplicate open situation is rejected

- **WHEN** an attempt is made to open a Situation whose identity already has a non-`resolved` Situation
- **THEN** the existing Situation is returned/advanced instead of creating a duplicate

### Requirement: Perceive loads open situations before deciding

For each account or task it evaluates, the work loop SHALL load that subject's open (non-`resolved`) situations and include them in the decision context given to the agent, so the agent can see what is already in flight before choosing an action.

#### Scenario: Agent sees an existing open situation

- **WHEN** the work loop evaluates an account that already has an `open` or `watching` situation
- **THEN** the agent's decision context includes that situation's title, status, timeline summary, and `waitingFor`

### Requirement: No cross-cycle re-discovery

When a subject already has a `watching` situation whose `nextCheckpoint` has not yet passed, the agent SHALL NOT create a new duplicate situation or a new ledger action for the same condition. It SHALL instead leave the situation untouched or append an update to the existing thread.

#### Scenario: Same risk is not re-flagged

- **WHEN** an account has a `watching` renewal-risk situation with a future `nextCheckpoint`, and the same risk signals are still present
- **THEN** the agent does not open a second situation and does not log a duplicate `act`; the existing situation is carried forward unchanged

#### Scenario: Checkpoint reached triggers a real re-evaluation

- **WHEN** a `watching` situation's `nextCheckpoint` has passed
- **THEN** the agent re-evaluates the subject and either advances the situation (new timeline entry / status change) or resolves it — a deliberate revisit, not a blind re-discovery

### Requirement: nextCheckpoint is agent-chosen with a default and bounds

When the agent puts a Situation into `watching`, it MAY set `nextCheckpoint` to a time appropriate to the situation. If it does not, the system SHALL default `nextCheckpoint` to 72 hours out. Any `nextCheckpoint` (agent-chosen or default) SHALL be clamped to the range `[1 hour, 30 days]` from now.

#### Scenario: Agent-chosen checkpoint is honored

- **WHEN** the agent sets a `nextCheckpoint` within the allowed bounds
- **THEN** that value is stored and used to gate the next re-evaluation

#### Scenario: Missing checkpoint defaults

- **WHEN** a Situation is set to `watching` with no `nextCheckpoint`
- **THEN** the system assigns a checkpoint 72 hours out

#### Scenario: Out-of-bounds checkpoint is clamped

- **WHEN** a `nextCheckpoint` is set earlier than 1 hour or later than 30 days from now
- **THEN** it is clamped to the nearest bound

### Requirement: Ledger actions link to their situation

Every action-policy action (act / notify-then-act / escalate / prep) taken in service of a situation SHALL carry that situation's id, so the activity stream can render a situation as one storyline.

#### Scenario: Action carries situation linkage

- **WHEN** the agent takes an action that belongs to an open situation
- **THEN** the recorded ledger entry references that situation's id

#### Scenario: Storyline is reconstructable

- **WHEN** the activity view requests a situation's history
- **THEN** all ledger entries linked to that situation are returned in chronological order as one thread

### Requirement: Situations have a closing lifecycle

The agent SHALL be able to move a situation to `resolved` when the condition no longer holds (recovered, renewed, churned, or decided), and an `escalated` situation SHALL move to `resolved` when the corresponding escalation is resolved by the CSM. Resolved situations SHALL drop out of the Perceive load.

#### Scenario: Resolved situation leaves the loop

- **WHEN** a situation is marked `resolved`
- **THEN** subsequent cycles do not surface it in the agent's decision context

#### Scenario: Resolving an escalation resolves its situation

- **WHEN** a CSM resolves an escalation that is linked to an `escalated` situation
- **THEN** that situation transitions to `resolved`

### Requirement: Situations needing the CSM are surfaced

The digest and ops console SHALL be able to report the count and list of situations that need the CSM (status `escalated`, or `open`/`watching` flagged as needs-attention), as a storyline-level view rather than a flat event count. In the digest headline, the third number — the item the CSM acts on — SHALL be expressed as situations needing the CSM, alongside the existing act and notify counts, and each SHALL be expandable to its storyline. The act count SHALL NOT include pure observation (see the observe-only behavior in extension-surface).

#### Scenario: Digest headline reframes the "need you" number as situations

- **WHEN** the digest is generated and N situations need the CSM
- **THEN** the headline reads in the form "… , N situations need you" alongside the act and notify-in-flight counts, and each of the N is expandable to its linked ledger storyline

#### Scenario: A separate watched-situations metric is available

- **WHEN** the digest or ops console reports agent state
- **THEN** a count of situations in `watching` status (being tracked, no action needed) is available distinctly from the act count
