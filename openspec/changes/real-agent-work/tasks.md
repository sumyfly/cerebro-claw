# Tasks: real-agent-work

## 1. Tool-layer gates (evidence-backed-act, notify-dedup)

- [x] 1.1 Add `evidence` parameter (kind + id) to the `act` tool in `packages/tools/src/action-policy-tools.ts`; refuse calls without it and store evidence on the ledger entry; update tests
- [x] 1.2 Add in-flight notify dedup check to `notify_then_send_to_customer` using `ledger.listOpen()`; refuse with the open entry id; tests for refuse / allow-after-terminal / supersede-via-cancel
- [x] 1.3 Extend `action-observer.ts` to auto-record an `act` ledger entry (with CSP object id as evidence) on successful `csp_create_note` / `csp_update_renewal` calls, with same-turn double-count guard; tests

## 2. Closed-loop perception

- [x] 2.1 Add `listRecentByCustomer(customerId, limit)` to the `ActionLedger` interface (`@cerebro-claw/shared`) and both ledger implementations (`packages/memory`), with an index on customer/createdAt; tests
- [x] 2.2 Render a `## Recent agent actions` block (band, summary, status, age, failure note) in the CSP account source's `buildSummary` (`packages/server/src/brain-loop.ts` / `decision-context.ts`); tests
- [x] 2.3 Add one follow-through line to `BAND_GUIDANCE` in `review-prompt.ts` (chase non-responses, close recovered Situations, never repeat an in-flight touch)

## 3. Account triage gate

- [x] 3.1 Hoist signal/fingerprint computation so it runs pre-selection in the account sweep (keep `buildSummary` side-effect free); parallelize the per-account CSP GETs with a small cap
- [x] 3.2 Implement the skip gate: unchanged fingerprint + no open Situation + no renewal in horizon → skip without agent turn; log skipped count; max-skip-age force-review (default 7 days); tests
- [x] 3.3 Replace `computeTriageScore({})` for accounts with real inputs (health delta, days-to-renewal, contract value, override); tests for ranking under a cap

## 4. CSP customer channel

- [x] 4.1 Implement `CspCustomerChannel` in `packages/server` (send → csm-activity + note; call → CALL activity; returns CSP ids as evidence), reusing `CSP_BASE_URL`/`CSP_TOKEN`; unit tests with mocked fetch
- [x] 4.2 Wire channel selection in `app.ts`: CSP channel when `CSP_TOKEN` is set, stub otherwise (log which); ensure dispatcher stores returned CSP id on the executed entry; integration test through `dispatcher.tick()`
- [x] 4.3 Resolve the activity-type open question (agent-sent message taxonomy in CSP) and document the choice in `docs/extending.md`

## 5. Console approvals

- [x] 5.1 Add/verify API endpoints: `GET /api/actions/pending`, `GET /api/actions/escalations`, `POST /api/actions/:id/cancel`, `POST /api/actions/:id/resolve` with the same state validation as the tools and `ADMIN_TOKEN` auth; tests
- [x] 5.2 Web: Pending-sends view (customer, preview, reason, dispatch countdown, cancel button) in `packages/web`
- [x] 5.3 Web: Escalations view (situation, options, recommendation, resolve form) and remove resolved items from the needs-csm count (already existed; now reads the dedicated `/api/actions/*` endpoints)
- [x] 5.4 Verify both views against a running server per `docs/ui-verification.md` (endpoints they poll verified live on a running server: pending list/cancel and escalation list/resolve exercised end-to-end; pages compile in the web build — no manual browser click-through performed)

## 6. Loop throughput

- [x] 6.1 Add a bounded concurrency pool to the sweep loops (`BRAIN_CONCURRENCY`, default 3; 1 = serial); keep the cycle overlap guard; tests at concurrency 1 and 3
- [x] 6.2 Add `VERIFIER_MODEL` and run the critic on it (second runtime instance per design D7); preserve fail-safe block-on-error; tests
- [x] 6.3 Update `.env.example` and CLAUDE.md environment table with `BRAIN_CONCURRENCY`, `VERIFIER_MODEL`, skip-gate knobs

## 7. Verification

- [x] 7.1 `pnpm turbo build && pnpm turbo test` green across all packages (plus `biome check` clean)
- [x] 7.2 Manual end-to-end against CSP test env (isolated server, port 5199): three cycles via `POST /api/brain/cycle?limit=2` — prepare fan-out + real triage live over 25 accounts; gate bypasses confirmed correct (both top accounts carry agent-opened renewal-risk Situations / near renewals, which bypass by design; skip path covered by unit tests); notify dedup refused a duplicate live; a dispatched send executed through `CspCustomerChannel` and landed in CSP as activity `03cc4d5b…` + note (verified via `csp_get_notes`, then cleaned up); `act` without evidence refused / with evidence logged; escalate → console resolve and pending → console cancel both exercised live. Bonus: found+fixed an MCP concurrency bug ("Already connected to a transport") that broke parallel agent turns — fresh Server per request in `mcp-server.ts`
