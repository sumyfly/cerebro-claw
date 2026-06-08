# Design — Action Verification (the critic)

## The three checks, kept distinct

Cerebro will have **three** independent gates on an action; this change adds the third. Keeping them separate is the whole point (they catch different failures):

| Gate | Question it answers | Failure it catches |
|---|---|---|
| **Override gate** (exists) | "Is this band *allowed* for this account?" | policy violation (escalate-only account being notified) |
| **Verifier / critic** (NEW) | "Does this action *follow from the signals*?" | plausible-but-wrong action |
| **Pause window** (exists) | "Does the human want to stop it?" | anything the human catches in time |

```
Decide ──▶ [override gate] ──▶ [VERIFIER] ──▶ Act ──▶ (notify only) [pause window] ──▶ send
            policy floor        signal-consistency        human cancel
```

## Where it runs — the tool layer

The verifier runs **inside the action-policy tools** (`notify_then_send_to_customer`, `escalate`), right after the override gate and before `ledger.record`. This is the same place the override gate lives, and it means the critic covers **every** caller — the work loop, the renewal sweep, and any chat-driven action — with one implementation. Running it in the brain loop only would miss chat-fired actions.

## The Verifier seam

```ts
interface VerificationResult { pass: boolean; reason: string; suggestedBand?: string }
interface Verifier {
  verify(input: {
    band: string;
    customerId: string;
    summary: string;
    reason: string;
    signals?: string;       // the perceived context, when available
    situation?: string;     // the open storyline, when available
    payload?: Record<string, unknown>;
  }): Promise<VerificationResult>;
}
```

Pluggable like every other seam (`docs/extending.md`). Default = an **LLM critic**: a second, cheap `agent.prompt` pass prompted to *try to refute* the action ("default to fail if the action doesn't clearly follow from the signals"). Adversarial-by-default is deliberate — a critic told to find problems catches more than one told to rubber-stamp.

## Decisions (resolved)

### D1 — Gate `notify-then-act` and `escalate` only
`act` (reversible/internal) and `prep` (CSM-owned artifact) are not gated. Gating them spends a critic call per action for no risk reduction. The gated set is configurable (`VERIFY_BANDS`) but defaults to the two stakes-bearing bands.

### D2 — Default verifier is an adversarial LLM critic, pluggable
A second cheap prompt that defaults to `fail` when the action doesn't clearly follow from the signals. Swappable for a rule-based verifier or disabled via `VERIFY_ENABLED=false` (then `verify` is a no-op that always passes — identical to today's behavior).

### D3 — On fail: block + record + tell the agent (no auto-rewrite)
A failed verification means the action is **not taken**: a `failed` ledger entry is recorded with the critic's reason, and the tool returns a failure result so the agent can pick a different band or stand down. We do **not** silently rewrite the action to `suggestedBand` — that field is advice surfaced to the agent, not an automatic action.

### D4 — Complementary to the existing gates, ordered after the override gate
Order: override gate → verifier → record/send. The override gate is a hard policy floor (cheap, runs first); the verifier is the signal-consistency check (costs a model call, runs only if policy allows).

### D5 — Verifier failures are visible
A blocked action is recorded (status `failed`, note = critic reason) so the digest/Activity shows the agent caught itself — this is signal, not noise (it tells the CSM the critic is working, and surfaces systematic misfires).

## Open questions (build-time)

1. **Cost control.** A critic call per notify/escalate doubles model calls *for those bands only*. Acceptable since they're the minority of actions, but worth a metric. A rule-based fast-path (skip the LLM when signals obviously support the action) is a possible later optimization.
2. **Auto-downgrade.** D3 says no auto-rewrite. If data later shows the agent usually just re-fires the `suggestedBand`, revisit allowing the verifier to downgrade `notify → act` automatically.
3. **Verifying with vs. without fresh signals.** The verifier is strongest when given the same signals the agent saw. In chat-fired actions those may be absent; the critic then judges on summary/reason alone (weaker but still useful).
