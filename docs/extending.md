# Extending Cerebro Claw

The agent is built from swappable seams. To add a capability, implement the interface and register it — no core edits. All interfaces live in `@cerebro-claw/shared`.

## The seams

| To do this | Implement / call | Register where | Example |
|---|---|---|---|
| **Swap the brain** (LLM runtime) | `AgentBackend` | `app.ts` (replaces `ClaudeCodeRuntime`) | `claude-code-runtime.ts` |
| **Add an input — accounts** | `AccountSource` | `BrainLoop` ctor | `createCspAccountSource` |
| **Add an input — tasks** | `TaskSource` | `TASK_SOURCE` → `app.ts` | `CspTaskSource`, `StubTaskSource` |
| **Add an input — renewals** | `RenewalSource` | `RENEWAL_SOURCE` → `app.ts` | `createCspRenewalSource`, `StubRenewalSource` |
| **Add a tool** | `ToolDefinition` (plain JSON Schema) | `api.registerTool` in an extension | `createSituationTools`, csp-connector |
| **Reach the CSM** (inbound/outbound channel) | `ChannelAdapter` | `api.registerChannel` | `channel-lark` |
| **Reach customers** | `CustomerChannel` | constructed in `app.ts` | `CspCustomerChannel` (when `CSP_TOKEN` set), `StubCustomerChannel` |
| **Change persistence** | `MemoryStore` / `ActionLedger` / `SituationStore` | constructed in `app.ts` | `Sqlite*` / `InMemory*` |
| **Add an action band** | `api.registerBand(ActionBandDef)` + its tool | extension factory | (default set = the four bands) |
| **Verify high-stakes actions** | `Verifier` | passed to the action-policy tools in `app.ts` | `createLlmCriticVerifier` (default); `createNoopVerifier` (disabled) |
| **Plug in anything** (lifecycle hooks) | `ExtensionFactory` + `api.on(event, …)` | `extensions/<name>/index.ts` or built-in | `sample-greeting`, built-ins |

## How to add an extension

An extension is a default-exported `Extension { id, factory }`. The factory receives an `ExtensionAPI`:

```ts
// extensions/my-thing/index.ts
import type { Extension } from "@cerebro-claw/shared";

const ext: Extension = {
  id: "my-thing",
  factory: (api) => {
    api.registerTool({ name: "my_tool", description: "...", parameters: { type: "object", properties: {} }, execute: async () => ({ content: "ok", success: true }) });
    api.on("brain_loop_cycle_start", () => console.log("cycle starting"));
    // api.registerChannel(...), api.registerBand(...), api.getStore(), api.getConfig()
  },
};
export default ext;
```

The filesystem loader (`extension-loader.ts`) scans `EXTENSIONS_DIR` (default `./extensions`) at boot. Tools needing direct store/ledger access (action-policy, task, situation tools) are wired as **built-ins** in `app.ts` instead, because `ExtensionAPI` only exposes read access to the store.

## The customer channel and the CSP activity taxonomy

When `CSP_TOKEN` is configured, the default `CustomerChannel` is `CspCustomerChannel`: a dispatched notify-then-act send writes back into CSP rather than going to an external messaging provider. The mapping:

- `send()` → `POST /csm-activities` with type **`EMAIL`** (recipient contains `@`) or **`MESSAGE`** (otherwise), the message body as `summary` — plus a best-effort `POST /notes` carrying the full body for team visibility.
- `call()` → `POST /csm-activities` with type **`CALL`**, the script as `summary`.
- Every activity `subject` is prefixed **`agent:`** so agent-sent touches are distinguishable from CSM-authored activities in CSP reporting and never pollute CSM activity metrics unnoticed.
- The created activity id is returned as `messageId` and stored on the executed ledger entry — the evidence trail for the send.

The activity write is authoritative (failure ⇒ ledger entry `failed`, surfaced in the digest); the note is best-effort and only logs on failure. A real external channel (email, SMS, WhatsApp) later replaces this by implementing `CustomerChannel` and swapping the construction in `app.ts` — the dispatcher and action-policy tools don't change.

## The action policy is a registered set

The four bands (`act` / `notify-then-act` / `escalate` / `prep`) are the default set, enumerable via `ExtensionHost.getBands()`. An extension can `registerBand(...)` to add one without editing core — but note "observe-only" is deliberately modeled as a **Situation**, not a fifth band (see `openspec/changes/clarify-agent-architecture`).

## Cross-package rule

Cross-package communication is via `@cerebro-claw/shared` types only — no other cross-package imports.
