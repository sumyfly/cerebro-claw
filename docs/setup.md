# Cerebro Claw — Setup Guide

From clean checkout to working agent in Lark in ~30 minutes.

## 1. Install and run (no credentials needed)

```bash
pnpm install
pnpm turbo build

# Seed 4 demo customers
cd packages/server && pnpm seed

# Start everything (server :3000, web :5173)
cd ../.. && pnpm turbo dev
```

Open <http://localhost:5173>. You'll see the dashboard with 4 customers. The agent is offline (no LLM key), but everything else works.

## 2. Add Anthropic (makes the agent think)

Get a key from <https://console.anthropic.com>. Add to `.env`:

```
ANTHROPIC_API_KEY=sk-ant-...
```

Restart the server. Check:

```bash
curl http://localhost:3000/api/diagnostics
```

Should show `"anthropic": { "ok": true }`. Now chat with the agent in the web UI — pick a customer, ask "what's going on with Globex?" — it'll use the memory tools to look up the customer and respond with real context.

## 3. Add Lark (makes the agent reachable)

### Create the Lark app

1. Go to <https://open.larksuite.com/app> and create a Custom App
2. Note the **App ID** and **App Secret** from the Credentials page
3. Enable the bot under **Features → Bot**
4. Subscribe to events under **Event Subscriptions**:
   - `im.message.receive_v1` (receive messages)
   - `card.action.trigger` (button clicks on cards)
5. Set the Request URL to `https://your-server/webhook/lark`
   (use ngrok for local: `ngrok http 3000`)

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
curl http://localhost:3000/api/diagnostics
```

You should see:

```json
{
  "database": { "ok": true, "detail": "responsive" },
  "anthropic": { "ok": true, "detail": "reachable" },
  "lark": { "ok": true, "detail": "credentials configured" }
}
```

## Troubleshooting

| Problem | Check |
|---|---|
| Server won't start | Check the startup banner — it lists exactly what's missing |
| Anthropic errors in console | `curl /api/diagnostics` to see the actual reason (invalid key, rate limit, etc.) |
| Lark webhook not firing | Confirm the URL is publicly reachable; check event subscriptions are enabled |
| Brain loop doesn't run | Set `ANTHROPIC_API_KEY` — the loop disables itself without it |
| Agent doesn't know the customer | Run `pnpm seed` in `packages/server/` to load demo data |

## Adding your own extensions

Drop a directory under `extensions/` with an `index.ts` that default-exports an `Extension`. See `extensions/sample-greeting/` for a working example. The server picks it up on next restart.
