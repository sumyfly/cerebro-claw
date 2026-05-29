# CSM AI Colleague — Product Vision

## One Sentence

**An agent that handles the long tail of a CSM's portfolio so the CSM only works the accounts that matter.**

---

## The Problem

Andrew Lee is a CSM at StorehubPay with 1,327 assigned accounts. He can personally manage about 100 well. The other ~1,200 get whatever attention is left, which is roughly none.

CSP shows him what's happening. Nothing does anything about it.

---

## The Goal

Every CSM gets a partner that handles the 1,300 accounts they can't personally know.

The agent absorbs the routine work end-to-end so the CSM's inbox has **two things**, not 1,327. The agent's daily output to the CSM in Lark looks like:

> *Yesterday: 47 acts, 12 notifies in-flight, 2 escalations need you.*

## The Bright Line: Agent, Not Assistant

The agent **acts**. It does not queue.

| Same input | Assistant says | This product does |
|---|---|---|
| Usage dropped 25% on Acme | "Alert: usage dropped" | Reaches out. Logs the call. Reports outcome. |
| Renewal in 30 days | "Prep brief — here's a draft" | Briefed. Talking points in Lark. Reminder placed. |
| 30 days no contact | "Acme hasn't been contacted" | Sent a touchpoint. Tracking the reply. |
| New ticket | "Customer has a question" | Answered it. Looped CSM in only if needed. |

The CSM is in the loop for **judgment calls**, not for routine work.

## Action Policy (the core IP)

Per-action risk model. The agent picks the band per action based on reversibility, ARR, time pressure, and CSM-learned overrides.

| Band | What goes here | What the agent does |
|---|---|---|
| **Act** | Reversible, low-stakes, well-understood | Just do it. Log what was done. CSM sees a summary. |
| **Notify-then-act** | Customer-facing, routine, medium-stakes | Tell the CSM what's about to happen. Send unless paused in a short window. |
| **Escalate** | Irreversible, high-stakes, ambiguous | Don't send. Brief the CSM with full context and a recommended decision. |
| **Prep** | Artifact for a CSM-owned conversation | Ship a finished v1 (brief, deck, talking points). |

| Action class | Default band |
|---|---|
| CSP note, instinct memory, internal log | Act |
| Internal Lark ping to CSM | Act |
| Routine touchpoint to healthy customer | Notify-then-act (4h pause) |
| Renewal nudge (>30d out) | Notify-then-act (4h pause) |
| Feature-adoption nudge | Notify-then-act (4h pause) |
| Re-engagement attempt to silent customer | Notify-then-act (24h pause) |
| Discount, contract change, churn save | Escalate |
| Pre-call brief, QBR deck | Prep |

Policies override per-customer and per-CSM. "Sarah is sensitive about Acme — escalate everything for that account" gets stored and the agent reads it.

## Work Inventory

~33 distinct CSM work types Cerebro Claw can take on. See `docs/work-inventory.md` for the full list. High level:

- **12 Act items** — detection, logging, internal pings, digest
- **8 Notify-then-act items** — routine outbound (currently blocked: see below)
- **8 Escalate items** — high-stakes briefing
- **5 Prep items** — pre-call brief, renewal brief, QBR deck, weekly status, handoff brief

## What Blocks the Agent Today

| Capability gap | Blocks |
|---|---|
| **No customer-facing send tool** (email/IM to the customer themselves) | All 8 Notify-then-act items. The agent today can only ping the CSM in Lark or write a CSP note — it can't actually reach out to the customer. |
| **No calendar tool** | Pre-call timing, follow-up scheduling |
| **No CSP write APIs for activity/task/CTA** | Closing CSM activities in CSP, marking work done |

Until the send tool exists, "Notify-then-act" is theoretical. That's the next real build — everything else is policy and prompting.

## Success Criteria

- Actively-managed portfolio per CSM: **100 → 250+** accounts
- Time on portfolio admin: **−60%**
- Long-tail customer touch frequency: **0 → monthly**
- Daily escalations to the CSM: **≤ 5**, clearable in **15 min**

## Explicitly Out of Scope

| Not building | Why |
|---|---|
| A CSM dashboard replacing CSP | CSP is the source of truth; we act on it, not replace it |
| A customer-facing chatbot | Customers don't interact with Cerebro Claw directly |
| A draft-everything-for-approval queue | That's an assistant; we're not building one |
| Replacing the CSM on high-stakes decisions | Escalate band exists precisely so we don't |

