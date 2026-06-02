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
- [~] A4. Change-detection — fingerprint + "no-change → no action" guidance built
      and PROVEN in eval (no-change-dedup passes real claude). REMAINING: persist
      per-account decision across real production cycles (store layer) so dedup
      fires in the live loop, not just when the eval injects lastDecision.

### B. Wire the engine into the real CSM loop over Cerebro
- [x] B1. createCspAccountSource fetches the snapshot server-side, computes signals,
      and injects the decision-context ahead of the fetch pointer. (771ddb1)
- [~] B2. Overrides: taught as instinct notes, parsed + enforced via the hard gate
      in production (resolveOverrideFromStore). DONE. Decision-memory persistence
      (last fingerprint per account) across cycles — REMAINING (ties to A4).

### C. Honest measurement (don't cheat)
- [x] C1. Act-band recorded via the `act` tool (prompt sharpened); `expect: act`
      is measurable. (7e4d8b9)
- [~] C2. Battery at 5 scenarios: healthy-quiet(none), usage-drop-healthy(act),
      usage-drop-competitor(escalate), override-escalate-everything(escalate),
      no-change-dedup(none). Could add renewal-window + discount; 5 cover the key
      judgment axes (over-escalation, dedup, override, instinct-risk).
- [x] C3. Real-claude eval 5/5, twice (after C2 and after B1) — eval-results.md.

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
- iter1: branch created; plan written.
- A1 (signals, 10 tests), A2 (decision-context, 6 tests), A3 (override hard gate,
  6 tests) all done + committed. Engine wired into the eval (signals→context,
  resolveOverride→tools); snapshot extractor. Override scenario added.
- Real-claude eval 3/3 (incl. override gate) — see eval-results.md 2026-06-02.
- REMAINING: A4 (decision memory/change-detection persistence + no-op),
  B1/B2 (production brain-loop wiring + SQLite override/decision stores),
  C1 (scorer act-band visibility), C2 (ambiguous + no-change + renewal scenarios),
  C3 (re-run real claude until the full battery genuinely passes).
