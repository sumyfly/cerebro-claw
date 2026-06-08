# Design — Clarify Agent Architecture

This change is organized around the four threads raised in exploration:

1. **Goal** — make the agent work like a great human CSM.
2. **Architecture** — name the shape so it's graspable.
3. **Naming / modules / flexibility / extension points** — one concept, one name; obvious seams.
4. **Easy to use, easy to understand — enhance the obvious.**

The connective insight: **threads 2–4 are all in service of thread 1.** A human CSM works in *situations over time*; our agent works in *isolated events*. Closing that gap is the goal, and a clear mental model, clean vocabulary, and discoverable seams are how we make the gap-closing legible.

---

## Thread 1 — "Work like a human CSM": the situation gap

### The smoking gun

```
account 2bloccafe
  Jun 3  act  "soft renewal risk, put on watch"
  Jun 4  act  "soft renewal risk, put on watch"   ← re-discovered
  Jun 5  act  "soft renewal risk, put on watch"   ← re-discovered again
```

The agent re-discovers the same risk every cycle because the only durable state is a **flat ledger of point-in-time actions** plus free-form `instincts`. There is no object that says *"this risk is open, I'm already on it, here's the storyline, here's when I'll revisit."* The agent says "put it on watch" — but **the watch is fiction.**

### What a human CSM actually carries

```
EVENT MODEL (today)                 SITUATION MODEL (proposed)
───────────────────                 ──────────────────────────
ledger row                          Situation: "2bloccafe renewal at risk"
ledger row   (related? unknown)       status:        watching
ledger row   (same thing!)            opened:        Jun 3
                                      nextCheckpoint: Jun 8  (revisit window)
instinct: "usage down"                waitingFor:    "logins to recover"
                                      timeline:
                                        ├ Jun 3  noticed AT_RISK baseline (act)
                                        ├ Jun 3  nudged contact     (notify-then-act)
                                        └ Jun 5  still flat
```

A **Situation** is a thread: a persistent storyline that *groups* actions, *survives* across cycles, and *knows when it next needs attention.*

### The lifecycle

```
        (Perceive sees a new pattern)
                  │
                  ▼
            ┌──────────┐   agent works it
   ┌───────▶│   OPEN   │──────────────┐
   │        └──────────┘              │
   │             │ needs to wait      ▼
   │             ▼              ┌───────────┐
   │        ┌──────────┐        │ ESCALATED │ (CSM owns)
   │        │ WATCHING │        └───────────┘
   │        └──────────┘              │
   │   nextCheckpoint passes          │ resolve_escalation
   │   → re-perceive, not re-discover  │
   └─────────────┘                    ▼
                              ┌────────────┐
   situation resolves ───────▶│  RESOLVED  │ (drops out of the loop)
                              └────────────┘
```

The key mechanic: during **Perceive**, the loop loads the account's/task's *open* situations first. If a situation is already `watching` and its `nextCheckpoint` hasn't passed, the agent **does not re-flag** — it either skips or appends to the existing thread. Re-discovery becomes impossible by construction.

### How this changes the surfaces

- **Digest:** *"2 escalations need you"* → *"2 open situations need you"* — and each is a storyline the CSM can read, not a lone event.
- **Ledger:** stays as the event log, but every action carries an optional `situationId`, so the UI can render storylines.
- **Spurious `act` reduction:** "put on watch" stops being an `act`. It becomes *open/advance a Situation* — which is what the agent meant. This directly connects to Thread 4 (see *observe-only*).

### Decision

Add a **first-class `Situation`** with its own `SituationStore` (SQLite `situations` table), parallel to `ActionLedger`. Do **not** overload `instincts` (free text, no lifecycle) or the ledger (immutable events). Situations are *mutable, lifecycle-bearing state*; the ledger stays an append-only record. Two different jobs, two different stores.

---

## Thread 2 — A mental model that makes the architecture obvious

### Today: a flat list at mixed altitudes

The 8 "modules" mix *nouns* (Memory, Ledger), *processes* (Brain Loop, Dispatcher), *seams* (Channel, Tool, Extension), and *the brain* (Runtime). A list is not a model — it doesn't tell you what depends on what or where to plug in.

### Proposed: the agent loop everyone already knows