## ⚠️ Why "draft for approval" is the bug, not the feature

A draft-then-approval flow looks safe but it makes the agent indistinguishable from a dashboard with extra steps. The CSM still has to triage every item. The 1,327-vs-100 ratio doesn't improve. If we keep that pattern, we've built a fancier CSP, not an agent.

The action policy above is what separates an agent from an assistant. Keep it sharp.

---

## Customer Memory

The agent needs to know four layers about each customer:

**Layer 1 — Profile (who they are)**
- Company name, size, plan, contract value
- Key contacts — who to talk to, who makes decisions
- Account owner (which CSM)

This is mostly static. Changes rarely.

**Layer 2 — History (what happened)**
- Every interaction: calls, emails, tickets, Lark messages
- Key events: onboarding completed, escalation happened, feature requested
- Decisions made: "we agreed to extend their trial," "they declined the upsell"

This grows over time. Append-only.

**Layer 3 — State (where they stand now)**
- Health: good, at risk, critical
- Open issues: unresolved tickets, pending requests
- Dates that matter: renewal, next QBR, last contact
- Usage trends: going up, flat, dropping

This changes constantly. The brain loop updates it.

**Layer 4 — Instinct (what the CSM knows that no system captures)**
- "Mike is the real decision maker, not the VP"
- "They're evaluating a competitor, be proactive"
- "This customer hates generic check-ins, only reach out with substance"
- "They had a bad onboarding, still rebuilding trust"

This is the most valuable layer. No CRM has it. The CSM teaches it to the agent through conversation — they DM the agent in Lark and say "remember, Acme is price-sensitive right now" and the agent holds that.

---

## Brain Loop

The agent wakes up on a schedule. Every cycle, for each account in the CSM's portfolio:

**Step 1 — Pull state.** Health score, engagement, renewals, recent notes — straight from CSP. The CSM's instinct notes from the agent's local memory. What the agent itself observed last cycle.

**Step 2 — Classify.** Pick the action band: Act, Notify-then-act, Escalate, or Prep. The classifier weights reversibility, ARR, time pressure, and per-customer overrides. A 20% usage drop on a healthy account is Act-band ("log it, watch next cycle"). The same drop on a customer flagged "evaluating competitor" is Escalate.

**Step 3 — Execute.** Do the work. Reversible actions go through immediately. Customer-facing actions enter the notify-then-act window. High-stakes actions wait in escalation.

**Step 4 — Report.** Brain-loop output is **outcomes**, not requests: *47 acts, 12 notifies in-flight, 2 escalations.* Daily digest to the CSM in Lark.

> Pull state → classify into bands → execute on Act and Notify-then-act → brief on Escalate → report outcomes, not requests.

---

## Chat Surface

The CSM can also @ the agent in Lark to ask questions ("what's going on with Globex?"). The agent answers from the same data + tools it uses autonomously. This is the **chat surface** — same agent, different entry point.

Chat is not the primary mode. The agent's job is to do work on its own schedule. Chat is a window into what it knows and what it's doing.

---

## What Does It Look Like?

**It doesn't have its own app.** It lives in Lark.

- **In Lark:** daily digest (3 numbers), notify-then-act announcements, escalation briefs, and a chat surface
- **In CSP:** the agent writes notes, closes activities, updates state
- **In the customer's eyes:** sometimes the source of an email or message; sometimes invisible while it works behind the scenes

It's not a chatbot the customer talks to. It's a colleague the CSM works with.

---

## Day in the Life

### Without Cerebro Claw

Andrew, 8:30am:
1. Opens CSP, tries to remember where he left off
2. Skims his 1,327 accounts list, knows he can't get to most of them
3. Has a call at 9:30 — spends 30 minutes prepping by hand
4. Writes the follow-up afterwards from scratch
5. Notices Globex hasn't replied to him in a week, feels guilty
6. Chases engineering on a feature request from 3 weeks ago
7. Picks the 5-10 accounts he'll actually touch today
8. The other 1,317 wait

### With Cerebro Claw

Andrew, 8:30am — Lark:
> **Cerebro Claw:** Good morning. Yesterday: 47 acts, 12 in-flight, 2 escalations need you.
>
> **Escalations:**
> 1. *Meridian renewal — health dropped to critical, decision in 5 days. Briefed in thread.*
> 2. *Acme requesting discount. Drafted three responses — your pick.*

