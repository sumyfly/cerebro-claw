## Why

Today the brain loop reasons over accounts and can classify renewal *signals*, but it cannot pick up and finish the actual unit of CSM work — the **tasks** a CSM works through on Cerebro — and it can only *read* renewals, not advance them. With the task API now reachable, the agent can do the CSM job the way a human does: pull the task queue, work each item end-to-end through the action policy, and push renewals forward with real write-back. This closes the gap between "the agent has opinions about accounts" and "the agent did the CSM's work."

## What Changes

- **Add a pluggable task source.** A new connector exposes the CSM's task queue (list open tasks, read a task's detail/context, mark a task done/blocked with a result) as `ToolDefinition`s, behind a `TaskSource` abstraction so the backing API can be swapped. (Exact backend — CSP task endpoints vs. a standalone Cerebro system — is an open question resolved in design; the abstraction is the same either way.)
- **Drive tasks through the four-band action policy.** The brain loop iterates open tasks (not just accounts), and the agent classifies each task into Act / Notify-then-act / Escalate / Prep, completes it end-to-end, and writes the outcome back to the task record. Every task action lands in the existing `action_ledger`. Approval remains the exception (Escalate band only).
- **Renewal write-back.** Add write tools so the agent can advance a renewal — post renewal notes, send notify-then-act customer nudges, prep renewal briefs, and update renewal status/playbook progress where the API permits — instead of read-only briefing.
- **Digest + dispatcher coverage.** Task and renewal actions flow through the same ledger so `/api/digest/counters` and the notify-then-act dispatcher cover them with no new surface.
- **Admin UI visibility.** Surface the task queue and its agent-driven outcomes in the existing ops console so a CSM can see what the agent picked up and completed.

## Capabilities

### New Capabilities
- `task-source`: A pluggable connector and `TaskSource` abstraction that lists open CSM tasks, fetches per-task context, and writes back completion/blocked outcomes via tool definitions registered by an extension.
- `task-autopilot`: Brain-loop behavior that iterates open tasks and runs each through the Act / Notify-then-act / Escalate / Prep policy end-to-end, recording every action in the ledger.
- `renewal-writeback`: Write-back tools and agent behavior to advance renewals (notes, customer nudges, briefs, status/playbook updates) under the same four-band policy.

### Modified Capabilities
<!-- None — openspec/specs/ is currently empty; all behavior here is new. -->

## Impact

- **New extension / tools:** a task connector under `extensions/` registering `task_*` tools; new renewal write tools added to `extensions/csp-connector/index.ts` (e.g. `csp_update_renewal`).
- **Brain loop:** `packages/server/src/brain-loop.ts` gains a task-iteration source alongside the existing `AccountSource`; signal/decision-context engine extended to render task context.
- **Shared types:** `packages/shared` adds `TaskSource` / task record types.
- **Ledger & dispatcher:** reuse `action_ledger`, dispatcher, and `/api/digest/counters` — no schema change expected beyond possibly tagging ledger entries with a task id.
- **Web:** ops console gains a task-queue view (`packages/web`).
- **Config / `.env`:** new vars for the task API base URL / token / CSM identity (mirrors `CSP_*`).
- **Open question (design):** the concrete task backend, its endpoints, and auth — the `TaskSource` abstraction de-risks this so the rest of the change is unblocked.
