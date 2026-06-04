# renewal-writeback Specification

## Purpose

Let the agent advance renewals through write-back tools in the csp-connector, applying the four-band action policy to renewal work (notes, nudges, briefs, escalations) and falling back to non-mutating actions where the CSP API does not permit a mutation.

## Requirements

### Requirement: Renewal write-back tools

The csp-connector SHALL expose write tools that let the agent advance a renewal, complementing the existing read-only `csp_get_renewals` / `csp_get_renewal`. At minimum this SHALL include updating a renewal's status and/or playbook progress (e.g. `csp_update_renewal`). Renewal ids SHALL be validated as UUIDs and write tools SHALL return a structured error on rejection rather than throwing.

#### Scenario: Agent updates a renewal status

- **WHEN** the agent calls the renewal update tool with a valid renewal UUID and an allowed status transition
- **THEN** CSP records the update and the tool returns the updated renewal

#### Scenario: Invalid renewal id rejected

- **WHEN** a renewal write tool is called with a non-UUID id
- **THEN** the tool returns a validation error and performs no write

### Requirement: Renewals advanced under the four-band policy

The agent SHALL advance renewals through the same Act / Notify-then-act / Escalate / Prep policy: posting renewal notes (Act), sending renewal nudges to customers after the pause window (Notify-then-act), preparing renewal briefs (Prep), and escalating discounts, churn-saves, or contract changes (Escalate). Every renewal action SHALL be recorded in the `action_ledger`.

#### Scenario: Approaching renewal nudged

- **WHEN** a renewal is approaching with normal health
- **THEN** the agent classifies it Notify-then-act, notifies the CSM, and schedules the customer nudge after the pause window

#### Scenario: At-risk renewal escalated

- **WHEN** a renewal is near-term and at risk (low health) or requires a discount or contract change
- **THEN** the agent escalates with situation/options/recommendation and does not auto-send to the customer

#### Scenario: Renewal note posted autonomously

- **WHEN** the agent records a routine renewal observation
- **THEN** it posts a CSP note via write-back as an Act and logs it to the ledger

### Requirement: Renewal write-back respects API permissions

Where the CSP API does not permit a given mutation, the agent SHALL fall back to a non-mutating action (note or escalation) rather than failing the task, and SHALL record what was and was not possible.

#### Scenario: Disallowed mutation falls back

- **WHEN** a renewal status transition is not permitted by the API
- **THEN** the agent records a note and/or escalates instead, and the ledger reflects the fallback
