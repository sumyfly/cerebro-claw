# Proposal: real-agent-work

## Why

A design review of the agent core found that while the four-band action policy, ledger, dispatcher, critic, and Situations are genuinely agent-shaped, several effectors terminate in stubs and the loop is not closed: customer sends end in a `console.log` (`StubCustomerChannel`), `act` records the agent's self-report rather than a verified effect, the agent never sees the outcomes of its own past actions, account triage scores every account identically, and nothing stops duplicate customer touches across cycles. With Lark/Slack explicitly out of scope, the in-app console must also become the human safety valve. This change files those directions so the agent does *real work* — effects that land in CSP, observed and followed up — instead of narrated work.

## What Changes

- Replace the hard-coded `StubCustomerChannel` with a CSP-backed customer channel: dispatched notify-then-act sends write back into CSP as activities/notes so the work lands in the system of record.
- Make the `act` band evidence-backed: an act must reference a real effect (CSP note id, activity id, renewal id), and CSP write-back tools auto-record their own ledger entries instead of trusting agent self-reports.
- Close the perceive loop: each account's recent action-ledger entries (band, status, age, outcome) are injected into the per-account decision context so the agent can chase non-responses and close Situations.
- Turn the signal fingerprint into a server-side gate: accounts with an unchanged fingerprint, no open Situation, and no due renewal are skipped without an agent turn; account triage ranks the remainder by real signals (health delta, renewal proximity, contract value) instead of the current constant score.
- Hard dedup for customer touches: `notify_then_send_to_customer` refuses when an open in-flight notify already exists for the same customer (mirroring the existing task mid-flight dedup).
- Make the ops console the approval surface: pending notify-then-act sends with one-click cancel, and open escalations with resolve, wired to the existing `cancel_pending_action` / `resolve_escalation` paths.
- Loop throughput: bounded parallelism for sweep evaluation and a cheap/fast model for the critic verifier.

## Capabilities

### New Capabilities

- `customer-channel-csp`: A real `CustomerChannel` implementation whose sends/calls write back into CSP (activity + note), replacing the stub as the default when CSP is configured.
- `evidence-backed-act`: The Act band requires evidence of a real effect; CSP write-back tools auto-ledger their effects.
- `closed-loop-perception`: Per-account decision context includes the account's recent ledger entries and their outcomes.
- `account-triage-gate`: Server-side change-detection gate (skip unchanged accounts without an agent turn) plus real signal-based account triage scoring.
- `notify-dedup`: Ledger-enforced dedup of customer touches — one in-flight notify per customer.
- `console-approvals`: Web console surfaces pending sends (cancel) and open escalations (resolve) as the in-product human valve.
- `loop-throughput`: Bounded parallel agent turns in sweeps; pluggable cheap model for the critic verifier.

### Modified Capabilities

<!-- No existing spec's requirements change: renewal-writeback, task-autopilot, and task-source behavior is untouched. -->

## Impact

- `packages/tools`: `action-policy-tools.ts` (evidence param on `act`, notify dedup check), new `csp-customer-channel` (or extension), stub channel demoted to fallback.
- `extensions/csp-connector`: write-back tools (`csp_create_note`, `csp_update_renewal`) gain auto-ledger recording (needs ledger access — likely moves to or pairs with a built-in extension seam).
- `packages/server`: `brain-loop.ts` (fingerprint gate, real account triage scoring, bounded parallelism, ledger history in `buildSummary`), `app.ts` (channel wiring), `verifier.ts` (cheap-model backend), router/digest (pending + escalation endpoints if missing).
- `packages/web`: pending-actions and escalations views with cancel/resolve actions.
- No new external dependencies; no Lark/Slack work. Existing tests in `packages/*` extend to cover the new gates.
