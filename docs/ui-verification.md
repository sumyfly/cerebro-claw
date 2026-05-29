# UI Verification with agent-browser

Unit tests (Vitest) and integration tests (supertest) cover the server. Neither one
actually opens a browser. This note describes how to verify the web UI visually
against the running app.

We use [`agent-browser`](https://github.com/vercel-labs/agent-browser) — a
fast CLI for browser automation that drives Chrome via CDP. It works through
plain bash commands, which fits the agent's tool model.

## Setup (one-time)

```bash
npm install -g agent-browser
agent-browser install   # downloads Chrome 149 for testing (~170 MB)
```

## Run the app

```bash
rm -f ~/.cerebro-claw/data.db     # start clean
(cd packages/server && pnpm seed) # 4 demo customers
pnpm turbo dev                    # server :3000, web :5173
```

## The verification loop

```bash
agent-browser open http://localhost:5173/   # 1. navigate
agent-browser snapshot -i                   # 2. see refs (@e1, @e2, …)
agent-browser click @e9                     # 3. act
agent-browser snapshot -i                   # 4. re-snapshot after page change
agent-browser screenshot /tmp/foo.png       # 5. capture for visual review
```

Refs are reassigned on every snapshot — always re-snapshot before the next
ref-based action.

## What to verify on each page

| Page | What to check |
|---|---|
| `/` (Dashboard) | All customers in list; ARR total; sortable columns; trend arrows; color-coded thresholds (red `>14d ago`, orange renewal warnings); "Run Daily Digest" button |
| `/customers` | Add Customer button opens modal; modal has 5 fields (name, plan, contract, csmOwner, csmLarkUserId); click row → split detail panel; History/Instinct Notes tabs switch; "no Lark ID" warning when unset; truncated Lark ID display when set |
| `/activity` | Empty state illustration and message; pending action cards with Approve/Reject buttons when actions exist |
| `/extensions` | Loaded extensions list; channels; live diagnostics (database ✓, runtime status, lark status); 7 agent tools in table with descriptions |

## Gotchas seen in practice

- **Buttons below the fold don't register clicks** — Add Customer modal's OK
  button needed `agent-browser scrollintoview @e30` before the click landed.
  Same will apply to long forms or wide tables.
- **antd menu items don't always route on click** — direct
  `agent-browser open <url>` is more reliable than clicking the sidebar in
  some cases.
- **Toasts disappear fast** — capture screenshots immediately after the click,
  or hit the API directly to confirm the underlying behavior.

## When to bother

Run the browser verification:

- After any change to a web component or page
- Before tagging a release
- When wiring a new field end-to-end (form → API → display)

Unit and integration tests catch logic regressions. This catches the things
those tests can't: rendering bugs, layout breakage, missing menu items, broken
links, fields that compile but never show up on screen.
