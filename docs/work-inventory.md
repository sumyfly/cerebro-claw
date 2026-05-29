# Work Inventory

The ~33 distinct CSM work types Cerebro Claw can take on. Each is classified by action band (see `csm-ai-colleague-product-vision.md` for what the bands mean) and by what we can do today vs what's blocked on missing tools.

## Act band (12)

Reversible, low-stakes, fact-based. The agent does these without asking. CSM sees a summary in the daily digest.

| # | Work | Trigger | Ready today? |
|---|---|---|---|
| 1 | Daily portfolio scan | Every brain-loop cycle | ✅ |
| 2 | Renewal pipeline scan | Renewals in next 30/60/90d | ✅ |
| 3 | Health-change detection | Score moved category since last cycle | ✅ |
| 4 | Usage-drop detection | Engagement down ≥X% vs last period | ✅ |
| 5 | Silent-customer detection | No CSM contact in N days | ✅ |
| 6 | Dormant-feature detection | Feature enabled, zero use (e.g. Beep delivery) | ✅ |
| 7 | Aged-ticket detection | Open ticket older than threshold | ✅ (read-only) |
| 8 | Log a CSP note on what changed | When a signal flips | ✅ (`csp_create_note`) |
| 9 | Capture CSM instinct from chat | CSM tells the agent something to remember | ✅ (`memory_instinct`) |
| 10 | Capture observations as instinct | Brain loop notices a pattern, stores it | ✅ |
| 11 | Internal Lark ping to the CSM | "FYI Acme renewal is now 30d out" | ✅ (`send_message`) |
| 12 | Daily morning digest in Lark | One Lark message with the day's three numbers | ✅ (digest endpoint exists) |

## Notify-then-act band (8)

Customer-facing but routine. CSM gets a heads-up; agent sends unless paused inside a short window.

| # | Work | Trigger | Pause | Ready today? |
|---|---|---|---|---|
| 13 | Routine monthly check-in to healthy customer | 30d silence, no risk signals | 4h | ❌ no send tool |
| 14 | Feature-adoption nudge | Dormant feature with known value | 4h | ❌ no send tool |
| 15 | Post-onboarding 30d touchpoint | New healthy account | 4h | ❌ no send tool |
| 16 | Renewal nudge | Approaching renewal, normal health | 4h | ❌ no send tool |
| 17 | Re-engagement attempt | Silent customer, no risk signals | 24h | ❌ no send tool |
| 18 | EOY / Q-end relationship pulse | Seasonal, healthy book | 24h | ❌ no send tool |
| 19 | Aged-ticket nudge to support team | Internal escalation | 1h | ✅ (internal) |
| 20 | Aged-feature-request nudge to engineering | Internal coordination | 1h | ✅ (internal) |

## Escalate band (8)

Irreversible, high-stakes, or genuinely ambiguous. Agent briefs the CSM with full context and a recommended decision.

| # | Work | Why escalate | Ready today? |
|---|---|---|---|
| 21 | Churn intervention | High consequence if wrong | ✅ (briefing only) |
| 22 | Renewal at risk (<14d, low health) | High stakes | ✅ |
| 23 | Discount or commercial concession | Money decision | ✅ |
| 24 | Contract amendment | Legal/financial | ✅ |
| 25 | Stakeholder change at customer | Relationship judgment | ✅ |
| 26 | Complaint or NPS detractor | Tone-sensitive | ✅ |
| 27 | Cross-sell / upsell pitch | Timing and pitch are CSM craft | ✅ |
| 28 | Multi-account pattern (product issue affecting cohort) | Cross-functional | ✅ |

## Prep band (5)

CSM owns the conversation; agent ships a finished v1.

| # | Work | Output | Ready today? |
|---|---|---|---|
| 29 | Pre-call brief | 1-page brief in Lark 30 min before | ✅ |
| 30 | Renewal brief | Talking points + risk read 30d out | ✅ |
| 31 | QBR deck v1 | Filled deck, CSM edits | Partial (no slide-generation tool) |
| 32 | Weekly portfolio status | One message every Monday | ✅ |
| 33 | Account handoff brief | When CSM ownership changes | ✅ |

## Summary

| Band | Total | Ready today | Blocked |
|---|---|---|---|
| Act | 12 | 12 | 0 |
| Notify-then-act | 8 | 2 | 6 (need customer-facing send tool) |
| Escalate | 8 | 8 | 0 |
| Prep | 5 | 4 | 1 (deck builder) |
| **Total** | **33** | **26** | **7** |

**~80% of the work surface is unlocked today.** The biggest single gap is the customer-facing send tool, which unlocks 6 of the 7 blocked items.
