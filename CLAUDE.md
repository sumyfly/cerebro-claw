# Cerebro Claw

**An agent that handles the long tail of a CSM's portfolio so the CSM only works the accounts that matter.**

The CSM (e.g. Andrew Lee with 1,327 accounts at StorehubPay) cannot personally know every account. The agent absorbs the routine work end-to-end. The CSM's daily input from the agent is three numbers and the escalations only they can decide:

> *Yesterday: 47 acts, 12 notifies in-flight, 2 escalations need you.*

## The bright line

This is an **agent**, not an assistant.

- **Agent:** sees a problem → does something about it → reports the outcome
- **Assistant:** sees a problem → queues a draft → waits for human to approve

Every design decision is judged against this. If a feature reduces the work to "the human reviews a queue," it's the wrong direction. Approval is the **exception**, used only for the Escalate band (irreversible, high-stakes, ambiguous).

## Action policy (the core IP)

The agent classifies every action into one of four bands. Each band has a tool:

| Band | Tool | Behavior |
|---|---|---|
| **Act** | `act` | Just do it. Log what was done. CSM sees it in the digest. (CSP notes, instinct memory, internal pings, detection.) |
| **Notify-then-act** | `notify_then_send_to_customer` | Heads-up to CSM now, customer send after a pause window (default 4h). CSM cancels with `cancel_pending_action` if they disagree. (Routine touches, renewal nudges.) |
| **Escalate** | `escalate` | Brief the CSM with situation + options + recommendation. CSM owns the decision; mark `resolve_escalation` after they choose. (Discount, churn save, contract change.) |
| **Prep** | `prep` | Ship a finished v1 the CSM uses to drive a CSM-owned conversation. (Pre-call brief, QBR deck, renewal brief.) |

Every call lands in the **action ledger** (SQLite `action_ledger` table). The digest endpoint `/api/digest/counters` reads the ledger to produce the daily headline ("Yesterday: 47 acts, 12 notifies in-flight, 2 escalations need you."). A **dispatcher** (`packages/server/src/dispatcher.ts`) polls every 60s for due notify-then-act entries and sends them through the registered `CustomerChannel`.

## Source docs

- **Goal + action policy:** `docs/csm-ai-colleague-product-vision.md` (read this first)
- **Work inventory (33 CSM work types classified):** `docs/work-inventory.md`
- **Setup:** `docs/setup.md`
- **UI verification workflow:** `docs/ui-verification.md`

## Tech Stack

- **Language:** TypeScript (strict, ESM, Node 22+)
- **Monorepo:** Turborepo + pnpm workspaces
- **Backend:** Express 5
- **Frontend:** React 19 + Ant Design 5
- **Agent runtimes:** Anthropic SDK (production) or Claude Code subprocess (via MCP, no API key needed)
- **LLM access via MCP:** `@modelcontextprotocol/sdk` HTTP server exposes our tools to any MCP client
- **Memory:** SQLite (`better-sqlite3`) for agent-private notes, pending actions, and the action ledger; CSP is the source of truth for customer data
- **Channels:** Lark IM to the CSM (signature-verified webhook, interactive approval cards) + `CustomerChannel` interface for customer-facing sends (`StubCustomerChannel` by default)
- **External data:** CSP backend at `cspapi.test.shub.us` via the `csp-connector` extension
- **Testing:** Vitest
- **Linting/formatting:** Biome

## Layout

```
.
├── packages/
│   ├── shared/          # Types: Customer, MemoryStore, ActionLedger, CustomerChannel, ChannelAdapter, ExtensionAPI, ToolDefinition
│   ├── memory/          # In-memory + SQLite implementations of MemoryStore and ActionLedger
│   ├── tools/           # memory tools, message tools, bash tool, action-policy tools (act/notify/escalate/prep), StubCustomerChannel
│   ├── channel-lark/    # ChannelAdapter for Lark with card builder and HMAC signature verify
│   ├── server/          # Express app, extension host, MCP server, brain loop, dispatcher, runtimes
│   └── web/             # React + antd admin UI (Dashboard, Customers, Activity, Extensions)
├── extensions/
│   ├── csp-connector/   # 9 csp_* tools (read + write-back) hitting cspapi.test.shub.us/api/v1
│   └── sample-greeting/ # Demo extension showing the loader pattern
├── docs/
│   ├── csm-ai-colleague-product-vision.md
│   ├── setup.md
│   └── ui-verification.md
├── .github/workflows/ci.yml
└── Dockerfile + docker-compose.yml
```

## Architecture — eight modules

1. **Agent Runtime** — `AgentBackend` interface implemented by `AgentRuntime` (Anthropic SDK, in-process tool calls) and `ClaudeCodeRuntime` (spawns `claude` with `--mcp-config` so the subprocess calls our tools over MCP — no Anthropic key needed).
2. **Customer Memory** — `MemoryStore` interface, SQLite-backed in production. Four conceptual layers (profile, state, history, instinct) but profile/state are mostly delegated to CSP now; SQLite keeps agent-private observations.
3. **Action Ledger** — `ActionLedger` interface, SQLite-backed. Every act/notify/escalate/prep lands here. The digest reads from it; the dispatcher reads from it; the dashboard counters read from it.
4. **Brain Loop** — runs `agent.prompt()` per account each cycle. Pluggable `AccountSource`: `createLocalAccountSource(store)` for demo seed, `createCspAccountSource({…})` to iterate the CSM's real CSP portfolio.
5. **Dispatcher** — polls the ledger every 60s for due notify-then-act entries and sends them through the registered `CustomerChannel`. Failures are recorded back to the ledger (status `failed`, surfaced in the digest).
6. **Channel Layer** — `ChannelAdapter` for CSM-facing channels (Lark today). `CustomerChannel` for the agent's outbound path to customers (`StubCustomerChannel` today; email/SMS to drop in later).
7. **Tool Layer** — every tool is a `ToolDefinition { name, description, parameters (JSON Schema), execute }`. Categories: memory tools, action-policy tools (act/notify/escalate/prep/cancel/resolve), message tools (legacy draft → CSP card flow), bash tool. External extensions add more (csp-connector adds 9).
8. **Extension Layer** — `ExtensionHost` loads built-ins + any factory in `extensions/`. Extensions register tools, channels, lifecycle event handlers. Filesystem loader (`extension-loader.ts`) scans `EXTENSIONS_DIR` at boot.

