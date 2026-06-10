# Cerebro Claw — Setup Guide

From clean checkout to working agent in Lark in ~30 minutes.

## 1. Install and run (no credentials needed)

```bash
pnpm install
pnpm turbo build

# Start everything (server :5100, web :5173)
pnpm turbo dev
```

Open <http://localhost:5173>. The Customers tab reads live from CSP once `CSP_TOKEN` + `CSP_CSM_EMAIL` are set (see section 3); without them it's empty. The agent needs Claude Code (next section) to think, but everything else works.

## 2. Run the agent on your Claude Code login (no API key)

The agent runs through the `claude` CLI (Claude Code) — your existing Max/Pro
subscription, no Anthropic API key. **Custom tools work — the server exposes
them via MCP, the Claude Code subprocess discovers them automatically.** This is
the Paseo pattern.

Install the `claude` CLI and log in. If it's on your PATH there's nothing to
configure; otherwise point at it with `CLAUDE_BINARY=/path/to/claude` in `.env`.

Restart. The startup banner should show `RUNTIME claude-code (subprocess: claude)`
and the log will print `MCP config: ... (N tools exposed)`.

Mechanics: the server runs an HTTP MCP endpoint at `/mcp`. When we spawn
`claude` for a chat turn, we pass `--mcp-config <temp-file>` pointing at
that endpoint plus `--allowed-tools mcp__cerebro-claw__*` so the subprocess
auto-approves our tools. No permission prompts, no per-token billing.

Characteristics:
- ✅ No per-token billing — uses your Max/Pro subscription
- ✅ All custom tools work (csp_*, memory_*, draft_message, send_message, bash)
- ❌ Higher per-turn latency (subprocess spawn + first-call TLS handshake;
  ~60s for the first chat turn that hits CSP, ~10-20s afterwards)
- ❌ The agent identifies as Claude Code rather than a CSM-flavored persona;
  the `--append-system-prompt` injection is additive, not a full override.

Check it's wired up:

```bash
curl http://localhost:5100/api/diagnostics
```

Should show `"runtime": { "ok": true, "detail": "claude-code: CLI ready" }`. Now chat with the agent in the web UI — pick a customer, ask "what's going on with Globex?" — it'll use the memory tools to look up the customer and respond with real context.

## 3. Add Lark (makes the agent reachable)

### Create the Lark app

1. Go to <https://open.larksuite.com/app> and create a Custom App
2. Note the **App ID** and **App Secret** from the Credentials page
3. Enable the bot under **Features → Bot**
4. Subscribe to events under **Event Subscriptions**:
   - `im.message.receive_v1` (receive messages)
   - `card.action.trigger` (button clicks on cards)
5. Set the Request URL to `https://your-server/webhook/lark`
   (use ngrok for local: `ngrok http 5100`)

### Configure permissions

Under **Permissions & Scopes**, enable:
- `im:message`
- `im:message:send_as_bot`
- `im:chat`

### Add to .env

```
LARK_APP_ID=cli_...
LARK_APP_SECRET=...
```

Restart. Then in Lark, message the bot:
> What's going on with Globex?

The agent should reply with real customer context. Approve drafts from the admin UI or via Lark cards.

## 4. Verify everything

```bash
curl http://localhost:5100/api/diagnostics
```

You should see:

```json
{
  "database": { "ok": true, "detail": "responsive" },
  "runtime": { "ok": true, "detail": "claude-code: CLI ready" },
  "lark": { "ok": true, "detail": "credentials configured" }
}
```

## Troubleshooting

| Problem | Check |
|---|---|
| Server won't start | Check the startup banner — it lists exactly what's missing |
| Agent errors in console | `curl /api/diagnostics` to see the actual reason; confirm `claude` is on PATH and logged in |
| `claude` not found | Install the Claude Code CLI and log in, or set `CLAUDE_BINARY` to its absolute path |
| Lark webhook not firing | Confirm the URL is publicly reachable; check event subscriptions are enabled |
| Customers tab is empty | Set `CSP_TOKEN` + `CSP_CSM_EMAIL` so it reads the live CSP portfolio |

## Adding your own extensions

Drop a directory under `extensions/` with an `index.ts` that default-exports an `Extension`. See `extensions/sample-greeting/` for a working example. The server picks it up on next restart.
