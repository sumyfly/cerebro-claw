# Design: real-agent-work

## Context

The agent core (four-band action policy, ledger, dispatcher, critic verifier, Situations) is architecturally sound, but the review found the effectors and feedback loop are not yet real:

- `app.ts:99` hard-codes `new StubCustomerChannel()` — every dispatched notify-then-act ends in a `console.log`.
- The `act` tool (`action-policy-tools.ts`) records the agent's claim with nothing verifying an effect happened; only `task_complete`/`task_block` pair the ledger entry with a real write-back.
- `buildSummary` injects signals, instincts, and Situations, but never the account's own recent ledger entries — the agent cannot observe its past actions' outcomes.
- `brain-loop.ts:396` scores every account with `computeTriageScore({})` (a constant), and the persisted signal fingerprint is only prompt context — the server never skips an unchanged account, so each costs a full ~60s Claude Code subprocess turn.
- The task sweep dedups mid-flight work via the ledger; the account/renewal sweeps don't, so the same customer can be notified again while a prior send is still in its pause window.
- With Lark/Slack out of scope, `sendToCsm` degrades to a stub recipient and the notify pause window can expire with nobody able to cancel — the web console must carry the cancel/resolve surface.

Constraint from the product owner: **no external messaging integrations** (Lark, Slack, email providers). Real work must land in CSP, the system of record.

## Goals / Non-Goals

**Goals:**

- Customer-facing sends produce a durable effect in CSP (activity + note), not a log line.
- Ledger entries record effects with evidence, not narration.
- The perceive step includes the agent's own recent actions and their outcomes per account.
- Full-portfolio sweeps become affordable: unchanged accounts are skipped server-side; LLM turns are spent only where something changed.
- One in-flight customer touch per customer, enforced in the tool, not the prompt.
- The web console is a sufficient human valve: see pending sends, cancel; see escalations, resolve.
- Cycle wall-clock drops via bounded parallelism; critic cost drops via a cheap model.

**Non-Goals:**

- No Lark/Slack/email/SMS channel work (the `CustomerChannel` seam stays open for them later).
- No change to the four-band policy semantics, the task autopilot flow, or renewal write-back behavior.
- No inbound customer-reply ingestion (a future perceive source; out of scope here).

## Decisions

### D1: CSP-backed customer channel, selected by configuration

Implement `CspCustomerChannel` (in `packages/server` next to `csp-task-source.ts`, since it reuses `CSP_BASE_URL`/`CSP_TOKEN`). `send()` posts a `csm-activity` (type `MESSAGE`/`EMAIL`, the text as summary) and a note via the existing CSP endpoints; `call()` posts a `CALL` activity with the script. Returned ids become the dispatch evidence stored on the ledger entry. Wiring: when `CSP_TOKEN` is set, `app.ts` uses `CspCustomerChannel`; otherwise it falls back to the stub (dev/tests unchanged).

*Alternative considered:* a generic outbox table awaiting a future channel — rejected; it recreates the "draft and wait" assistant pattern. Writing the touch into CSP is real, visible work the CSM and next cycle can see.

### D2: Evidence on `act` + auto-ledger at the tool layer, not inside csp-connector

Add an optional-but-enforced `evidence` parameter to `act` (`{kind: note|activity|renewal|other, id}`); calls without evidence are refused with guidance to do the real write first (or use `prep`/`escalate`). For auto-ledgering, wrap the write-back tools at the extension-host layer: the existing `action-observer.ts` seam observes successful `csp_create_note` / `csp_update_renewal` calls and records an `act` ledger entry carrying the CSP object id. This keeps csp-connector a pure proxy (per CLAUDE.md) and gives ledger access where it already exists.

*Alternative considered:* give csp-connector direct ledger access — rejected; breaks the "extensions talk to shared types only" rule and makes the connector stateful.

### D3: Recent-actions block in decision context

`buildSummary` (CSP account source) fetches the account's last N (default 5) ledger entries and renders a `## Recent agent actions` block: band, summary, status, age, and failure note. A `listRecentByCustomer(customerId, n)` method is added to `ActionLedger` (SQLite: indexed query on `customer_id, created_at`). The guidance prompt gains one line: chase non-responses, close Situations whose signal recovered, never repeat an in-flight touch.

