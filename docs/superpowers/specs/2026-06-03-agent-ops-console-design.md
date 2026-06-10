# Agent Ops Console — Frontend Redesign + Legacy Removal

**Date:** 2026-06-03
**Status:** Approved (design + legacy removal)

## Goal

Replace the four-page admin UI (Dashboard / Customers / Activity / Extensions) with a
four-tab **agent ops console**, and delete the legacy "draft → approve" assistant flow
so the codebase reflects one model: the four-band action-policy system.

## The four tabs

| Tab | Purpose | Reads | Writes |
|---|---|---|---|
| **Pipeline** (`/`) | Every agent task = an action-ledger entry, grouped by status. Header counter strip. Window selector (24h / 7d / all). Filter by band + status. | `GET /api/ledger?since=`, `GET /api/digest/counters` | — |
| **Blocked** (`/blocked`) | Only escalations awaiting the human (`escalate` band, `needs-csm`). Shows situation + options + recommendation + age. Nav count badge. | `GET /api/ledger/open` (filtered to escalate/needs-csm) | `POST /api/ledger/:id/resolve` (Resolve modal, records outcome) |
| **Skills / Intelligence Center** (`/skills`) | Left: capability catalog — every tool grouped by source extension, with descriptions + wired channels. Right: live activity feed of recent tool invocations. | `GET /api/extensions`, **new** `GET /api/tools/recent` (polled) | — |
| **Settings** (`/settings`) | Read-only status panel: connectivity (DB, Claude Code CLI, Lark, CSP), loaded extensions/channels, key config values. | `GET /api/diagnostics`, `GET /api/extensions` | — |

## Visual direction

Dense, dark "intelligence center / control room" aesthetic for an agent ops console.
Status-driven color (green = done/ok, amber = in-flight/pending, red = needs-you/failed),
monospace for IDs and timestamps. Built via the frontend-design skill. Keeps React 19 +
Ant Design 5 + the existing Layout shell (swap nav entries + routes).

## Backend change (the only one)

A recent-tool-call feed for the Skills tab:

- An in-memory ring buffer (last ~100) recording each tool call: `{ tool, ts, ok, customerId? }`.
- Fed by the **existing MCP `onToolCall` hook**, composed alongside the current
  action-observer. Since Claude Code is the only runtime, every tool call flows through
  `/mcp`, so this captures chat, brain-loop, and dispatcher activity.
- Exposed as `GET /api/tools/recent`. No persistence, no schema change.

## Legacy removal (clean cut — verified to share no code with the four-band flow)

**Delete (legacy-only):**
- `packages/tools/src/message-tools.ts` (`draft_message`, `send_message`)
- `packages/server/src/builtin-extensions/message-tools-extension.ts`
- `packages/shared/src/types/message.ts` — `PendingAction`, `OutboundMessage` (legacy-only types)
- `packages/channel-lark/src/lark-bot.ts` — `buildApprovalCard` + its export
- `packages/server/src/builtin-extensions/lark-extension.ts` — the `onCardAction` approve/reject handler (keep the plain-text `sendToCsm` path)
- `app.ts` — `pendingActions` Map; endpoints `GET /api/actions`, `POST /api/actions/:id/approve`, `POST /api/actions/:id/reject`, `GET/DELETE /api/sessions`, `POST /api/chat`, `POST /api/digest`
- Frontend: `Dashboard.tsx`, `Customers.tsx`, `Activity.tsx`, `Extensions.tsx` and their routes
- Tests: `message-tools.test.ts`, `draft-event.test.ts`, and legacy-endpoint cases in `app-integration.test.ts`

**Dead-code sweep (remove if the only caller was legacy):**
- `brainLoop.runDigest()` (only reached by the removed `POST /api/digest`)
- `csp-customers.ts` (only reached by the removed `/api/customers*` endpoints)
- `GET /api/customers*` endpoints
- Lark inbound `Router` chat wiring — **keep `Router`** (still routes inbound Lark messages); only the `/api/chat` HTTP route goes.

**Keep (current / shared):** action-policy tools + extension, ActionLedger, dispatcher,
brain-loop (minus `runDigest` if dead), `sendToCsm` text infra, `LarkBot.send`,
`/api/ledger*`, `/api/digest/counters`, `/api/extensions`, `/api/diagnostics`.

## Non-goals

- No editable settings (read-only panel only).
- No new unit tests (per instruction). Existing tests must stay green; legacy tests are deleted.
- No chat UI (the conversational web chat is removed with the legacy cut).

## Implementation (subagents)

1. **Backend agent** — legacy removal + dead-code sweep + `GET /api/tools/recent`. Keep build, Biome, and remaining tests green.
2. **Frontend agents** — build the 4 pages + nav/router rewire following the frontend-design system; delete the 4 old pages.
3. **Verify** — `pnpm turbo build`, `pnpm turbo test`, `pnpm check` all green.