```
        ┌──────────────────────────────────────────────────────────────┐
        │                                                                │
        ▼                                                                │
   ┌─────────┐      ┌──────────┐      ┌─────────┐      ┌──────────────┐ │
   │ PERCEIVE│─────▶│  DECIDE  │─────▶│   ACT   │─────▶│   REMEMBER   │─┘
   ├─────────┤      ├──────────┤      ├─────────┤      ├──────────────┤
   │ engine/ │      │ agent.   │      │ 4 bands │      │ ledger       │
   │ signals │      │ prompt() │      │ + tools │      │ + instincts  │
   │ snapshot│      │ + bands  │      │ + dispat│      │ + SITUATIONS │
   │ + open  │      │  policy  │      │  cher   │      │  (new)       │
   │  situ.  │      │          │      │         │      │              │
   └─────────┘      └──────────┘      └─────────┘      └──────────────┘
   "what's true"    "what to do"      "do it"          "carry forward"
```

The **Work Loop** (née Brain Loop) is just the thing that turns this crank once per account and once per task, every cycle. Every existing module slots into exactly one phase:

| Phase | Existing pieces | Gap this change fills |
|---|---|---|
| **Perceive** | `engine/signals`, `csp-snapshot`, `decision-context`, `task-context` | also load **open situations** |
| **Decide** | `agent.prompt()`, the four-band policy in the system prompt | policy becomes a **registered set** (Thread 4) |
| **Act** | `act/notify/escalate/prep` tools, dispatcher | unchanged |
| **Remember** | `action_ledger`, `instincts` | add **situations** (the weak phase, now real) |

### Decision

Treat Perceive → Decide → Act → Remember as the canonical spine in `CLAUDE.md`, a new `docs/architecture.md`, and the UI's information architecture. This is *framing + light structure*, not a rewrite — the code already wants to be this. The payoff is that "where does X live?" and "where do I add Y?" become answerable from one diagram.

---

## Thread 3 — Naming: one concept, one name

The collisions are not cosmetic; they cost comprehension (a user hit each of these this week).

| Problem | Symptom | Resolution |
|---|---|---|
| **"Task" overloaded** | CSP work-item vs. Pipeline's "Agent **Task** Stream" — user couldn't see why Pipeline had data but the Tasks page was empty | "Task" = **CSP work-item only**. The action stream is **Activity**. |
| **One thing, three names** | `action_ledger` (DB) / "Pipeline" (UI page) / "Activity" (legacy) | Canonical: **Activity** (user-facing) backed by the **ledger** (storage term). Drop "Pipeline." |
| **"Brain Loop"** | evocative but hides that it runs two distinct sweeps | **Work Loop**, with named **account sweep** and **task sweep**. |

What is **named well** and must be preserved: the bands.

```
act · notify-then-act · escalate · prep
```

Verb-first, ordered by reversibility, instantly memorable. The design rule for everything else: **name it the way the bands are named.**

### Decision

Publish a canonical glossary (the `agent-vocabulary` spec) and enforce it across DB column intent, API responses, UI labels, and docs. Renames are mechanical and low-risk; the ledger's storage name can stay `action_ledger` internally, but every *user-facing* and *doc* reference uses the glossary term.

---

## Thread 4 — Extension points: rich, but invisible (and one missing seam)

### The seven seams that already exist

```
SWAP THE BRAIN      →  AgentBackend                 (claude-code today)
ADD INPUTS          →  AccountSource / TaskSource    (CSP / stub)
ADD TOOLS           →  ToolDefinition                (act, csp_*, bash…)
REACH THE CSM       →  ChannelAdapter                (Lark; +Slack/email)
REACH CUSTOMERS     →  CustomerChannel               (stub; +email/SMS)
CHANGE PERSISTENCE  →  MemoryStore / ActionLedger    (+ SituationStore, new)
PLUG IN ANYTHING    →  ExtensionFactory + events     (lifecycle hooks)
```

This is a genuinely good factoring. The problem is **discoverability** — the seams live across `shared/types/`, `server/src/`, and `extensions/`, with no single "to do X, implement Y" map. "Easy to use" here means *signposting*, not new capability.

### The missing seam: the action policy itself

The four bands are hardcoded in the system prompt + a fixed tool set. There is **no seam to extend the policy.** Thread 1 surfaced the need concretely: `2bloccafe` didn't want an `act` ("I did a thing") — it wanted *observe-only* ("I noticed and I'm watching, no work performed"). Today that gets mis-logged as an `act`, inflating the "acts" count with non-actions.

Two ways to satisfy "observe-only":

```
OPTION A: a fifth band                    OPTION B: Situations absorb it
──────────────────                        ────────────────────────────
act · notify · escalate · prep · observe  act · notify · escalate · prep
                                          + "just watching" = open/advance
+ clean, explicit                            a Situation (no ledger act)
- dilutes the crisp four                  + no new band; reuses Thread 1
- every surface must learn it             + "watch" finally becomes real
                                          - relies on situations landing first
```

