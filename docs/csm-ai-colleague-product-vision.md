# CSM AI Colleague — Product Vision

## One Sentence

**It's the colleague who does all the homework so you can show up and be the human.**

---

## What Problem Are We Solving?

A CSM's day looks like this:

- 30% actually talking to customers
- 70% **work about the work** — updating CRM fields, writing follow-up emails, preparing for calls by digging through Lark threads and support tickets, chasing internal teams for answers, building QBR decks nobody reads

The AI colleague takes the 70% off their plate. Not by replacing the CSM — by doing the boring parts so the human can focus on the relationship.

---

## Core

It knows the customer. It acts on that knowledge. That's it.

Everything else is a channel, a tool, or a feature — and can be added later.

Three pieces that can't be dropped:

1. **Customer memory** — the agent must know each customer's history, status, and context. Without this, it's just a generic chatbot.
2. **A brain loop** — it must periodically think: "what needs doing?" Without this, it's an assistant, not an agent.
3. **One channel in, one channel out** — Lark. The agent lives in Lark IM. That's where it talks to the CSM, that's where the CSM talks to it. One channel, not five.

> A server that **remembers customers**, **thinks on a schedule**, and **talks to the CSM through one channel**.

### Not core (drop for now)

| Feature | Why it can wait |
|---|---|
| Multi-channel (Lark + email + WhatsApp) | One channel is enough to prove the value |
| CRM auto-updating | Nice but not the core job |
| Customer-facing responses | Risky, needs trust. CSM-facing first. |
| Monday morning briefs | A feature of the brain loop, not the core |
| Renewal tracking | A use case, not infrastructure |
| Subagent spawning | Over-engineering for v1 |
| Sandboxing, crash recovery | Production concerns, not product concerns |

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

The agent wakes up on a schedule. Every cycle, it does three things:

**Step 1 — Scan.** Look at every customer and check: did anything change since last time?
- New ticket opened?
- Usage data shifted?
- Lark message came in?
- A date is approaching (renewal in 30 days, no contact in 2 weeks)?

**Step 2 — Judge.** For each change, decide: does this need action?
- Usage dropped 5% → probably noise, skip
- Usage dropped 40% → something is wrong, flag it
- Renewal in 60 days → not yet
- Renewal in 14 days and no prep started → urgent

This is where the LLM earns its keep. It's not just threshold rules — it weighs the customer's history, the CSM's instinct notes, the severity. A 20% usage drop for a healthy customer might be a holiday. The same drop for a customer "evaluating a competitor" is a red alert.

**Step 3 — Act or Alert.** Two options:
- **Act:** do something low-risk autonomously (update health score, log a note, draft a message for CSM to review)
- **Alert:** message the CSM in Lark with context and a recommendation ("Acme usage dropped 30%. Given they're evaluating alternatives, I'd suggest a check-in. Draft ready — want me to send?")

The agent never contacts the customer directly without CSM approval. That's the trust boundary.

> Scan for changes → judge what matters → act on the safe stuff, alert the human on the rest.

---

## Agent or Assistant?

**Agent by default, assistant when asked.**

| | Assistant | Agent |
|---|---|---|
| Who starts? | You ask, it responds | It watches, thinks, acts on its own |
| Metaphor | Siri — waits for your command | A real colleague — has their own work |
| Initiative | Zero | Has judgment about when to act |

This is an **agent** — it has its own agenda, its own rhythm, its own sense of what needs doing. But when you tap it on the shoulder, it drops everything and helps like an assistant.

The agent loop is the engine. The assistant interface is the steering wheel.

---

## What Does It Look Like?

**It doesn't have its own app.** It lives where you already work.

- In **Lark**, it's a team member. You @ it. It @ you.
- In **email**, it sends and drafts from its own address (or yours, with approval).
- In **CRM**, it's the one who actually keeps records up to date.
- In the **customer's eyes**, it's either invisible (doing work behind the scenes) or a helpful first responder ("Let me check that for you, I'll loop in Sarah if needed").

It's not a chatbot the customer talks to. It's a colleague the CSM works with.

---

## How Do You Use It?

### 1. You ask it to do things (assistant mode)

> "Prepare me for the Acme call tomorrow"

It pulls their recent tickets, usage trends, last meeting notes, renewal date, and sends you a brief in Lark 30 minutes before the call.

> "Draft a follow-up from today's call with Acme"

It drafts the email, you review, one click to send.

> "Why is Globex health score dropping?"

It checks usage data, open tickets, NPS responses, and gives you a summary with its hypothesis.

### 2. It does things on its own (agent mode)

- **Monday morning:** "Here's your week — 3 renewals coming up, 2 accounts with dropping usage, 1 escalation from Friday you haven't responded to."
- **After a support ticket closes:** It logs the resolution in the CRM and updates the health score.
- **When usage drops:** It notices before you do. "Acme's API calls dropped 40% this week. Want me to reach out or just flag it?"
- **Before renewal:** It starts building the renewal brief 30 days out.

### 3. It handles the first touch with customers

- It answers immediately if it knows the answer.
- It buys you time if it doesn't: "Let me check with the team and get back to you today."
- It escalates to you when it senses emotion, complexity, or risk.

---

## Why Does It Work?

### 1. Context accumulates

The agent **remembers everything** about the customer relationship. Over months, it builds a picture no human could hold in their head across 30+ accounts. When you ask "what's going on with Acme," it doesn't search — it *knows*.

### 2. It's embedded, not bolted on

It lives in Lark and email — the places you already spend your day. You don't go to it. It comes to you.

### 3. The human stays in the loop where it matters

It handles the **mechanical** parts (data gathering, drafting, CRM updates) and surfaces the **judgment** parts to you (unhappy customer, expansion ready, renewal at risk). The CSM becomes the strategist. The agent becomes the executor.

---

## What Does a Day Look Like?

### Without the AI colleague

1. 8:30 — Open CRM, try to remember where you left off
2. 9:00 — Spend 30 min prepping for call by searching Lark, Zendesk, dashboards
3. 9:30 — Call
4. 10:00 — 20 min writing follow-up, updating CRM
5. 10:30 — Discover a missed reply from last week
6. 11:00 — Chase engineering on a 3-week-old feature request
7. ... always behind

### With the AI colleague

1. 8:30 — Open Lark. Agent posted: "Your day: call at 9:30 (brief ready), Globex needs a reply (draft ready), 2 renewals this week"
2. 8:35 — Review brief, tweak one point
3. 9:30 — Call (prepared, confident)
4. 10:00 — Approve follow-up draft. CRM already updated.
5. 10:05 — Approve Globex reply. Agent caught the missed one yesterday.
6. 10:10 — Agent already got a timeline from engineering. Forward to customer.
7. 10:15 — Ahead of the day. Time for strategic work.

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
