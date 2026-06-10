# notify-dedup Specification (delta)

## ADDED Requirements

### Requirement: One in-flight customer touch per customer

`notify_then_send_to_customer` SHALL refuse to queue a new send when the ledger already holds an `in-flight` notify-then-act entry for the same customer. The refusal SHALL reference the open entry id so the agent can cancel it first if the new touch supersedes it.

#### Scenario: Duplicate notify refused

- **WHEN** the agent calls `notify_then_send_to_customer` for a customer that already has an in-flight notify
- **THEN** the tool returns a failure naming the open entry id and no new ledger entry is queued

#### Scenario: Notify allowed after prior send completes

- **WHEN** the prior notify for the customer is `executed`, `cancelled`, or `failed`
- **THEN** a new notify for that customer is accepted and queued

#### Scenario: Supersede via cancel

- **WHEN** the agent cancels the open entry with `cancel_pending_action` and then calls notify again
- **THEN** the new notify is accepted