### D4: Fingerprint gate + real triage signals

In the account sweep, before selecting work: compute the snapshot/fingerprint (already done in `buildSummary` — hoist the cheap signal computation so it runs pre-selection), then **skip** accounts where fingerprint == lastDecision.fingerprint AND no open Situation AND no renewal within the configured horizon. Skipped accounts are logged with a count. The remaining accounts are scored with real inputs: health delta since last cycle, days-to-renewal, contract value, forced-band overrides — replacing `computeTriageScore({})`. `TRIAGE_*` env knobs stay as-is.

*Trade-off:* signals are computed for all listed accounts each cycle (a few cheap CSP GETs per account) to save expensive LLM turns. Net cost strongly favorable; CSP calls are parallelized with a small concurrency cap.

### D5: Notify dedup inside the tool

`notify_then_send_to_customer` checks the ledger for an existing `in-flight` notify for the same `customer_id` and refuses with a pointer to the open entry (the agent may `cancel_pending_action` first if the new touch supersedes it). Implemented in `action-policy-tools.ts` beside the override gate, using the same `listOpen()` the task dedup uses.

### D6: Console approvals via existing API paths

Add `GET /api/actions/pending` (in-flight notifies with `executeAt`) and `GET /api/actions/escalations` (needs-csm) if the router lacks them, plus `POST /api/actions/:id/cancel` and `POST /api/actions/:id/resolve` that call the same ledger transitions as the tools. Web: a "Pending" view with countdown + cancel button, and an "Escalations" view with situation/options/recommendation + resolve form. No new auth model — same `ADMIN_TOKEN` bearer as the rest of `/api/*`.

### D7: Bounded parallelism + cheap critic

Sweep loops run evaluations through a small concurrency pool (env `BRAIN_CONCURRENCY`, default 3) instead of strictly serial `for...of`. The critic verifier gets its own model knob (`VERIFIER_MODEL`, default a Haiku-class model) passed to a second `ClaudeCodeRuntime` instance (or the same instance with per-call model override if supported). Critic stays fail-safe (block on error).

*Risk accepted:* parallel turns multiply subprocess memory; cap is conservative and configurable.

## Risks / Trade-offs

- [CSP write rate increases (activity+note per send, signals for all accounts)] → concurrency caps on CSP calls; fingerprint gate cuts LLM load far more than it adds HTTP load.
- [Auto-ledgered acts could double-count when the agent also calls `act`] → guidance already says "the note IS the Act"; the observer skips recording when the same tool turn already produced an `act` entry for that customer.
- [Fingerprint gate could starve an account whose problem persists unchanged] → open Situations and renewal horizon bypass the gate; a max-age re-review (e.g. force review after 7 days skipped) is included.
- [Parallel sweeps reorder ledger writes] → ledger is append-only with per-entry ids; no ordering assumptions exist today.
- [Console becomes the only cancel surface; if the server is down during the pause window, sends still dispatch on restart] → dispatcher already catches up on restart; pause windows are wall-clock so a long outage past `executeAt` dispatches late — acceptable for v1, noted in docs.

## Migration Plan

1. Land D2/D5 (tool-layer gates) and D3 (context) — pure additive, stub-safe, fully testable with Vitest.
2. Land D4 + D7 (loop changes) behind env defaults that preserve current behavior (`BRAIN_CONCURRENCY=1`, gate on).
3. Land D1 (CSP channel) — switches automatically only when `CSP_TOKEN` is configured.
4. Land D6 (console) last; it reads/writes existing ledger states.

Rollback: each decision is independently revertible; the stub channel and serial loop remain in the codebase as fallbacks.

## Open Questions

- Which CSP activity `type` best represents an agent-sent message so it doesn't pollute CSM-authored activity reports? (Needs a look at CSP's activity taxonomy; default `MESSAGE` with an `agent:` prefix in the subject.)
- Does the `claude` CLI accept a per-turn model override cheap enough for the critic, or does the verifier need its own runtime instance? (Affects D7 implementation only.)