**Resolved: Option B** (see §Decisions D1) — observe-only is a Situation, not a band. Independently of that resolution, the *mechanism* this change adds is: make the band policy a **registered set** behind the existing tools, so adding a band is an extension, not a core edit. We register the existing four with **no behavior change** and leave the seam — but we deliberately do not use it for observe-only.

### Decision

Ship a `docs/extending.md` map (the discoverability win) and refactor the band policy into a registered set (the seam). Do **not** add a fifth band — `observe-only` is solved via Situations (Thread 1); see §Decisions D1 for why this is a permanent position, not a deferral.

---

## How the four threads compose

```
                 Thread 1: SITUATIONS  (the goal)
                          ▲
          makes legible   │   makes real
        ┌─────────────────┼──────────────────┐
        │                 │                  │
  Thread 2: LOOP    Thread 3: NAMING    Thread 4: SEAMS
  (Remember phase   (Activity ≠ Task;   (policy seam lets
   gains situations) situations need a   "observe-only" be
                     clear name)         Situations, not a band)
```

- Thread 2 gives situations a *home* (the Remember phase).
- Thread 3 gives them an unambiguous *name* (and stops "Task"/"Activity" bleed).
- Thread 4 ensures the "watch/observe" intent has a *mechanism* (Situations) rather than a mis-used band.

Ship order if implemented later: **Situations → vocabulary → loop framing → extension map/seam.** Situations are the load-bearing change; the rest is clarity around them.

---

## Decisions (resolved)

These were open during exploration; here is the position taken, with reasoning. Each is now reflected in the specs.

### D1 — Observe-only is a Situation, NOT a fifth band

**Decision: do not add a fifth band. Ever, for this reason.** The four bands answer one question — *"what action did I take, and how reversible/high-stakes was it?"* "Observe-only" is not an action; it is a **memory state** ("I'm tracking this, I did nothing"). Putting it in the band axis conflates two different things and dilutes the product's sharpest abstraction. Situations already model "I'm watching this" precisely.

The only real argument for a fifth band was *visibility* — CSMs wanting to see "the agent noticed" as a number. That need is satisfied better by a **Situations metric** in the digest (e.g. *"8 situations being watched"*) than by inflating the act count with non-actions. So: visibility need met, bands stay four. (Captured in `extension-surface` "observe-only is satisfied without a new band.")

### D2 — Situations are keyed by `(businessId, kind)`, one open per key

**Decision: account-level situations are keyed by `(businessId, kind)`; renewal-level situations are keyed by `(businessId, kind, renewalId)`.** `kind` is a **closed enum** — `renewal-risk`, `adoption-gap`, `support-escalation`, `relationship-change`, `billing-issue`, `other`. For `renewal-risk`, the `renewalId` is part of the identity, because one account can have **multiple distinct renewals**, each its own storyline — `(businessId, kind)` alone would wrongly collapse them. Enforce as an invariant: **at most one non-resolved Situation per identity.** This is what makes "no re-discovery" robust across all sweeps rather than only within one. (Captured in `situation-threads`.)

> **The domain relation: `Renewal → CTA → Task`.** A Renewal is the commercial object; a **CTA** binds work to that renewal; a **Task** is a discrete step spawned under the CTA (e.g. `T-90 Renewal Reminder`). The task carries `cta.renewalId`, so the join from a task back to its renewal is exact. A task is therefore a *sub-step* of working a renewal — **not** a competing duplicate.
>
> **Two levels, two status lifecycles — kept separate.** The renewal has its own status (advanced via `renewal-writeback` / `csp_update_renewal`); the task has its own status (`NOT_STARTED`/`IN_PROGRESS`/`BLOCKED`/`COMPLETED`, via `task_complete`/`task_block`). Completing a task does **not** move the renewal's status, and vice versa — each sweep writes only its own level. In fact there are **four distinct status concepts** that must never be mapped onto each other (this extends the existing CLAUDE.md rule about not mapping CSP's PriorityBand onto the agent's action band):
>
> | Status | Owner | Advanced by |
> |---|---|---|
> | Renewal status / playbook | CSP (renewal) | `renewal-writeback` |
> | Task status | CSP (task) | `task_complete` / `task_block` |
> | Action band | agent | `act` / `notify-then-act` / `escalate` / `prep` |
> | Situation status | agent | open / watching / escalated / resolved |
>
> The **Situation** is the only thing that unifies the two CSP levels — as the agent's storyline across them — without collapsing their statuses.
>
> **Renewals are now a first-class input.** Today renewals are reached only *via* an account (`csp_get_renewals`) or *via* a task's CTA. We add a third input source `RenewalSource` and a named **renewal sweep**, so the agent works upcoming/at-risk renewals directly on the renewal timeline (T-90/T-60/T-30) rather than hoping the account sweep notices. This is the strongest test of the identity rule: three independent entry points to the same renewal must collapse to one Situation. The convergence key is `renewalId`: the renewal sweep uses the renewal's id, the task sweep uses `cta.renewalId`, and they meet on the same thread. (Captured in `renewal-source`; write-back reuses `renewal-writeback`.)
>
> ```
> Renewal ──▶ CTA ──▶ Task        all carry the same renewalId
>    │          │        │
> renewal     account   task      ──▶ Work Loop ──▶ ONE renewal-risk Situation
>  sweep       sweep    sweep                          keyed by renewalId
>                                                       (no forking; two renewals
>                                                        on one account = two threads)
> ```

