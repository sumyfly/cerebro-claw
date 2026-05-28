# Cerebro Claw

A CSM AI colleague — an always-on server agent that remembers customers, thinks on a schedule, and talks to CSMs through Lark.

**Agent by default, assistant when asked.** It has its own agenda — watching accounts, drafting follow-ups, catching risks — but drops everything to help when you @ it.

---

## What it does

- **Knows each customer** across four memory layers: profile, history, state, and informal CSM "instinct" notes
- **Wakes up on a schedule** to scan customers for things that need attention
- **Drafts customer-facing messages** that the CSM approves directly in Lark via interactive cards
- **Sends a daily digest** so the CSM walks into a prepared morning
- **Pluggable**: tools, channels, and connectors are extensions loaded from the `extensions/` directory at startup

## Architecture

Six modules, all pluggable through the extension system:

| Module | What it does |
|---|---|
| Agent Runtime | Anthropic agent loop with tool execution and per-customer chat sessions |
| Customer Memory | SQLite-backed four-layer store (profile, state, history, instinct) |
| Brain Loop | Scheduled scan → judge → act/alert cycle, also generates digests |
| Channel Layer | Lark IM (cards + signature-verified webhooks); any channel can be added as an extension |
| Tool Layer | Built-in memory tools, draft/send tools, allowlisted bash tool for CLI-based connectors |
| Extension Layer | Loads built-ins + anything from `extensions/` at startup |

See [`docs/csm-ai-colleague-product-vision.md`](docs/csm-ai-colleague-product-vision.md) for the full product vision and architecture.

## Quick start

```bash
pnpm install
pnpm turbo build
cd packages/server && pnpm seed   # 4 demo customers
cd ../.. && pnpm turbo dev
```

- Server: <http://localhost:3000>
- Web UI: <http://localhost:5173>

Without credentials the server runs in degraded mode (agent can't think). See [`docs/setup.md`](docs/setup.md) for adding Anthropic + Lark.

## Layout

```
.
├── packages/
│   ├── shared/        # types: customer, memory, message, tool, extension
│   ├── memory/        # in-memory + SQLite stores
│   ├── tools/         # memory tools, message tools, bash tool
│   ├── channel-lark/  # Lark adapter with cards and signature verification
│   ├── server/        # Express + agent runtime + brain loop + extension host
│   └── web/           # React + antd admin UI
├── extensions/        # user-provided extensions auto-loaded at startup
├── docs/              # vision, architecture, setup guide
└── .github/workflows/ # CI: build, test, lint on every PR
```

## Endpoints

| Route | What |
|---|---|
| `GET /health` | Server status + loaded extensions/tools (public) |
| `GET /api/diagnostics` | Live connectivity check: DB, Anthropic ping, Lark credentials |
| `GET /api/customers` | List customers with current state |
| `GET /api/customers/:id` | Full detail (profile, state, history, instincts) |
| `POST /api/chat` | Multi-turn chat with the agent |
| `POST /api/digest` | Trigger the daily digest |
| `GET /api/actions` | Pending CSM approval queue |
| `POST /api/actions/:id/approve` | Approve a draft (sends through channel) |
| `GET /api/extensions` | Loaded extensions, channels, tools |
| `POST /webhook/lark` | Lark events (signature-verified) |

Admin endpoints require `Authorization: Bearer $ADMIN_TOKEN` when set.

## Adding an extension

Drop a directory under `extensions/` with an `index.ts` that default-exports an `Extension`. See `extensions/sample-greeting/` for a working example that registers tools and hooks the brain-loop lifecycle.

```ts
import type { Extension } from "@cerebro-claw/shared";

const myExtension: Extension = {
  id: "my-connector",
  factory: (api) => {
    api.registerTool({
      name: "my_lookup",
      description: "Look up something in our internal API",
      parameters: { type: "object", properties: { id: { type: "string", description: "ID" } }, required: ["id"] },
      async execute(params) {
        // ... fetch and return
      },
    });
  },
};

export default myExtension;
```

The server discovers and loads it at startup. No core code changes.

## Testing

```bash
pnpm turbo test
```

84+ tests across memory, tools, channel-lark, and server. CI runs them on every PR.

## License

(unspecified — internal project)
