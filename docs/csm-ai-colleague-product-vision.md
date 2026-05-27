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
