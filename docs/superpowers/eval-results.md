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
