# Cerebro Claw

A CSM AI colleague — an always-on server agent that remembers customers, thinks on a schedule, and talks to CSMs through Lark. Agent by default, assistant when asked.

See `docs/csm-ai-colleague-product-vision.md` for full product vision and architecture.

## Tech Stack

- **Language:** TypeScript (strict, ESM)
- **Monorepo:** Turborepo (`turbo`)
- **Package Manager:** pnpm
- **Backend:** Express
- **Frontend:** React + Ant Design (antd)
- **Agent Runtime:** `@earendil-works/pi-agent-core` (loop, tools, events)
- **LLM Layer:** `@earendil-works/pi-ai` (multi-provider, start with Claude)
- **Channel:** Lark Bot SDK
- **Database:** Postgres (profile, state) + vector store (history, instinct)
- **Testing:** Vitest
- **Linting:** Biome

## Monorepo Structure

```
cerebro-claw/
├── CLAUDE.md
├── turbo.json
├── package.json
├── packages/
│   ├── server/          # Express backend — gateway, brain loop, router
│   ├── web/             # React + antd admin UI
│   ├── memory/          # Customer memory (4 layers: profile, history, state, instinct)
│   ├── channel-lark/    # Lark bot channel extension
│   ├── tools/           # Custom CSM tools (crm, tickets, usage, drafts)
│   └── shared/          # Shared types, utils, config
├── extensions/          # Pi-style extensions (future channel/CRM/ticketing adapters)
├── docs/
│   └── csm-ai-colleague-product-vision.md
└── .env.example
```

## Architecture

Six modules:

1. **Agent Runtime** — `@earendil-works/pi-agent-core`. The agent loop, tool execution, steering, events. We build on `pi-agent-core`, not `pi-coding-agent` — this is a CSM agent, not a coding agent.
2. **Customer Memory** — four layers (profile, history, state, instinct). Exposed to the agent as tools: `memory_read`, `memory_search`, `memory_update`, `memory_instinct`.
3. **Brain Loop** — scheduler that wakes up, loads customer context, calls `agent.prompt()` for each customer. The LLM judges what needs doing — not hardcoded rules.
4. **Channel Layer** — modular. Lark is the first and only channel. Each channel is a Pi extension registering inbound/outbound handlers.
5. **Tool Layer** — three categories: built-in (read, write, grep, find), custom CSM tools (crm_lookup, ticket_search, usage_query, draft_message), CLI tools (Pi's bash tool).
6. **Extension Layer** — everything pluggable is a Pi extension. Channel adapters, CRM connectors, ticketing connectors, custom behaviors.

## Tech References

- [Pi SDK](https://github.com/earendil-works/pi) — agent runtime, tool system, extension system
- [OpenClaw](https://github.com/openclaw/openclaw) — session-per-customer, channel routing, gateway patterns
- [Paseo](https://github.com/getpaseo/paseo) — remote agent orchestration, process model

## Key Decisions

- **Session per customer** (OpenClaw pattern) — one persistent agent session per customer relationship
- **Channels as extensions** (OpenClaw pattern) — start with Lark, add more without touching core
- **Brain loop as agent** (Pi SDK) — the loop itself calls `agent.prompt()`, LLM decides what to do
- **CLI tools via bash** (Pi SDK) — Pi's bash tool for running any CLI command
- **Router** (OpenClaw pattern) — channel + account → customer session mapping

## Commands

```bash
pnpm install              # install dependencies
pnpm turbo build          # build all packages
pnpm turbo dev            # dev mode (server + web)
pnpm turbo test           # run tests
pnpm turbo lint           # lint all packages
```

## Conventions

- All packages use TypeScript strict mode with ESM
- Use Biome for formatting and linting, not Prettier/ESLint
- Use Vitest for testing, not Jest
- Tool definitions use TypeBox for JSON schema parameter validation
- One export per file preferred, barrel exports in `index.ts`
- No default exports — use named exports only
- Environment variables go in `.env`, never committed. Use `.env.example` as template.
- Keep packages loosely coupled — communicate through well-defined interfaces, not direct imports across package boundaries (except `shared/`)

## Agent Tools

Custom tools follow Pi's `ToolDefinition` pattern:

- `memory_read` — read customer profile/state
- `memory_search` — semantic search across history/instinct
- `memory_update` — update customer state
- `memory_instinct` — store CSM's informal knowledge about a customer
- `crm_lookup` / `crm_update` — customer records in CRM
- `ticket_search` — find open support tickets
- `usage_query` — pull product usage metrics
- `draft_message` — prepare a message for CSM review
- `send_message` — send via channel (requires CSM approval)
- `bash` — run CLI commands (Pi's built-in bash tool)
