# customer-channel-csp Specification (delta)

## ADDED Requirements

### Requirement: CSP-backed customer channel

The system SHALL provide a `CustomerChannel` implementation whose `send()` writes the customer touch into CSP as a CSM activity (and a note carrying the message body), and whose `call()` writes a CALL activity carrying the script. The CSP object ids returned by the write SHALL be recorded on the dispatched ledger entry as evidence of the effect.

#### Scenario: Dispatched send lands in CSP

- **WHEN** the dispatcher executes a due notify-then-act entry and the CSP customer channel is active
- **THEN** a CSM activity (and note) is created in CSP for that account, and the ledger entry is marked `executed` carrying the CSP object id

#### Scenario: CSP write failure surfaces in the ledger

- **WHEN** the CSP write fails during dispatch
- **THEN** the ledger entry is marked `failed` with the error note and the digest surfaces it

### Requirement: Channel selected by configuration

The CSP customer channel SHALL be selected automatically when CSP credentials (`CSP_TOKEN`) are configured; otherwise the stub channel SHALL remain the default so dev and test behavior is unchanged.

#### Scenario: CSP configured

- **WHEN** the server boots with `CSP_TOKEN` set
- **THEN** the action-policy tools and dispatcher use the CSP customer channel

#### Scenario: CSP not configured

- **WHEN** the server boots without `CSP_TOKEN`
- **THEN** the stub customer channel is used and a log line states the customer channel is stubbed