## How Claude Code mode works (no API key)

Pattern borrowed from Paseo. Server runs an HTTP MCP endpoint at `POST /mcp`. When `ClaudeCodeRuntime` spawns `claude`, it:

1. Writes a one-line MCP config file to `tmpdir` referencing `http://127.0.0.1:{port}/mcp`
2. Passes `--mcp-config <path>` and `--allowed-tools mcp__cerebro-claw__*` to suppress per-call approval prompts
3. Claude Code connects, calls `tools/list`, discovers everything our extension host has registered
4. Each tool call is a `POST /mcp` against the same server — Claude Code's reasoning, our tool implementations, user's Claude Code login for inference

Verified end-to-end against CSP: chat turn "What is the health status of 16chillgrill?" runs in ~60s, agent calls `csp_get_account`/`csp_get_health_score`/`csp_get_engagement` over MCP, produces a CSM-grade brief with real data.

## Runtime selection

Set `RUNTIME=anthropic` (default) or `RUNTIME=claude-code`. Both use the same `host.getTools()` surface — only how they reach Claude differs.

| Runtime | Inference auth | Tool transport | First-turn latency | Persona |
|---|---|---|---|---|
| `anthropic` | `ANTHROPIC_API_KEY` | In-process function call | ~5-10s | CSM-flavored via system prompt |
| `claude-code` | Your Claude Code login | HTTP MCP server | ~60s (subprocess + TLS) | Mixed — Claude Code base + `--append-system-prompt` add-on |

## CSP integration

`extensions/csp-connector/index.ts` exposes 9 tools that proxy directly to the CSP HTTP API:

| Tool | Endpoint |
|---|---|
| `csp_list_my_accounts` | `GET /api/v1/accounts?assignedCsmId=` |
| `csp_get_account` | `GET /api/v1/accounts/:id` |
| `csp_get_health_score` | `GET /api/v1/accounts/:id/health-score` |
| `csp_get_engagement` | `GET /api/v1/accounts/:id/engagement` |
| `csp_get_notes` | `GET /api/v1/notes?businessId=` |
| `csp_create_note` (write-back) | `POST /api/v1/notes` |
| `csp_delete_note` (write-back) | `POST /api/v1/notes/:id/delete` |
| `csp_get_renewals` | `GET /api/v1/accounts/:id/renewals` |
| `csp_get_renewal` | `GET /api/v1/renewals/:id` (UUID) |

Pure proxy — no local mirror of CSP data. Each call hits CSP live. Business IDs validated as 24-char hex; renewal IDs as UUID. 10s default timeout (`CSP_TIMEOUT_MS`). When `CSP_TOKEN` and `CSP_CSM_EMAIL` are set, the brain loop's account source switches to CSP automatically, and the admin UI's Customers tab reads live from CSP too (`csp-customers.ts`); otherwise both fall back to the local SQLite store. There is no demo seed — the local store only holds agent-private data (ledger, history, instincts).

## Commands

```bash
pnpm install                                # install
pnpm turbo build                            # build all packages
pnpm turbo dev                              # server + web in watch mode
pnpm turbo test                             # run tests (190 across 4 packages)
```

## Conventions

- TypeScript strict + ESM everywhere
- Biome (not Prettier/ESLint), Vitest (not Jest)
- Tool definitions use plain JSON Schema (not Zod) — same wire format as MCP
- Extensions go in `extensions/<name>/index.ts` with a default-exported `Extension { id, factory }`
- `.env` is gitignored; use `.env.example` as the template
- Cross-package communication via the `@cerebro-claw/shared` types only — no other cross-package imports

## Environment

See `.env.example` for the full list. The important ones:

| Variable | Used by |
|---|---|
| `ANTHROPIC_API_KEY` | Anthropic runtime |
| `RUNTIME=claude-code` | Switches to subprocess + MCP, no API key needed |
| `CSP_BASE_URL`, `CSP_TOKEN`, `CSP_CSM_EMAIL` | csp-connector + brain loop's CSP account source |
| `LARK_APP_ID`, `LARK_APP_SECRET`, `LARK_VERIFICATION_TOKEN` | Lark channel |
| `DEFAULT_CSM_LARK_USER_ID` | Where approval cards go when a customer has no `csmLarkUserId` set |
| `ADMIN_TOKEN` | Bearer auth on `/api/*` (admin API is open without it — dev only) |
| `BASH_ALLOWLIST`, `BASH_TIMEOUT_MS` | Bash tool sandboxing |
| `EXTENSIONS_DIR` | Where filesystem extension loader scans (default `./extensions`) |
| `DISPATCHER_INTERVAL_MS` | How often the notify-then-act dispatcher polls (default 60s) |
| `DEFAULT_PAUSE_MINUTES` | Default pause window for `notify_then_send_to_customer` (default 240 = 4h) |
