# Tasks — Action Verification (the critic)

> Planning only. Ordered: seam → wire into tools → default critic → surfacing → tests.

## 1. The Verifier seam

- [ ] 1.1 Add `Verifier` + `VerificationResult` types to `@cerebro-claw/shared`.
- [ ] 1.2 Add a no-op verifier (always-pass) for the disabled path + tests/dev.

## 2. Gate the high-stakes bands

- [ ] 2.1 `ActionPolicyToolsContext` accepts an optional `verify` callback + `verifyBands` set (default `["notify-then-act","escalate"]`).
- [ ] 2.2 In `notify_then_send_to_customer` and `escalate`: run `verify` after the override gate, before record/send.
- [ ] 2.3 On fail: record a `failed` ledger entry (note = reason), return a failure ToolResult; do NOT schedule/brief. No auto-downgrade.
- [ ] 2.4 Pass available signals/situation/payload into the verifier input.

## 3. Default LLM critic

- [ ] 3.1 Implement an adversarial LLM-critic `Verifier` (a cheap `agent.prompt` pass, prompted to refute; default fail on uncertainty).
- [ ] 3.2 Wire it in `app.ts`; `VERIFY_ENABLED` (default on) and `VERIFY_BANDS` config; `.env.example`.

## 4. Surfacing

- [ ] 4.1 Ensure blocked-by-verifier actions appear in `/api/ledger` (status failed) and are countable in the digest.
- [ ] 4.2 Add the Verifier to `docs/extending.md`; note the Decide→Act critic in `docs/architecture.md`.

## 5. Tests

- [ ] 5.1 Verifier seam: pass/fail verdict shape; disabled = always pass.
- [ ] 5.2 notify/escalate gated; act/prep not gated; override gate precedes verifier.
- [ ] 5.3 Failed verification: no send scheduled, failed entry recorded with reason, failure returned.
- [ ] 5.4 Passed verification: action + pause window proceed unchanged.