### D3 — `nextCheckpoint` is agent-chosen, with a default and clamp

**Decision: the agent sets `nextCheckpoint` per Situation** (more human — "I'll look again after the weekend" vs. "next quarter"), defaulting to **72h** when it doesn't specify, and **clamped to `[1h, 30d]`** to prevent pathological values (revisit-every-cycle thrash, or never-revisit). A fixed global window was rejected: it cannot tell a 16-day renewal from a slow adoption drift. (Captured in `situation-threads`.)

### D4 — Start fresh; do not back-fill history

**Decision: Situations begin accumulating at deploy; no migration of historical ledger rows.** Back-filling requires clustering heuristics ("which of these `act`s are the same storyline?") that are error-prone and low-value — the value of Situations is *forward* continuity, not reconstructing the past. The historical ledger stays exactly as-is and readable. A one-time best-effort grouping is explicitly a *later, optional* nice-to-have, out of scope here.

### D5 — Keep the three-number headline; the third number becomes situations

**Decision: preserve the punchy format, reframe the "need you" number around Situations.**

```
before:  "Yesterday: 47 acts, 12 notifies in-flight, 2 escalations need you."
after:   "Yesterday: 47 acts, 12 notifies in-flight, 3 situations need you."
                                                      └─ escalated situations,
                                                         each expandable to its storyline
```

`acts` and `notifies` stay as action counts (they answer "what did the agent do"). The third number — the one the CSM acts on — becomes **situations needing you** (status `escalated`, plus any `open`/`watching` flagged needs-attention), because that item should open into a *storyline*, not a lone event. "Escalation" remains the band; "situation needing you" is how it's surfaced. (Captured in `situation-threads` digest requirement.)

### D6 — Derive the renewal queue from accounts + a due-window

**Decision: `RenewalSource.listOpen()` derives its queue from the account list + per-account `csp_get_renewals`, filtered to a due/at-risk window (default 90 days, `RENEWAL_WINDOW_DAYS`).** CSP exposes renewals only **per account** (`GET /accounts/:id/renewals`), with no portfolio-wide "all my upcoming renewals" endpoint. Rather than block on a new CSP endpoint, the CSP-backed source iterates the CSM's accounts once per cycle and collects renewals that are either within the window or already flagged at-risk. The 90-day default covers the T-90 playbook onward. This is entirely behind the `RenewalSource` abstraction, so if CSP later ships a portfolio renewal endpoint, only the implementation swaps. *(Product call you can override: the window length and whether "at-risk regardless of date" should always be included.)*

### D7 — Task-first for steps; renewal sweep owns the gaps

**Decision: the task sweep owns any step that has an open CSP task; the renewal sweep owns (a) renewals with no task yet, (b) renewal-level status/playbook advancement no task covers, and (c) opening/maintaining the renewal-risk Situation.** A task is the CSM's concrete unit of work (a CTA sub-step), so when it exists it is the right owner of *doing* that step. The renewal sweep is the safety net and the renewal-level actor: it never repeats a step a task owns (dedup via the shared `renewalId` Situation + ledger linkage), but it ensures no at-risk renewal falls through merely because CSP hasn't spawned a task, and it advances renewal-level status that lives above any single task. Both write into the one Situation. *(This is already encoded in the `renewal-source` requirements; D7 names it as the deliberate position.)*

## Still deferred (genuinely future, not blocking)

- One-time historical back-fill of Situations (see D4) — optional, later.
- Whether `kind` should become extensible (an enum today; could join the policy-as-registered-set seam later if extensions need custom kinds).
