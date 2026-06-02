# Agent-core eval results (real Claude Code runs)

Honest log of `pnpm --filter @cerebro-claw/server eval` against the live `claude`
subprocess. No gamed passes; assertions are not weakened to make scenarios green.

## 2026-06-02 — engine wired in (signals + decision-context + override gate)

Model: claude-sonnet-4 (Claude Code login). 3 scenarios.

```
[PASS] healthy-quiet: expected none, got none
[PASS] override-escalate-everything: expected escalate, got escalate
[PASS] usage-drop-competitor: expected escalate, got escalate
3/3 passed
```

Notes:
- `override-escalate-everything` is the meaningful one: a grade-A, usage-up
  account the agent would normally leave alone — the override + hard gate forced
  escalate, and it escalated. Validates A3 end-to-end with the real model.
- Battery still small. NOT yet covered (in progress): ambiguous usage-drop on a
  HEALTHY account → should be `act` not escalate (needs C1 scorer act-band);
  no-change dedup → `none` (needs A4 decision memory); renewal-window → notify/prep.
- Reminder: claude-code reports toolCalls:[]; scores are read from the action
  ledger (ground truth of what the agent did), not the runtime.

## 2026-06-02 — full judgment battery (5 scenarios)

After C1/C2/A4 (act-band recording, ambiguous + no-change scenarios).

```
[PASS] healthy-quiet: expected none, got none
[PASS] no-change-dedup: expected none, got none
[PASS] override-escalate-everything: expected escalate, got escalate
[PASS] usage-drop-competitor: expected escalate, got escalate
[PASS] usage-drop-healthy: expected act, got act
5/5 passed
```

Notes:
- The two hard cases passed for the right reason: `usage-drop-healthy` → `act`
  (did NOT over-escalate a routine dip), `no-change-dedup` → `none` (did NOT
  re-act when the signal fingerprint was unchanged from last cycle).
- This validates the engine (signals + decision-context + override gate) against
  the real model on the AMBIGUOUS middle, not just the easy ends.
- STILL OUTSTANDING for "actual CSM over cerebro": the engine is wired into the
  EVAL; it must also be wired into the PRODUCTION brain loop (B1) with persisted
  override + decision stores (B2). Until then the intelligence lives in the test
  rig, not the running agent.


## 2026-06-02 — final state (engine in production loop + persisted decision memory)

After A4/B1/B2 + honesty fix. Run on the final committed branch state.

```
[PASS] healthy-quiet: expected none, got none
[PASS] no-change-dedup: expected none, got none
[PASS] override-escalate-everything: expected escalate, got escalate
[PASS] usage-drop-competitor: expected escalate, got escalate
[PASS] usage-drop-healthy: expected act, got act
5/5 passed
```

Status: decision engine (signals + decision-context + override hard gate +
persisted change-detection) is wired into BOTH the eval and the production CSP
account source. Verified across multiple real-claude runs. Honest caveats:
live-Cerebro run needs a CSP token (unavailable) — eval uses cerebro-shaped
fixtures + real claude; claude-code reports toolCalls:[] so scores are read from
the action ledger (ground truth).
