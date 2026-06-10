# Cerebro Claw — Canonical Glossary

One concept, one name. Use the canonical term everywhere — UI, API, docs, comments. The forbidden column lists synonyms that have caused confusion; do not use them for that concept.

| Concept | Canonical term | Do NOT call it |
|---|---|---|
| The agent's stream of recorded actions | **Activity** (storage term: *ledger* / `action_ledger`) | "Pipeline", "Task Stream" |
| A CSP-assigned unit of work (CTA-derived) | **Task** | (reserved — never used for the action stream) |
| A persistent storyline of related actions for an account/renewal | **Situation** | "watch"/"thread" as a noun is informal only — but `watching` IS a valid Situation *status* |
| The commercial renewal object | **Renewal** | — |
| The CSP object binding work to a renewal; spawns tasks | **CTA** | — |
| The per-cycle engine that runs the agent | **Work Loop** | "Brain Loop" (legacy) |
| One pass over accounts within a cycle | **account sweep** | — |
| One pass over tasks within a cycle | **task sweep** | — |
| One pass over renewals within a cycle | **renewal sweep** | — |
| The four action classes | **bands** — `act` / `notify-then-act` / `escalate` / `prep` | (never rename these) |

## The four status concepts — never map one onto another

These are four *distinct* lifecycles. Conflating them is a recurring bug (it extends the existing rule that CSP's due-date *PriorityBand* is not the agent's action band).

| Status | Owner | Advanced by |
|---|---|---|
| Renewal status / playbook | CSP (renewal level) | `csp_update_renewal` (renewal-writeback) |
| Task status (`NOT_STARTED`/`IN_PROGRESS`/`BLOCKED`/`COMPLETED`) | CSP (task level) | `task_complete` / `task_block` |
| Action band (`act`/`notify-then-act`/`escalate`/`prep`) | agent | the band's tool |
| Situation status (`open`/`watching`/`escalated`/`resolved`) | agent | `situation_open` / `situation_advance` / `situation_resolve` |

The **Situation** is the only thing that unifies the two CSP levels — as the agent's storyline across them — without collapsing their statuses.

## The domain hierarchy

```
Renewal ──▶ CTA ──▶ Task        (all carry the same renewalId)
```

A Task is a *sub-step* of working a Renewal, joined through the CTA (`cta.renewalId`). The renewal sweep works the renewal level; the task sweep works task steps; both converge on the single per-`renewalId` `renewal-risk` Situation.