Andrew clears the 2 escalations in 12 minutes. The other 1,325 accounts were handled. The 47 acts and 12 notifies are in the log if he wants to scan them; he doesn't have to.

He spends the rest of the day on **the relationships that matter**.

---

## Why It Works

1. **Context accumulates.** The agent reads CSP for live state, holds the CSM's instinct notes locally, and remembers its own past observations. Over months it builds an account-specific picture no human could carry across 1,327 accounts.

2. **Embedded, not bolted on.** It lives in Lark — where the CSM already works. The CSM doesn't go to it. It comes to them.

3. **It acts.** Not "surfaces information for the CSM to act on." Acts. That's the bright line that separates this from every other "AI for CSMs" product.

---

## What Is It, Technically?

**A server app.** No desktop app, no mobile app, no UI of its own.

An always-on backend service that connects to your tools and acts through them.

### Deployment

1. Deploy the server (Docker on your cloud, or hosted on Fly.io/Render)
2. Connect integrations (start with one: Lark or email)
3. Configure the team — which CSM owns which accounts
4. Done

### Usage

Nothing to install. Nothing to learn. Nothing to open.

| Question | Answer |
|---|---|
| What do you deploy? | One server + one channel integration |
| What does the CSM install? | Nothing |
| Where do they use it? | Lark (or email) |
| What does it feel like? | A new teammate who does all the grunt work |

---

## Architecture

### Tech References

