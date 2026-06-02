# Cerebro Agent Core — Design

**Date:** 2026-06-01
**Status:** Approved for planning
**Author:** brainstormed with Edward Qian

## Problem

The agent's "intelligence" today is three thin things: one static system prompt
(`agent-runtime.ts:27-59`), a flat per-account prompt (`brain-loop.ts:233-243`),
and a standard tool loop. The "action policy — the core IP" is a prose paragraph,
not a decision engine. There is **no classifier, no override enforcement, no
change-detection, no decision memory, and no evaluation of whether the agent's
judgment is any good.** Whether the agent is "smart enough" is an untested
assumption.

The customer-facing send channel is a stub — but that is plumbing, not the core.
This work deliberately keeps all I/O stubbed and goes straight at the core: the
logic, the intelligence, and Cerebro's API/tool calling.

## Goal

Make the agent's core **demonstrably** intelligent:

1. Stub all customer/CSM I/O so the loop runs fully offline.
2. Build an eval harness that measures band-classification + tool-use quality
   against known-correct scenarios.
3. Build a real decision engine (signals + override enforcement +
   change-detection + decision memory) and harden the API/tool calling —
   improving against the harness so every change is measured.

## Decisions (locked)

| Decision | Choice | Why |
|---|---|---|
| LLM access | **claude-code subprocess only** (user's login, no API key) | No Anthropic API key available. claude-code runs on the existing Claude Code login — real intelligence, zero key, no API cost. We fix it to carry the Cerebro persona. |
| "Call function" | **Stub customer voice-call tool** | Alongside stubbed send/receive messaging. Logs intent, sends nothing. |
| Where the classifier lives | **Hybrid** — signals in code, band chosen by LLM, overrides enforced as a hard gate | Matches the vision ("weights reversibility, ARR, time pressure, overrides") without faking CSM judgment in code. |
| Eval scoring | **Ledger-only, deterministic (no LLM judge)** | No API key, so no judge model. Score on objective ledger facts + cheap heuristic checks. Runtime-agnostic ground truth of what the agent did. |

**Hard constraint:** there is **no Anthropic API key**. The agent's reasoning
runs *only* via the claude-code subprocess (the user's Claude Code login). No
LLM judge and no other model calls anywhere — the eval grades on ledger facts
and heuristics, and unit tests use a scripted mock model.

**Key constraint from the runtime choice:** the claude-code runtime runs the
agent in a subprocess and reports `toolCalls: []`. The parent cannot see
in-process tool calls. But every real action (`act`/`notify`/`escalate`/`prep`)
writes to the **action ledger**. The ledger is therefore our ground truth for
"what did the agent decide" — runtime-independent and already present.

## Architecture — phased

### Phase 0 — Stub the world (offline-first)

| Component | Where | What |
|---|---|---|
| `StubCustomerChannel` (exists) | `packages/tools` | Customer messages. Keep as-is. |
| `customer_call` capability | `packages/tools` | Add `call()` to `CustomerChannel`; stub logs intent + a stub transcript, sends nothing. Customer-facing, so it flows through the same band classification. |
| `StubCsmChannel` | `packages/tools` (new) | Replaces Lark when offline. Captures heads-ups, escalation briefs, approval cards into an in-memory inbox the eval asserts on. Lets tests inject CSM replies/cancels. |
| `MockCspProvider` | `extensions/csp-connector` (env-gated `CSP_MOCK=1`) | `csp_*` tools read scenario fixtures instead of hitting `cspapi.test.shub.us`, so the agent does its real fetch-then-decide flow on deterministic data. |

### Phase 1 — Make the runtime carry the brain

- Fix `ClaudeCodeRuntime` to inject the full Cerebro `SYSTEM_PROMPT` (+ action
  policy) via `--append-system-prompt`, not just customer context. (Closes the
  persona gap the audit found.)
- Verify action-policy / memory / `csp_*` / new call tools are all exposed over
  `/mcp` via `host.getTools()`.
- Observability: the eval reads the **action ledger** as the decision record
  (runtime-agnostic). Add a lightweight MCP-layer tool-call log for debugging.

### Phase 2 — Eval harness (prove it's smart)

- **Scenario fixtures** (`packages/server/src/eval/scenarios/`): ~20–30 cases
  derived from `docs/work-inventory.md` (33 work types) + adversarial edges.
  Each fixture = mock CSP data + memory (instincts/overrides) + expected band +
  expected tool + override-honored flag + should-act flag. Examples:
  - healthy + quiet → no action
  - usage drop on healthy account → **act** (log, watch)
  - usage drop on account flagged "evaluating competitor" → **escalate**
  - renewal in 30 days → **notify-then-act** / **prep**
  - discount / contract change request → **escalate**
  - override "escalate everything for Acme" → **escalate** regardless of signals
  - nothing changed since last cycle → **no action** (dedup)
- **Runner** (`eval/run.ts`): per scenario — reset ledger, load mock CSP +
  memory, run the per-account brain-loop prompt via claude-code, then score.
- **Scorer**: ledger-based objective metrics only — band accuracy, tool
  correctness, override honored, false-action-on-no-change,
  over/under-escalation rate. Plus cheap **heuristic** quality checks (e.g.
  escalate payloads carry situation + options + recommendation; notify payloads
  carry a non-empty message + recipient). **No LLM judge** (no API key). Emits a
  scorecard (JSON + console table).

### Phase 3 — The intelligence (improve against the harness)

- `signals.ts` — pure functions computing reversibility, ARR/contract value,
  days-to-renewal, health delta vs last cycle, time-since-last-contact, override
  presence — from CSP + memory.
- Inject a structured **"Decision signals"** block into the per-account prompt
  (replaces the thin flat prompt).
- **Override enforcement**: per-customer/per-CSM rules stored in memory. A
  post-decision **hard gate**: if an override demands a stricter band than the
  LLM chose, bump the band (or block the customer send) and log why. Enforced,
  not hoped.
- **Change-detection / decision memory**: store per-account
  `{ lastSignalFingerprint, lastBand, lastReason, ts }`. Next cycle, if the
  fingerprint is unchanged, default to no-action unless a time-based trigger
  fires. Feed the last decision + reason into context.

### Phase 4 — Harden API calling

- Retry/backoff + timeout surfacing on `csp_*` and the LLM call; failures
  recorded to the ledger (`status: failed`) instead of console-swallowed.
- **Triage**: a cheap signals pre-pass decides which accounts warrant a full
  agent turn; the rest get a quick no-op. Cuts the ~125-calls/cycle storm.
- Tool-selection discipline: tighten tool descriptions; fix the dispatcher
  cancel-race (re-check status before `channel.send()`) since it's core to the
  notify-then-act guarantee.

## Testing

- **Unit tests** (vitest, mock LLM) for: signals, override gate,
  change-detection, stub channels (message + call), mock CSP provider.
- **Eval harness** (real claude-code) is the integration measure — run on
  demand; scorecard tracked over time as the regression signal for "is it smart."

## Sequencing

Implement **Phase 0 → 1 → 2** first (stub + runtime + eval) — the block that
answers "is it smart." Then **Phase 3 → 4** (engine + hardening), each change
measured against the harness.

## Phase 3 follow-ups (surfaced by the Phase 0–2 review)

Carry these into the Phase 3 (decision engine) plan — they are foundation gaps,
not regressions:

1. **Scorer is blind to ledger-free "act".** `csp_create_note` / `memory_instinct`
   don't write to the action ledger, but the prompt tells the agent to "act" via
   them. Any future `expect: act` scenario where the agent logs a note scores as
   band `none` (false FAIL). Fix: either route the eval's "act" through the `act`
   tool, or have the scorer also count those tool calls.
2. **Wire `expect.tool` + the notify-payload heuristic.** `Scenario.expect.tool`
   is typed but never read; the spec's notify-payload check (non-empty message +
   recipient) isn't implemented. Close both when override enforcement lands.
3. **Override enforcement is a band proxy only.** `scoreScenario` just checks
   `actualBand === "escalate"`; `ScenarioOverride.forcesBand` is unused. Build the
   real per-customer/per-CSM override gate (the Phase 3 hard gate) and score against it.
4. **Severity collapse.** The scorer reduces a multi-entry run to the
   highest-severity band. When Phase 3 makes the agent do several things per
   account, score the *set* of bands instead.
5. **`process.env.CSP_MOCK_FIXTURES` global mutation isn't restored** in the
   harness — correct for sequential runs, would break a concurrent runner.

## Out of scope

- Real customer channels (email/SMS/voice) — stubbed deliberately.
- Real Lark wiring for this work — stubbed via `StubCsmChannel`.
- Anthropic-SDK runtime parity — we target claude-code for this round.
- UI changes.
