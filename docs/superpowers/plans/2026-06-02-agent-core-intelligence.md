# Agent Core Intelligence (Phase 3/4) — Plan & Ralph-loop state tracker

> Cross-iteration state. Check items off as they land green + committed.
> Goal: the agent core has REAL CSM judgment over Cerebro (CSP) data — a
> decision engine (signals + enforced overrides + change-detection), wired into
> the real brain loop, and PROVEN with real Claude Code on an honest scenario
> battery (ambiguous + adversarial cases, not just the easy ends).

## Definition of done (the COMPLETED promise is only true when ALL are checked)

### A. The decision engine (intelligence in code, judgment in LLM)
- [x] A1. `signals.ts` — pure `computeSignals(snapshot)`: health/usage/renewal/ARR
      + bucketed signal fingerprint for change detection. 10 tests. (bcc8cbf)
- [x] A2. `decision-context.ts` — render structured "Decision signals" block
      (signals + hard override directive + change guidance + instincts). 6 tests. (fc28fc6)
- [x] A3. Override enforcement — HARD GATE at the action-policy tool layer:
      act/notify/prep refused + redirected when an override forces a stricter
      band; escalate always allowed. 6 tests. (5bc091b)
- [ ] A4. Change-detection / decision memory — persist per-account
      {signalFingerprint, lastBand, lastReason, ts}; no-op when nothing changed;
      feed last decision into context. Unit-tested.

### B. Wire the engine into the real CSM loop over Cerebro
- [ ] B1. A CSP-fetching account source/snapshot builder that fetches the account
      server-side, computes signals, and injects the decision context — wiring the
      engine into the production brain loop (not just eval).
- [ ] B2. Override + decision-memory stores backed by SQLite (survive restarts).

### C. Honest measurement (don't cheat)
- [ ] C1. Fix scorer act-band blindness: count `csp_create_note`/`memory_instinct`
      (or route the eval's "act" through the `act` tool) so `expect: act` is real.
- [ ] C2. Expand scenario battery to >=8 incl. ambiguous (usage-drop-on-healthy →
      act, NOT escalate), override (escalate-everything), no-change (dedup → none),
      renewal-30d (notify/prep), discount-request (escalate).
- [ ] C3. Run eval against REAL claude; record honest scores; iterate the engine
      until the battery genuinely passes (no gaming, no weakening assertions to pass).

## Verification gate for COMPLETED
- `pnpm turbo build` green; `pnpm --filter {memory,tools,server} test` green.
- `pnpm --filter @cerebro-claw/server eval` run against real `claude`, scorecard
  pasted into git (eval-results log), with the ambiguous/override/no-change cases
  passing for the RIGHT reason (engine present), not by luck.

## Notes
- "Data source is cerebro": eval uses MockCspTransport fed cerebro-SHAPED fixtures
  (deterministic, repeatable) + real claude reasoning. Live CSP backend needs
  CSP_TOKEN (not available); mock fixtures are the faithful, non-cheating stand-in.
- claude-code returns toolCalls:[]; ledger is the ground truth. For act-band
  visibility (C1) the scorer must read CSP-note writes too — surface via the mock
  transport's recorded POSTs or route act through the `act` tool.

## Log
- iter1: branch created; plan written. Starting A1 (signals).
