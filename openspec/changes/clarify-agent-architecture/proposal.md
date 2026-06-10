## Outcome

Turn the agent from a forgetful event-logger into one that holds a **storyline per renewal/account**, works **renewals on their own timeline** as a first-class input, and reports the few situations that need the CSM — while making the whole system legible (one loop, one vocabulary, mapped seams) enough to understand and extend. The load-bearing change is the persistent **Situation**; everything else is clarity around it.

## Why

The agent works, but two things hold it back from the product promise — *"work the long tail like a great human CSM, so the CSM only touches the accounts that matter."*

1. **It has no memory of ongoing situations, so it re-discovers the same problems every cycle.** Observed live: account `2bloccafe` was independently flagged as a "soft renewal risk, put on watch" on Jun 3, Jun 4, *and* Jun 5 — three identical `act` entries. A human CSM never re-discovers a risk they're already watching. The only durable state today is a **flat ledger of point-in-time actions** plus free-form instincts; there is no first-class concept for a *situation that persists across time*. The agent literally says "put it on watch," but no watch exists.

2. **The system is hard to understand, and the friction is real, not cosmetic.** The same underlying thing (`action_ledger`) is called "Pipeline" in the UI, "ledger" in the API, and "Activity" in history. The word "Task" means both a CSP work-item *and* the Pipeline's "Agent Task Stream" — a collision that actively confused a user this week ("that makes me very confuse"). The architecture is documented as a flat list of 8 "modules" that mix data, processes, and seams, so newcomers can't hold it in their head. And the genuinely rich set of extension points is scattered and undiscoverable.

This change reorganizes the agent around the human-CSM loop, adds the missing **situation memory** that makes it behave like a human, fixes the **vocabulary** so one concept has one name, and makes the **extension surface** obvious.

## What Changes

- **Introduce a first-class `Situation` (a thread).** A persistent, cross-cycle record that groups related ledger actions into one storyline, carries a `status` (open / watching / escalated / resolved), a `nextCheckpoint` (when to revisit), and a `waitingFor` note. The Perceive step loads open situations so the agent sees what is already in flight; the Remember step opens/updates/closes them instead of re-creating. This eliminates cross-cycle re-discovery and turns the digest's *"N escalations need you"* into the more human *"N situations need you."*

- **Make Renewals a first-class input (third sweep).** Today renewals are reached only via an account or a task; add a `RenewalSource` so the work loop sweeps upcoming/at-risk renewals directly, on the renewal timeline (T-90/T-60/T-30). The account sweep, task sweep, and renewal sweep all converge on the single `renewal-risk` Situation for an account (the `(businessId, kind)` uniqueness invariant), so three entry points never fork three threads. Write-back reuses the existing `renewal-writeback` tools.

- **Adopt `Perceive → Decide → Act → Remember` as the organizing model.** Re-frame the 8-module grab-bag into the four-phase agent loop. The code already drifts this way (the new `engine/` folder is a Perceive layer in all but name). Make it explicit in code structure, docs, and the UI. `Remember` is today's weakest phase — situations fill it in.

- **Run a vocabulary pass — one term per concept.** Reserve **Task** for CSP work-items only; rename the Pipeline's "Agent Task Stream" to **Activity**. Collapse Pipeline / ledger / Activity to a single canonical term across DB, API, UI, and docs. Rename "Brain Loop" to **Work Loop** with explicitly named *account sweep* and *task sweep*.

- **Make the extension surface discoverable, and make the action policy itself a seam.** Publish a single map of the seven plug-points (runtime, input sources, tools, CSM channel, customer channel, persistence, extensions). Promote the four-band action policy from a hardcoded prompt+tool set to a registered, extensible **policy** — so a future band such as *observe-only* (exactly what `2bloccafe` needed) can be added without forking the prompt.

## Capabilities

### New Capabilities
- `situation-threads`: A persistent, first-class Situation that groups ledger actions into a storyline, is loaded during Perceive and updated during Remember, and prevents cross-cycle re-discovery.
- `agent-vocabulary`: A canonical glossary enforced across DB, API, UI, and docs — one concept, one name — resolving the Task/Task and Pipeline/ledger/Activity collisions.
- `renewal-source`: A pluggable `RenewalSource` input and a named **renewal sweep** in the work loop, so upcoming/at-risk renewals are worked directly and converge with the account and task sweeps on one `renewal-risk` Situation.
- `extension-surface`: A discoverable enumeration of the agent's extension seams, plus a registered (extensible) action policy so bands can be added without editing core.

### Modified Capabilities
- `task-autopilot`: The "brain loop" is renamed to **work loop** with named account/task sweeps, and the task sweep loads open Situations before deciding so task work does not re-discover an in-flight storyline. (Delta reconciles the existing baseline requirement that names the "brain loop.")

> The vocabulary rename and the situation-linkage of actions also touch `task-source` and `renewal-writeback`, but those effects are fully covered cross-cuttingly by the `agent-vocabulary` and `situation-threads` ADDED specs (every action links to its Situation; "task" is reserved for the CSP work-item). They are therefore listed under Impact rather than carrying their own deltas, to avoid duplicating cross-cutting requirements.

## Impact

- **Shared types:** add `Situation` / `SituationStatus` to `@cerebro-claw/shared`; the action types gain an optional `situationId` link.
- **Memory:** add a `SituationStore` (SQLite) alongside `MemoryStore` and `ActionLedger`; a `situations` table.
- **Inputs:** add a `RenewalSource` (and `RENEWAL_SOURCE` selection mirroring `TASK_SOURCE`) alongside `AccountSource`/`TaskSource`; the work loop gains a renewal sweep. (Note: CSP's renewals endpoint is per-account — see design open question on portfolio-wide renewal listing.)
- **Engine (Perceive):** `decision-context` / `task-context` / a new renewal-context load open situations for the account/task/renewal and surface them to the agent.
- **Work loop (Remember):** after each action, open/update/close the relevant situation; skip re-flagging an account/task that already has an open situation past its `nextCheckpoint`.
- **System prompt:** teach the agent to consult and maintain situations, and reduce spurious `act` entries that are really "just watching."
- **Web:** rename the Pipeline page to **Activity**; add a **Situations** view (open threads needing the CSM); align all labels to the glossary.
- **Action policy:** the four bands become a registered set behind the existing `act/notify/escalate/prep` tools (no behavior change to the four), with a seam to add a band.
- **Docs:** `CLAUDE.md` and a new `docs/architecture.md` re-told as Perceive → Decide → Act → Remember; a `docs/extending.md` map of the seven seams.

## Non-goals

- **Not** adding a fifth band — resolved firmly in design.md §Decisions D1: *observe-only* is modeled as a Situation, not a band. We still make the policy *extensible* (a seam to register a band later if some future need warrants it), but the existing four bands keep identical behavior and observe-only does not use the seam.
- **Not** changing the runtime (still Claude Code over MCP) or the CSP integration contracts.
- **Not** a rewrite. Situations, vocabulary, and the loop framing are additive/renaming; the ledger, dispatcher, and digest stay.
