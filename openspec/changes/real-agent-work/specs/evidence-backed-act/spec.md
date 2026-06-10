# evidence-backed-act Specification (delta)

## ADDED Requirements

### Requirement: Act requires evidence of a real effect

The `act` tool SHALL require an `evidence` reference (kind + id of a real effect: CSP note id, activity id, renewal id, or other verifiable artifact). Calls without evidence SHALL be refused with guidance to perform the real write first or choose a different band. The ledger entry SHALL store the evidence.

#### Scenario: Act with evidence recorded

- **WHEN** the agent calls `act` with evidence `{kind: "note", id: <csp note id>}`
- **THEN** the ledger entry is recorded with the evidence attached and counts in the digest

#### Scenario: Act without evidence refused

- **WHEN** the agent calls `act` with no evidence reference
- **THEN** the tool returns a failure telling the agent to do the real write first; no ledger entry with status `done` is created

### Requirement: CSP write-backs auto-record their ledger entry

Successful CSP write-back tool calls (`csp_create_note`, `csp_update_renewal`) SHALL automatically record an `act` ledger entry carrying the CSP object id, without relying on the agent to self-report. The observer SHALL NOT create a duplicate entry when the same turn already recorded an `act` for that customer and effect.

#### Scenario: Note write auto-ledgered

- **WHEN** the agent calls `csp_create_note` and CSP accepts the write
- **THEN** an `act` ledger entry is recorded automatically with the note id as evidence

#### Scenario: No double-count

- **WHEN** a write-back was auto-ledgered and the agent also calls `act` for the same effect in the same turn
- **THEN** only one ledger entry exists for that effect
