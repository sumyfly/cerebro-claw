# Architecture — the agent as a loop

Cerebro Claw is one thing turning one crank: **Perceive → Decide → Act → Remember**, run once per account, task, and renewal every cycle by the **Work Loop**.

```
        ┌──────────────────────────────────────────────────────────────┐
        │                                                                │
        ▼                                                                │
   ┌─────────┐      ┌──────────┐      ┌─────────┐      ┌──────────────┐ │
   │ PERCEIVE│─────▶│  DECIDE  │─────▶│   ACT   │─────▶│   REMEMBER   │─┘
   ├─────────┤      ├──────────┤      ├─────────┤      ├──────────────┤
   │ engine/ │      │ agent.   │      │ 4 bands │      │ ledger       │
   │ signals │      │ prompt() │      │ + tools │      │ + instincts  │
   │ snapshot│      │ + band   │      │ + dispat│      │ + situations │
   │ + open  │      │  policy  │      │  cher   │      │              │
   │ situ.   │      │          │      │         │      │              │
   └─────────┘      └──────────┘      └─────────┘      └──────────────┘
   "what's true"    "what to do"      "do it"          "carry forward"
```

## Inputs — three sweeps, one loop

The Work Loop iterates three inputs each cycle, independently (any can run when the others are empty):

| Sweep | Source | Selection |
|---|---|---|
| **account sweep** | `AccountSource` (CSP / local) | `CSP_TOKEN` + `CSP_CSM_EMAIL` |
| **task sweep** | `TaskSource` (CSP / stub) | `TASK_SOURCE=csp\|stub` |
| **renewal sweep** | `RenewalSource` (CSP / stub) | `RENEWAL_SOURCE=csp\|stub` |

Domain hierarchy: **Renewal → CTA → Task**. All three sweeps converge on one per-`renewalId` `renewal-risk` Situation, so no entry point forks the storyline.

## The four phases → where the code lives

| Phase | What it does | Code |
|---|---|---|
| **Triage** (front of Perceive) | Score each subject **risk × value × urgency** (no model call) and keep only the top-N above a floor per cycle — spend agent turns on what matters | `engine/triage` (`computeTriageScore`, `selectByTriage`); `TRIAGE_MAX`/`TRIAGE_MIN_SCORE` |
| **Perceive** | Build side-effect-free context: CSP signals, snapshot, and the subject's **open Situations** | `engine/signals`, `engine/csp-snapshot`, `engine/decision-context` (`renderSituations`), `engine/task-context`, `engine/renewal-context` |
| **Decide** | The agent (`claude` over MCP) picks a band; the policy is a registered set | `claude-code-runtime`, `review-prompt`, `ExtensionHost.getBands()` |
| **Decide → Act gate** | A **critic** (`Verifier`) checks a high-stakes action follows from the signals before it commits — the third gate after the override floor and before the pause window | `verifier.ts`, action-policy tools |
| **Act** | The band's tool does the work; the dispatcher sends due notify-then-act | `tools/` (act/notify/escalate/prep), `dispatcher` |
| **Remember** | Append to the **ledger** (Activity), keep agent-private **instincts**, and maintain **Situations** (the storyline across cycles) | `memory/` (`ActionLedger`, `MemoryStore`, `SituationStore`) |

## The Situation — the "Remember" that makes it human

A **Situation** is a persistent storyline for an account/renewal. Perceive loads the open ones; the agent advances/resolves them via `situation_open` / `situation_advance` / `situation_resolve` instead of re-discovering the same risk every cycle. "Just watching" is a Situation, **not** an `act`. Ledger entries carry `situationId`/`renewalId` so the Activity stream renders a storyline.

See [glossary.md](./glossary.md) for the canonical vocabulary and the four distinct status concepts (renewal status, task status, action band, situation status — never mapped onto each other).
