## Outcome

Add a verification step (a *critic*) between Decide and Act for the high-stakes bands, so the agent checks that an action actually follows from the signals before it commits — the documented "give the model a way to verify its work" pattern that improves agent quality 2–3×.

## Why

The agent currently **acts without ever checking itself.** When it calls `notify_then_send_to_customer` or `escalate`, the action is recorded and (for notify) scheduled to send, with nothing confirming the action is consistent with the account's signals and situation. The only safety nets are:

- the **override gate** — a hard *policy floor* (a customer flagged "escalate-only" can't be notified), and
- the **pause window** — a *human* cancel opportunity for notify-then-act.

Neither catches the common failure: a *plausible but wrong* action that passes policy and that a busy CSM won't catch in the pause window — e.g. a renewal nudge sent to an account whose signals don't actually warrant a customer touch, or an escalation that misreads the situation. The harness literature is consistent that an automated verification/feedback loop is the single biggest quality multiplier, and it is the one mature-harness component Cerebro lacks.

## What Changes

- **Introduce a `Verifier` seam.** A pluggable check that, given the subject's signals + open Situation + the agent's *proposed* action, returns `{ pass, reason, suggestedBand? }`. Default implementation is a cheap LLM critic pass prompted to **refute** the action; it can be swapped for a rule-based verifier or disabled.
- **Gate the high-stakes bands.** Before `notify_then_send_to_customer` schedules a send, and before `escalate` briefs the CSM, run the verifier. On **fail**, the action is **not taken** — it is recorded as `failed` with the critic's reason and the agent is told (so it can choose a different band or no action). `act` and `prep` are NOT gated (reversible / internal / CSM-owned).
- **Run at the tool layer**, so the gate covers every path that fires these bands — the work loop *and* any chat-driven action — not just one call site.
- **Surface verifier outcomes** in the Activity log and digest (a blocked action is visible, so the CSM sees the agent caught itself).

## Capabilities

### New Capabilities
- `action-verification`: a pluggable `Verifier` that gates the `notify-then-act` and `escalate` bands at decision time; failing verification blocks the action and records why, complementing (not replacing) the override gate and pause window.

## Impact

- **Shared types:** add a `Verifier` interface + `VerificationResult` to `@cerebro-claw/shared`.
- **Tools:** the action-policy tools accept a `verify` callback; `notify`/`escalate` call it before recording/sending; a failed verification short-circuits with a `failed`/blocked result.
- **Server:** a default LLM-critic `Verifier` (a second cheap `agent.prompt` pass) wired in `app.ts`; `VERIFY_ENABLED` / `VERIFY_BANDS` config.
- **Ledger/digest:** blocked-by-verifier actions recorded (status `failed`, note = critic reason); digest can surface them.
- **Docs:** add the Verifier to `docs/extending.md` as a seam; note in `docs/architecture.md` that Decide→Act now has a critic.

## Non-goals

- **Not** gating `act`/`prep` (reversible/internal — gating them adds cost for no risk reduction).
- **Not** auto-downgrading a failed action to a lower band (the agent is told and re-decides; auto-rewrite is out of scope — see design open question).
- **Not** removing the override gate or pause window — the critic is a third, complementary check.