- [Pi SDK](https://github.com/earendil-works/pi) — agent runtime, tool system, extension system
- [OpenClaw](https://github.com/openclaw/openclaw) — session-per-customer, channel routing, gateway patterns
- [Paseo](https://github.com/getpaseo/paseo) — remote agent orchestration, process model

### Six Modules

```
┌─────────────────────────────────────────────────────────┐
│                    Cerebro Claw Server                   │
│                                                         │
│  ┌───────────────────────────────────────────────────┐  │
│  │              Channel Layer (modular)               │  │
│  │  ┌──────────┐  ┌───────┐  ┌───────┐              │  │
│  │  │ Lark Bot │  │ Email │  │  ...  │  (future)    │  │
│  │  └────┬─────┘  └───┬───┘  └───┬───┘              │  │
│  └───────┼─────────────┼─────────┼───────────────────┘  │
│          │             │         │                       │
│          ▼             ▼         ▼                       │
│  ┌───────────────────────────────────────────────────┐  │
│  │              Router (OpenClaw pattern)             │  │
│  │         channel + account → customer session       │  │
│  └───────────────────────┬───────────────────────────┘  │
│                          │                              │
│          ┌───────────────┼───────────────┐              │
│          ▼               ▼               ▼              │
│  ┌──────────────┐ ┌────────────┐ ┌──────────────┐      │
│  │   Customer   │ │   Agent    │ │    Brain     │      │
│  │   Memory     │ │  Runtime   │ │    Loop      │      │
│  │              │ │ (Pi SDK)   │ │ (scheduler)  │      │
│  │ • profile    │ │            │ │              │      │
│  │ • history    │ │ • session  │ │ • scan       │      │
│  │ • state      │ │ • tools    │ │ • judge      │      │
│  │ • instinct   │ │ • LLM     │ │ • act/alert  │      │
│  └──────┬───────┘ └─────┬──────┘ └──────┬───────┘      │
│         │               │               │               │
│         └───────────────┼───────────────┘               │
│                         ▼                               │
│  ┌───────────────────────────────────────────────────┐  │
│  │              Tool Layer (Pi tool system)           │  │
│  │                                                   │  │
│  │  Built-in:        Custom:         CLI:            │  │
│  │  • read           • crm_lookup    • bash          │  │
│  │  • write          • crm_update    • any CLI tool  │  │
│  │  • grep           • ticket_search │               │  │
│  │  • find           • usage_query   │               │  │
│  │                   • draft_message │               │  │
│  └───────────────────────────────────────────────────┘  │
│                                                         │
│  ┌───────────────────────────────────────────────────┐  │
│  │              Extension Layer (Pi extensions)       │  │
│  │  • lark-channel    • crm-hubspot  • playbooks     │  │
│  │  • email-channel   • crm-salesforce               │  │
│  │  • health-scorer   • ticket-zendesk               │  │
│  └───────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────┘
```

#### 1. Agent Runtime (Pi SDK)

Built on `@earendil-works/pi-agent-core`. This gives us:
- The agent loop (prompt → LLM → tool calls → results → repeat)
- Tool execution (sequential + parallel)
- Steering (inject messages mid-turn) and follow-up (queue after turn)
- Event system (25+ lifecycle events for extensions to hook)

Use `@earendil-works/pi-ai` for multi-provider LLM support — start with Claude, swap later without changing code.

We build on `pi-agent-core`, not `pi-coding-agent`. We're not a coding agent — we need the loop + tools, not the TUI/file editing layer.

#### 2. Customer Memory

Four layers, each stored differently:

| Layer | Storage | Why |
|---|---|---|
| Profile | Structured DB (Postgres/SQLite) | Queryable, relational |
| History | Append-only log + vector embeddings | Searchable by meaning |
| State | Structured DB (same as profile) | Updated frequently by brain loop |
| Instinct | Vector store + raw text | CSM's words, retrieved by semantic relevance |

Exposed to the agent as tools: `memory_read`, `memory_search`, `memory_update`, `memory_instinct`.

#### 3. Brain Loop (scheduler)

Runs on a schedule. The loop itself is a Pi agent session — the LLM decides what to do, not hardcoded rules.

```
every cycle:
  for each customer:
    load memory (all 4 layers)
    build context for LLM
    call agent.prompt("What needs doing for {customer}?")
    agent uses tools to check state, judge, act/alert
```

#### 4. Channel Layer (modular, OpenClaw pattern)

Each channel is a Pi **extension** that registers:
- An inbound handler (message from Lark → routed to customer session)
- An outbound action (agent sends message → Lark API)

Lark is the first extension. The interface is clean enough to add email, Slack later without touching core.

#### 5. Tool Layer (Pi tool system + CLI)

Three categories:

**Built-in** — Pi's file tools (read, write, grep, find). The agent can read local files, configs, playbooks.

**Custom CSM tools** — defined as Pi `ToolDefinition` with TypeBox schemas:
- `crm_lookup` / `crm_update` — customer records
- `ticket_search` — find open tickets
- `usage_query` — pull usage metrics
- `draft_message` / `send_message` — prepare and send messages (send requires approval)

**CLI tools** — Pi's `bash` tool with pluggable `BashOperations`. The agent can run any CLI command: curl an API, run a script, query a database. No need to wrap every external tool as a custom integration.

#### 6. Extension Layer (Pi extension system)

Everything pluggable is an extension:
- Channel adapters (lark, email, slack)
- CRM connectors (hubspot, salesforce)
- Ticketing connectors (zendesk, intercom)
- Custom behaviors (health scoring, playbook runner)

Each extension uses Pi's `ExtensionAPI` to register tools, hook events, and add commands.

### Key Design Decisions

| Decision | Reference | Why |
|---|---|---|
| Build on `pi-agent-core`, not `pi-coding-agent` | Pi SDK | We're not a coding agent. We need the loop + tools, not the TUI. |
| One agent session per customer | OpenClaw | Session = customer relationship. Context persists. |
| Channel as extension, not hardcoded | OpenClaw | Start with one, add more without touching core. |
| CLI tools via bash tool | Pi SDK | Pi's bash handles spawn, streaming, timeout, process management. |
| Brain loop as an agent, not as rules | Pi SDK | The loop calls `agent.prompt()`. The LLM judges. Rules can't handle nuance. |
| Router between channel and sessions | OpenClaw | Same customer from different channels → same session. |

---

## Milestone 1: The Agent Actually Works

**Done when:** A CSM messages the agent in Lark, the agent knows the customer, and it proactively alerts when something needs attention.

### What "done" looks like

1. CSM messages Lark bot: "What's going on with Acme?" → Agent replies with customer context
2. CSM tells bot: "Remember, Acme is evaluating a competitor" → Agent stores instinct, uses it in future reasoning
3. CSM wakes up Monday to a Lark message from the agent → "Acme usage dropped 25% and they're evaluating alternatives. Draft check-in ready."
4. CSM approves or rejects the draft from the admin UI

### Tasks

| # | Task | Package | Status |
|---|---|---|---|
| 1 | Add tests (memory, tools, router) | memory, tools, server | Done — 61 tests |
| 2 | Connect Anthropic — agent actually calls Claude | server | Done — code ready, needs API key |
| 3 | Add persistence — SQLite so data survives restarts | memory | Done |
| 4 | Connect Lark — bot receives and sends messages | channel-lark, server | Done — code ready, needs Lark credentials |
| 5 | Seed data — 3-5 demo customers with history and instincts | server | Done — 4 customers |
| 6 | Test brain loop end-to-end with real LLM | server | Blocked — needs API key |
| 7 | Polish admin UI — make it usable for the demo | web | Done |

### Out of scope for M1

- Multi-channel (email, Slack)
- CRM integration (HubSpot, Salesforce)
- Customer-facing responses
- Production deployment (Docker, CI/CD)
- Authentication on admin UI

---

## Milestone 2: The Agent Remembers Conversations

**Done when:** You can have a multi-turn conversation with the agent about a customer, and it remembers what you discussed. Drafts can be approved directly in Lark. The agent sends a daily digest.

### Tasks

| # | Task | Status |
|---|---|---|
| 1 | Conversation history per session | Done — sessions stored in agent runtime, trimmed to 40 messages |
| 2 | Lark interactive cards | Done — approval cards with Approve/Reject buttons, card action handler |
| 3 | Daily digest brief | Done — `POST /api/digest` generates a full portfolio briefing |
| 4 | Instinct capture from chat | Done — system prompt instructs agent to auto-capture informal knowledge |

### Out of scope for M2

- Multi-channel
- CRM integration
- Authentication
- Production deployment

---

## Milestone 3: The Agent Gets Real Data

**Done when:** The agent can pull live data from at least one real source (CRM, usage metrics, or tickets) instead of relying only on seeded memory. It can also run arbitrary CLI commands the operator allows.

### Why this matters

Right now the agent reasons about memory it stored itself. It can't see real customer activity. Connecting one real data source turns the prototype into a working assistant.

### Tasks

| # | Task | Why |
|---|---|---|
| 1 | `bash` tool — agent runs allowlisted CLI commands | The architecture's core promise (Pi SDK pattern). Lets you plug in any data source as a CLI. |
| 2 | Usage data connector | Detect real drops, not seeded ones |
| 3 | CRM connector (one provider — HubSpot or Salesforce) | Real customer records |
| 4 | Ticket search connector | Read live support tickets |
| 5 | Tool allowlist + safety (timeout, env restriction) | Don't let the agent `rm -rf /` |

### Out of scope for M3

- Auth on admin UI (M4)
- Multi-channel (later)
- Production deployment (M4)

---

## Architecture Foundation: Extension System (MVP)

**The application architecture from CLAUDE.md is now fully wired up.**

Previously the architecture diagram showed an Extension Layer with channel adapters and tool plugins, but in code everything was hardcoded into `app.ts`. The MVP changes that:

### What was built

| Piece | Where | What it does |
|---|---|---|
| `ChannelAdapter` interface | `shared/types/extension.ts` | Contract every channel implements: `type`, `start`, `send`, optional `sendCard`/`stop` |
| `ExtensionAPI` / `Extension` types | `shared/types/extension.ts` | What extensions can register: tools, channels, event handlers |
| `ExtensionHost` | `server/src/extension-host.ts` | Loader + registry. Aggregates tools/channels, fires lifecycle events, handles shutdown |
| `ChannelSender` lookup | `extension-host.ts` | Lets tools send messages via any registered channel without knowing the implementation |
| 4 built-in extensions | `server/src/builtin-extensions/` | `memory-tools`, `message-tools`, `bash-tool`, `channel-lark` — all loaded uniformly |
| Graceful shutdown | `server/src/index.ts` | SIGTERM/SIGINT stops brain loop, runs channel stop hooks, closes DB |
| Health endpoint with introspection | `app.ts` | `/health` and `/api/extensions` show loaded extensions, channels, tools |

### Why it matters

Adding a second channel (email, Slack) or a CRM connector no longer requires editing `app.ts`. You just:

1. Create a new extension file (anywhere)
2. Implement `Extension { id, factory }`
3. Register tools/channels via the API
4. Add it to the host's `load()` call

The MVP is complete: **all six modules from CLAUDE.md are now real, not aspirational.**

### Filesystem extension loading

Custom extensions go in the `extensions/` directory:

```
extensions/
├── sample-greeting/
│   └── index.ts        # exports default Extension
├── my-crm-connector/
│   └── index.ts
└── ...
```

Each extension's `index.ts` (or `.js`, `.mjs`) default-exports an `Extension { id, factory }`. The server's `loadExtensionsFromDir` picks them up at startup and the extension host loads them after the built-ins.

A working example is in `extensions/sample-greeting/` — it registers a `greeting` tool and hooks the brain loop start event.
