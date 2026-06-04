## Context

The brain loop today iterates **accounts** via the `AccountSource` interface, builds a side-effect-free per-account summary, computes signals, and lets the agent classify into Act / Notify-then-act / Escalate / Prep. The csp-connector proxies CSP live and exposes renewals **read-only** (`csp_get_renewals`, `csp_get_renewal`). The `action_ledger`, the 60s dispatcher, and `/api/digest/counters` already exist and are the reporting backbone.

Two gaps block the agent from doing the CSM job end-to-end: (1) it cannot consume the CSM's **task queue** — the actual unit of CSM work on Cerebro — and (2) it can read renewals but cannot **advance** them. The task API is now reachable, but its exact shape (CSP task endpoints vs. a standalone Cerebro system, endpoints, auth) is not yet confirmed by the user.

## Goals / Non-Goals

**Goals:**
- A `TaskSource` abstraction (mirroring `AccountSource`) so the brain loop iterates open tasks independent of the concrete backend.
- A task connector extension registering `task_*` tools (list / get / complete-or-block) over MCP.
- Tasks run through the existing four-band action policy end-to-end, recorded in the ledger.
- Renewal write-back tools on csp-connector and agent behavior to advance renewals under the same policy.
- Reuse the ledger, dispatcher, and digest — no parallel reporting surface.

**Non-Goals:**
- Building a task UI for *creating* tasks — the console only surfaces and reports.
- Changing the action-policy bands or the approval model.
- A local mirror of task data — the connector stays a live proxy, like csp-connector.
- Committing to a specific task backend in code before the user confirms it (the abstraction absorbs this).

## Decisions

**1. `TaskSource` as a sibling of `AccountSource`, not a special account.**
Tasks have their own lifecycle (open → done/blocked) and a write-back result, unlike accounts which are evaluated by change-detection. Modeling tasks as accounts would corrupt the signal-fingerprint logic in `onEvaluated`. Instead add a parallel `TaskSource { label, listOpen(), getContext(id), writeBack(id, outcome) }` and let a brain-loop cycle process both sources. *Alternative considered:* overload `AccountSource` — rejected, conflates two lifecycles.

**2. Task connector is a separate extension, not folded into csp-connector.**
The backend is unconfirmed; isolating it as `extensions/task-connector/` keeps csp-connector clean and lets the task transport/auth differ. If the answer turns out to be "CSP task endpoints," the extension still stands as the task-shaped facade and can reuse a shared CSP transport. *Alternative:* add `csp_*_task` tools directly — rejected for now to avoid coupling to an unconfirmed backend; revisit at apply if confirmed CSP.

**3. Write-back goes through the ledger first, backend second, with failure surfaced.**
Every completion writes an `action_ledger` entry tagged with the task id; a backend rejection flips the entry to `failed` and the digest reports it. This guarantees the digest is the single source of truth for "what the agent did," matching how the dispatcher already records customer-send failures.

**4. Renewal write-back is additive on csp-connector.**
Add `csp_update_renewal` (and any needed note/playbook write) alongside the existing read tools, reusing the UUID validation and 10s timeout already in the transport. When a mutation is not permitted by the API, the agent falls back to a note/escalation rather than failing — encoded as agent guidance, not a hard tool error.

**5. Config mirrors `CSP_*`.**
New env vars `TASK_API_BASE_URL`, `TASK_API_TOKEN`, `TASK_CSM_*` gate the `TaskSource`; absent config means task iteration is skipped (logged), exactly as CSP source falls back today.

## Risks / Trade-offs

- **Unconfirmed task backend** → The `TaskSource` abstraction + separate extension means brain-loop, ledger, digest, and UI work proceed against a stub/contract; only the transport binding waits on the answer. A `StubTaskSource` (like `StubCustomerChannel`) unblocks tests.
- **Autonomous task completion is irreversible-ish** → Mitigated by the band policy: only Act/Notify auto-complete; anything ambiguous or high-stakes routes to Escalate and stays open. Notify-then-act keeps the cancel window.
- **Renewal mutation permissions vary** → Fallback-to-note/escalate behavior plus ledger recording of what was/wasn't possible avoids hard failures.
- **Double-processing a task across cycles** → `listOpen()` must reflect backend state (closed tasks drop out); the ledger task-id link lets the loop skip tasks it already acted on within a cycle.
- **Digest noise from many small task acts** → Acceptable; the digest is counts, and Act items are designed to be summarized, not individually reviewed.

## Migration Plan

1. Add `TaskSource` + task record types to `@cerebro-claw/shared`; ship `StubTaskSource`.
2. Add `task-connector` extension with `task_*` tools (against stub until backend confirmed).
3. Extend brain loop to iterate the task source; add task context rendering to the engine.
4. Add `csp_update_renewal` (+ needed renewal writes) to csp-connector.
5. Wire ledger task-id tagging; confirm dispatcher/digest cover task + renewal actions.
6. Add task-queue view to the ops console.
7. Bind the real task transport once the backend is confirmed; flip config on.

Rollback: leave `TASK_API_*` unset — task iteration is skipped and behavior reverts to account-only; renewal write tools are inert unless the agent calls them.

## Open Questions

- **Which task backend?** CSP task endpoints under `cspapi.test.shub.us/api/v1`, or a standalone Cerebro task system with its own base URL/auth? (User answered "you check" — resolve before step 7.)
- **Task → account linkage:** does every task carry a businessId so we can attach account signals, or are some tasks account-less?
- **Allowed renewal status transitions:** which transitions does the CSP API actually permit for a CSM-role token?
- **Task completion payload:** what result shape does the backend expect on close (free text, structured outcome, status enum)?
