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
| **Reach customers** | `CustomerChannel` | constructed in `app.ts` | `StubCustomerChannel` |
| **Change persistence** | `MemoryStore` / `ActionLedger` / `SituationStore` | constructed in `app.ts` | `Sqlite*` / `InMemory*` |
| **Add an action band** | `api.registerBand(ActionBandDef)` + its tool | extension factory | (default set = the four bands) |
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

## The action policy is a registered set

The four bands (`act` / `notify-then-act` / `escalate` / `prep`) are the default set, enumerable via `ExtensionHost.getBands()`. An extension can `registerBand(...)` to add one without editing core — but note "observe-only" is deliberately modeled as a **Situation**, not a fifth band (see `openspec/changes/clarify-agent-architecture`).

## Cross-package rule

Cross-package communication is via `@cerebro-claw/shared` types only — no other cross-package imports.
