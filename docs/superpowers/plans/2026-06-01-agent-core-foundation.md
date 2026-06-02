# Agent Core Foundation (Phases 0–2) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stub all customer/CSM I/O, make the claude-code runtime carry the Cerebro brain, and build a deterministic (no-LLM-judge) eval harness that measures the agent's band decisions against known-correct scenarios.

**Architecture:** Everything I/O is stubbed so the loop runs offline. The agent reasons via the claude-code subprocess (user's login, no API key). The action ledger is the runtime-agnostic ground truth of what the agent decided; the eval scores ledger facts + cheap heuristics. No LLM judge.

**Tech Stack:** TypeScript (strict, ESM), pnpm + Turborepo, Vitest, Biome. Plain JSON-Schema tool defs. `better-sqlite3` for ledger/memory.

This plan covers the spec at `docs/superpowers/specs/2026-06-01-agent-core-design.md`, Phases 0–2. Phases 3–4 (decision engine + hardening) get their own plan once this harness produces scores.

---

## File Structure

| File | Responsibility | New/Modify |
|---|---|---|
| `packages/shared/src/types/customer-channel.ts` | Add optional `call()` to `CustomerChannel` | Modify |
| `packages/tools/src/stub-customer-channel.ts` | Implement `call()`; record call intents | Modify |
| `packages/tools/src/__tests__/stub-customer-channel.test.ts` | Tests for `call()` | Modify |
| `packages/tools/src/action-policy-tools.ts` | `notify_then_send_to_customer` accepts `channel: "message" \| "call"` | Modify |
| `packages/server/src/dispatcher.ts` | Route due entries to `call()` vs `send()` | Modify |
| `packages/tools/src/stub-csm-channel.ts` | `ChannelAdapter` stub capturing CSM sends/cards to an inbox | Create |
| `packages/tools/src/__tests__/stub-csm-channel.test.ts` | Tests | Create |
| `extensions/csp-connector/transport.ts` | Pluggable HTTP transport + mock transport reading fixtures | Create |
| `extensions/csp-connector/index.ts` | Use transport; select mock when `CSP_MOCK=1` | Modify |
| `packages/server/src/system-prompt.ts` | Single source of the Cerebro `SYSTEM_PROMPT` | Create |
| `packages/server/src/agent-runtime.ts` | Import `SYSTEM_PROMPT` from the shared module | Modify |
| `packages/server/src/claude-code-runtime.ts` | Prepend `SYSTEM_PROMPT` to `--append-system-prompt`; extract testable `buildArgs()` | Modify |
| `packages/server/src/eval/types.ts` | `Scenario`, `ScenarioResult` types | Create |
| `packages/server/src/eval/scenarios/*.json` | Fixture scenarios | Create |
| `packages/server/src/eval/load-scenarios.ts` | Load + validate fixtures | Create |
| `packages/server/src/eval/score.ts` | Pure scorer: scenario + ledger entries → result | Create |
| `packages/server/src/eval/run.ts` | CLI runner: wire stubs + agent, run scenarios, print scorecard | Create |

---

## Phase 0 — Stub the world

### Task 1: Add `call()` to the customer channel

**Files:**
- Modify: `packages/shared/src/types/customer-channel.ts`
- Modify: `packages/tools/src/stub-customer-channel.ts`
- Test: `packages/tools/src/__tests__/stub-customer-channel.test.ts`

- [ ] **Step 1: Write the failing test**

Add to `packages/tools/src/__tests__/stub-customer-channel.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { StubCustomerChannel } from "../stub-customer-channel.js";

describe("StubCustomerChannel.call", () => {
	it("records a call intent and returns an id", async () => {
		const ch = new StubCustomerChannel();
		const res = await ch.call({
			customerId: "cust-1",
			recipient: "+15551234567",
			script: "Check in on the renewal.",
		});
		expect(res.callId).toBeTruthy();
		expect(res.placedAt).toBeInstanceOf(Date);
		const calls = ch.getCalls();
		expect(calls).toHaveLength(1);
		expect(calls[0].script).toBe("Check in on the renewal.");
		expect(calls[0].recipient).toBe("+15551234567");
	});
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @cerebro-claw/tools test -- stub-customer-channel`
Expected: FAIL — `ch.call is not a function`.

- [ ] **Step 3: Extend the interface**

In `packages/shared/src/types/customer-channel.ts`, add inside the `CustomerChannel` interface after `send`:

```ts
	/**
	 * Optional: place a voice/phone call to the customer. Stubbed today.
	 * Implementations that cannot call may omit this; callers must check.
	 */
	call?(input: {
		customerId: string;
		recipient: string;
		script: string;
		meta?: Record<string, unknown>;
	}): Promise<{ callId: string; placedAt: Date }>;
```

- [ ] **Step 4: Implement `call()` in the stub**

In `packages/tools/src/stub-customer-channel.ts`, add a record type and method. After `StubSendRecord`:

```ts
export interface StubCallRecord {
	callId: string;
	customerId: string;
	recipient: string;
	script: string;
	meta?: Record<string, unknown>;
	placedAt: Date;
}
```

Add a private field next to `private sent`:

```ts
	private calls: StubCallRecord[] = [];
```

Add the method after `send()`:

```ts
	async call(input: {
		customerId: string;
		recipient: string;
		script: string;
		meta?: Record<string, unknown>;
	}): Promise<{ callId: string; placedAt: Date }> {
		const record: StubCallRecord = {
			callId: randomUUID(),
			customerId: input.customerId,
			recipient: input.recipient,
			script: input.script,
			meta: input.meta,
			placedAt: new Date(),
		};
		this.calls.push(record);
		console.log(
			`[stub-customer-channel] CALL → ${input.recipient} (${input.customerId}): ${input.script.slice(0, 80)}${input.script.length > 80 ? "…" : ""}`,
		);
		return { callId: record.callId, placedAt: record.placedAt };
	}

	/** Test affordance — what calls were placed. */
	getCalls(): StubCallRecord[] {
		return [...this.calls];
	}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `pnpm --filter @cerebro-claw/tools test -- stub-customer-channel`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add packages/shared/src/types/customer-channel.ts packages/tools/src/stub-customer-channel.ts packages/tools/src/__tests__/stub-customer-channel.test.ts
git commit -m "feat(channel): add stubbed customer call() capability"
```

---

### Task 2: Route notify-then-act through message or call

**Files:**
- Modify: `packages/tools/src/action-policy-tools.ts`
- Modify: `packages/server/src/dispatcher.ts`
- Test: `packages/server/src/__tests__/dispatcher.test.ts` (existing file)

- [ ] **Step 1: Write the failing test**

Add to `packages/server/src/__tests__/dispatcher.test.ts`:

```ts
it("dispatches a call-channel entry via channel.call()", async () => {
	const channel = new StubCustomerChannel();
	const ledger = new InMemoryActionLedger();
	await ledger.record({
		band: "notify-then-act",
		customerId: "c1",
		summary: "renewal call",
		reason: "renewal in 20 days",
		status: "in-flight",
		executeAt: new Date(Date.now() - 1000),
		payload: { recipient: "+15551234567", message: "Hi", channel: "call" },
	});
	const dispatcher = new NotifyThenActDispatcher(ledger, channel);
	const res = await dispatcher.tick();
	expect(res.dispatched).toBe(1);
	expect(channel.getCalls()).toHaveLength(1);
	expect(channel.getSent()).toHaveLength(0);
});
```

(Use the same imports the existing dispatcher test already uses for `InMemoryActionLedger`, `StubCustomerChannel`, `NotifyThenActDispatcher`.)

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @cerebro-claw/server test -- dispatcher`
Expected: FAIL — call count is 0 (entry was sent as a message).

- [ ] **Step 3: Route in the dispatcher**

In `packages/server/src/dispatcher.ts`, find where it calls `this.channel.send(...)` inside the per-entry dispatch. Replace the single send with channel selection:

```ts
const wantsCall = entry.payload?.channel === "call" && typeof this.channel.call === "function";
const result = wantsCall
	? await this.channel.call({
			customerId: entry.customerId,
			recipient: String(entry.payload?.recipient ?? ""),
			script: String(entry.payload?.message ?? ""),
		})
	: await this.channel.send({
			customerId: entry.customerId,
			recipient: String(entry.payload?.recipient ?? ""),
			text: String(entry.payload?.message ?? ""),
		});
const messageId = "messageId" in result ? result.messageId : result.callId;
const deliveredAt = "deliveredAt" in result ? result.deliveredAt : result.placedAt;
```

Then use `messageId` / `deliveredAt` in the existing `ledger.update(..., { status: "executed", executedAt: deliveredAt, payload: { ...entry.payload, messageId } })` call.

- [ ] **Step 4: Accept `channel` in the notify tool**

In `packages/tools/src/action-policy-tools.ts`, in the `notify_then_send_to_customer` tool's `parameters.properties`, add:

```ts
			channel: {
				type: "string",
				description: "How to reach the customer: 'message' (default) or 'call'.",
				enum: ["message", "call"],
			},
```

In its `execute`, when building the ledger `payload`, include the channel:

```ts
				channel: (params.channel as string) === "call" ? "call" : "message",
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `pnpm --filter @cerebro-claw/server test -- dispatcher && pnpm --filter @cerebro-claw/tools test -- action-policy`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add packages/tools/src/action-policy-tools.ts packages/server/src/dispatcher.ts packages/server/src/__tests__/dispatcher.test.ts
git commit -m "feat(notify): route customer touch to message or call channel"
```

---

### Task 3: StubCsmChannel — capture CSM-facing output

**Files:**
- Create: `packages/tools/src/stub-csm-channel.ts`
- Test: `packages/tools/src/__tests__/stub-csm-channel.test.ts`

- [ ] **Step 1: Write the failing test**

Create `packages/tools/src/__tests__/stub-csm-channel.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { StubCsmChannel } from "../stub-csm-channel.js";

describe("StubCsmChannel", () => {
	it("captures sends and cards into an inbox", async () => {
		const ch = new StubCsmChannel();
		await ch.start(async () => null);
		await ch.send("csm-1", "Heads up: renewal call queued for Acme.");
		await ch.sendCard("csm-1", { kind: "escalation", customer: "Acme" });
		const inbox = ch.getInbox();
		expect(inbox).toHaveLength(2);
		expect(inbox[0]).toMatchObject({ kind: "text", recipientId: "csm-1" });
		expect(inbox[1]).toMatchObject({ kind: "card", recipientId: "csm-1" });
	});
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @cerebro-claw/tools test -- stub-csm-channel`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the channel**

Create `packages/tools/src/stub-csm-channel.ts`:

```ts
import type { ChannelAdapter, ChannelMessageHandler } from "@cerebro-claw/shared";

export interface CsmInboxEntry {
	kind: "text" | "card";
	recipientId: string;
	text?: string;
	card?: unknown;
	at: Date;
}

/**
 * Offline replacement for the Lark channel. Captures every CSM-facing send and
 * card into an in-memory inbox so the eval can assert on what the agent told
 * the CSM. Inbound replies can be injected via `inject()`.
 */
export class StubCsmChannel implements ChannelAdapter {
	readonly type = "stub-csm";
	private handler: ChannelMessageHandler | null = null;
	private inbox: CsmInboxEntry[] = [];

	async start(handler: ChannelMessageHandler): Promise<void> {
		this.handler = handler;
	}

	async send(recipientId: string, text: string): Promise<void> {
		this.inbox.push({ kind: "text", recipientId, text, at: new Date() });
	}

	async sendCard(recipientId: string, card: unknown): Promise<void> {
		this.inbox.push({ kind: "card", recipientId, card, at: new Date() });
	}

	/** Simulate the CSM replying; returns the handler's response if any. */
	async inject(senderId: string, text: string): Promise<string | null> {
		if (!this.handler) return null;
		return this.handler({ channel: "stub-csm", senderId, text, raw: {} });
	}

	getInbox(): CsmInboxEntry[] {
		return [...this.inbox];
	}

	clear(): void {
		this.inbox = [];
	}
}
```

Note: if `InboundMessage` (in `packages/shared/src/types/message.ts`) has a different shape than `{ channel, senderId, text, raw }`, match its actual fields in the `inject()` call.

- [ ] **Step 4: Export it**

In `packages/tools/src/index.ts`, add:

```ts
export { StubCsmChannel } from "./stub-csm-channel.js";
export type { CsmInboxEntry } from "./stub-csm-channel.js";
```

- [ ] **Step 5: Run test to verify it passes**

Run: `pnpm --filter @cerebro-claw/tools test -- stub-csm-channel`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add packages/tools/src/stub-csm-channel.ts packages/tools/src/__tests__/stub-csm-channel.test.ts packages/tools/src/index.ts
git commit -m "feat(channel): add StubCsmChannel capturing CSM output to an inbox"
```

---

### Task 4: Mock CSP transport

**Files:**
- Create: `extensions/csp-connector/transport.ts`
- Modify: `extensions/csp-connector/index.ts`
- Test: `extensions/csp-connector/__tests__/transport.test.ts`

- [ ] **Step 1: Write the failing test**

Create `extensions/csp-connector/__tests__/transport.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { MockCspTransport } from "../transport.js";

describe("MockCspTransport", () => {
	it("serves fixture data by path", async () => {
		const t = new MockCspTransport({
			"/api/v1/accounts/abc": { data: { id: "abc", name: "Acme" } },
		});
		const res = await t.get("/api/v1/accounts/abc");
		expect(res.ok).toBe(true);
		expect(res.body).toEqual({ data: { id: "abc", name: "Acme" } });
	});

	it("returns 404 for unknown paths", async () => {
		const t = new MockCspTransport({});
		const res = await t.get("/api/v1/accounts/missing");
		expect(res.ok).toBe(false);
		expect(res.status).toBe(404);
	});
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter csp-connector test -- transport` (or the package name in `extensions/csp-connector/package.json`)
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the transport abstraction**

Create `extensions/csp-connector/transport.ts`:

```ts
export interface CspResponse {
	ok: boolean;
	status: number;
	body: unknown;
}

export interface CspTransport {
	get(path: string, init?: { headers?: Record<string, string> }): Promise<CspResponse>;
	post(path: string, body: unknown, init?: { headers?: Record<string, string> }): Promise<CspResponse>;
}

/** Live transport — wraps fetch against the real CSP base URL. */
export class HttpCspTransport implements CspTransport {
	constructor(
		private baseUrl: string,
		private token: string,
		private timeoutMs: number,
	) {}

	private async call(method: string, path: string, body?: unknown): Promise<CspResponse> {
		const ac = new AbortController();
		const t = setTimeout(() => ac.abort(), this.timeoutMs);
		try {
			const res = await fetch(`${this.baseUrl}${path}`, {
				method,
				headers: {
					Authorization: `Bearer ${this.token}`,
					Accept: "application/json",
					...(body ? { "Content-Type": "application/json" } : {}),
				},
				body: body ? JSON.stringify(body) : undefined,
				signal: ac.signal,
			});
			const parsed = await res.json().catch(() => null);
			return { ok: res.ok, status: res.status, body: parsed };
		} finally {
			clearTimeout(t);
		}
	}

	get(path: string) {
		return this.call("GET", path);
	}
	post(path: string, body: unknown) {
		return this.call("POST", path, body);
	}
}

/** Mock transport — serves a fixture map keyed by exact path. */
export class MockCspTransport implements CspTransport {
	constructor(private fixtures: Record<string, unknown>) {}

	async get(path: string): Promise<CspResponse> {
		const key = path.split("?")[0];
		if (key in this.fixtures) return { ok: true, status: 200, body: this.fixtures[key] };
		return { ok: false, status: 404, body: null };
	}

	async post(path: string): Promise<CspResponse> {
		const key = path.split("?")[0];
		if (key in this.fixtures) return { ok: true, status: 200, body: this.fixtures[key] };
		return { ok: true, status: 200, body: { data: { id: "mock-created" } } };
	}
}
```

- [ ] **Step 4: Wire the connector to use the transport**

In `extensions/csp-connector/index.ts`, where it currently builds requests with `fetch`, replace the inline fetch helper with a `CspTransport` chosen at factory time:

```ts
import { HttpCspTransport, MockCspTransport, type CspTransport } from "./transport.js";

function makeTransport(cfg: Record<string, string>): CspTransport {
	if (cfg.CSP_MOCK === "1") {
		const fixtures = JSON.parse(cfg.CSP_MOCK_FIXTURES ?? "{}");
		return new MockCspTransport(fixtures);
	}
	return new HttpCspTransport(
		(cfg.CSP_BASE_URL ?? "").replace(/\/$/, ""),
		cfg.CSP_TOKEN ?? "",
		Number(cfg.CSP_TIMEOUT_MS ?? 10000),
	);
}
```

Replace each tool's direct `fetch(...)` with `transport.get(path)` / `transport.post(path, body)`, reading `.ok`, `.status`, `.body` from `CspResponse`. Keep all existing id validation (24-hex, UUID) unchanged.

- [ ] **Step 5: Run tests to verify they pass**

Run: `pnpm --filter csp-connector test`
Expected: PASS (transport tests + existing connector tests).

- [ ] **Step 6: Commit**

```bash
git add extensions/csp-connector/transport.ts extensions/csp-connector/index.ts extensions/csp-connector/__tests__/transport.test.ts
git commit -m "feat(csp): pluggable transport with CSP_MOCK fixture mode"
```

---

## Phase 1 — Make the runtime carry the brain

### Task 5: Extract the system prompt to one module

**Files:**
- Create: `packages/server/src/system-prompt.ts`
- Modify: `packages/server/src/agent-runtime.ts`

- [ ] **Step 1: Create the module**

Create `packages/server/src/system-prompt.ts` and move the exact `SYSTEM_PROMPT` string literal currently in `agent-runtime.ts:27-59` into it:

```ts
export const SYSTEM_PROMPT = `You are Cerebro Claw — a CSM AI colleague ...`; // (verbatim copy of the existing constant)
```

- [ ] **Step 2: Import it in agent-runtime**

In `packages/server/src/agent-runtime.ts`, delete the local `const SYSTEM_PROMPT = ...` and add at the top:

```ts
import { SYSTEM_PROMPT } from "./system-prompt.js";
```

- [ ] **Step 3: Run the server tests**

Run: `pnpm --filter @cerebro-claw/server test`
Expected: PASS (no behavior change).

- [ ] **Step 4: Commit**

```bash
git add packages/server/src/system-prompt.ts packages/server/src/agent-runtime.ts
git commit -m "refactor(server): extract SYSTEM_PROMPT to a shared module"
```

---

### Task 6: claude-code runtime carries the Cerebro persona

**Files:**
- Modify: `packages/server/src/claude-code-runtime.ts`
- Test: `packages/server/src/__tests__/claude-code-runtime.test.ts` (create if absent)

- [ ] **Step 1: Write the failing test**

Create/append `packages/server/src/__tests__/claude-code-runtime.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { buildClaudeArgs } from "../claude-code-runtime.js";

describe("buildClaudeArgs", () => {
	it("always appends the Cerebro system prompt", () => {
		const args = buildClaudeArgs({ userMessage: "review Acme", model: "claude-opus-4-8" });
		const i = args.indexOf("--append-system-prompt");
		expect(i).toBeGreaterThan(-1);
		expect(args[i + 1]).toContain("Cerebro Claw");
	});

	it("merges per-account context after the system prompt", () => {
		const args = buildClaudeArgs({ userMessage: "x", model: "m", context: "Customer: Acme" });
		const i = args.indexOf("--append-system-prompt");
		expect(args[i + 1]).toContain("Cerebro Claw");
		expect(args[i + 1]).toContain("Customer: Acme");
	});
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @cerebro-claw/server test -- claude-code-runtime`
Expected: FAIL — `buildClaudeArgs` not exported.

- [ ] **Step 3: Extract a testable `buildClaudeArgs` and inject the persona**

In `packages/server/src/claude-code-runtime.ts`, add near the top:

```ts
import { SYSTEM_PROMPT } from "./system-prompt.js";

export interface BuildArgsInput {
	userMessage: string;
	model: string;
	context?: string;
	resumeSessionId?: string;
	mcpConfigPath?: string | null;
	allowedToolPatterns?: string[];
}

export function buildClaudeArgs(input: BuildArgsInput): string[] {
	const args: string[] = ["-p", input.userMessage, "--output-format", "stream-json", "--verbose"];
	if (input.model && !input.model.startsWith("claude-sonnet-4-")) {
		args.push("--model", input.model);
	}
	const systemPrompt = input.context ? `${SYSTEM_PROMPT}\n\n${input.context}` : SYSTEM_PROMPT;
	args.push("--append-system-prompt", systemPrompt);
	if (input.resumeSessionId) args.push("--resume", input.resumeSessionId);
	if (input.mcpConfigPath) {
		args.push("--mcp-config", input.mcpConfigPath);
		if (input.allowedToolPatterns && input.allowedToolPatterns.length > 0) {
			args.push("--allowed-tools", input.allowedToolPatterns.join(","));
		}
	}
	return args;
}
```

Then in `prompt()`, replace the inline `args` construction with:

```ts
const args = buildClaudeArgs({
	userMessage,
	model: this.model,
	context,
	resumeSessionId: claudeSessionId,
	mcpConfigPath: this.mcpConfigPath,
	allowedToolPatterns: this.allowedToolPatterns,
});
```

Also update the class doc comment: remove the stale claim that custom tools "are NOT exposed" — they are, via the MCP config. Replace with: "Custom tools are exposed over the MCP endpoint; the Cerebro system prompt is injected via --append-system-prompt."

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @cerebro-claw/server test -- claude-code-runtime`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/server/src/claude-code-runtime.ts packages/server/src/__tests__/claude-code-runtime.test.ts
git commit -m "fix(claude-code): inject Cerebro system prompt into the subprocess"
```

---

## Phase 2 — Eval harness

### Task 7: Eval types

**Files:**
- Create: `packages/server/src/eval/types.ts`

- [ ] **Step 1: Define the types**

Create `packages/server/src/eval/types.ts`:

```ts
import type { ActionBand } from "@cerebro-claw/shared";

/** What the agent should have decided for a scenario. "none" = no action. */
export type ExpectedBand = ActionBand | "none";

export interface ScenarioOverride {
	/** e.g. "escalate everything for this account" */
	rule: string;
	forcesBand?: ActionBand;
}

export interface Scenario {
	id: string;
	description: string;
	/** Fixture map served by MockCspTransport, keyed by exact CSP path. */
	csp: Record<string, unknown>;
	memory?: {
		instincts?: string[];
		overrides?: ScenarioOverride[];
	};
	expect: {
		band: ExpectedBand;
		tool?: string;
		overrideHonored?: boolean;
	};
}

export interface ScenarioResult {
	id: string;
	pass: boolean;
	expectedBand: ExpectedBand;
	actualBand: ExpectedBand;
	failures: string[];
}
```

- [ ] **Step 2: Build to typecheck**

Run: `pnpm --filter @cerebro-claw/server build`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add packages/server/src/eval/types.ts
git commit -m "feat(eval): scenario and result types"
```

---

### Task 8: The scorer (pure, deterministic)

**Files:**
- Create: `packages/server/src/eval/score.ts`
- Test: `packages/server/src/eval/__tests__/score.test.ts`

- [ ] **Step 1: Write the failing test**

Create `packages/server/src/eval/__tests__/score.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import type { ActionLedgerEntry } from "@cerebro-claw/shared";
import { scoreScenario } from "../score.js";
import type { Scenario } from "../types.js";

function entry(band: ActionLedgerEntry["band"]): ActionLedgerEntry {
	return {
		id: "x", band, customerId: "c", summary: "s", reason: "r",
		status: "done", createdAt: new Date(),
	};
}

const base: Scenario = { id: "s1", description: "", csp: {}, expect: { band: "escalate" } };

describe("scoreScenario", () => {
	it("passes when the expected band was fired", () => {
		const r = scoreScenario(base, [entry("escalate")]);
		expect(r.pass).toBe(true);
		expect(r.actualBand).toBe("escalate");
	});

	it("fails when a different band was fired", () => {
		const r = scoreScenario(base, [entry("act")]);
		expect(r.pass).toBe(false);
		expect(r.failures[0]).toContain("expected escalate");
	});

	it("treats no ledger entries as band 'none'", () => {
		const noop: Scenario = { ...base, expect: { band: "none" } };
		expect(scoreScenario(noop, []).pass).toBe(true);
		expect(scoreScenario(noop, [entry("act")]).pass).toBe(false);
	});

	it("prefers escalate when multiple bands fired", () => {
		const r = scoreScenario(base, [entry("act"), entry("escalate")]);
		expect(r.actualBand).toBe("escalate");
		expect(r.pass).toBe(true);
	});
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @cerebro-claw/server test -- eval/score`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the scorer**

Create `packages/server/src/eval/score.ts`:

```ts
import type { ActionBand, ActionLedgerEntry } from "@cerebro-claw/shared";
import type { ExpectedBand, Scenario, ScenarioResult } from "./types.js";

// Severity order so a mixed run resolves to the highest-stakes band fired.
const SEVERITY: ActionBand[] = ["act", "prep", "notify-then-act", "escalate"];

function resolveActualBand(entries: ActionLedgerEntry[]): ExpectedBand {
	if (entries.length === 0) return "none";
	let top = entries[0].band;
	for (const e of entries) {
		if (SEVERITY.indexOf(e.band) > SEVERITY.indexOf(top)) top = e.band;
	}
	return top;
}

export function scoreScenario(scenario: Scenario, entries: ActionLedgerEntry[]): ScenarioResult {
	const failures: string[] = [];
	const actualBand = resolveActualBand(entries);

	if (actualBand !== scenario.expect.band) {
		failures.push(`expected ${scenario.expect.band}, got ${actualBand}`);
	}

	if (scenario.expect.tool) {
		// Tool is implied by band today; left as a hook for finer assertions.
	}

	if (scenario.expect.overrideHonored && actualBand !== "escalate") {
		failures.push("override required escalate but agent did not escalate");
	}

	// Heuristic payload checks for escalate (no LLM judge available).
	if (actualBand === "escalate") {
		const esc = entries.find((e) => e.band === "escalate");
		const p = esc?.payload ?? {};
		if (!p.situation || !p.recommendation) {
			failures.push("escalate payload missing situation/recommendation");
		}
	}

	return {
		id: scenario.id,
		pass: failures.length === 0,
		expectedBand: scenario.expect.band,
		actualBand,
		failures,
	};
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @cerebro-claw/server test -- eval/score`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/server/src/eval/score.ts packages/server/src/eval/__tests__/score.test.ts
git commit -m "feat(eval): deterministic ledger-based scorer"
```

---

### Task 9: Scenario loader + first fixtures

**Files:**
- Create: `packages/server/src/eval/scenarios/healthy-quiet.json`
- Create: `packages/server/src/eval/scenarios/usage-drop-competitor.json`
- Create: `packages/server/src/eval/load-scenarios.ts`
- Test: `packages/server/src/eval/__tests__/load-scenarios.test.ts`

- [ ] **Step 1: Write the failing test**

Create `packages/server/src/eval/__tests__/load-scenarios.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { loadScenarios } from "../load-scenarios.js";

describe("loadScenarios", () => {
	it("loads and validates fixtures from the scenarios dir", async () => {
		const scenarios = await loadScenarios();
		expect(scenarios.length).toBeGreaterThan(0);
		for (const s of scenarios) {
			expect(s.id).toBeTruthy();
			expect(["act", "notify-then-act", "escalate", "prep", "none"]).toContain(s.expect.band);
		}
	});
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @cerebro-claw/server test -- load-scenarios`
Expected: FAIL — module not found.

- [ ] **Step 3: Create two fixtures**

`packages/server/src/eval/scenarios/healthy-quiet.json`:

```json
{
	"id": "healthy-quiet",
	"description": "Healthy account, no signal change — agent should do nothing.",
	"csp": {
		"/api/v1/accounts/aaaaaaaaaaaaaaaaaaaaaaaa": { "data": { "id": "aaaaaaaaaaaaaaaaaaaaaaaa", "name": "Quiet Co", "plan": "Pro" } },
		"/api/v1/accounts/aaaaaaaaaaaaaaaaaaaaaaaa/health-score": { "data": { "overallScore": 88, "grade": "A", "trend": "flat" } },
		"/api/v1/accounts/aaaaaaaaaaaaaaaaaaaaaaaa/engagement": { "data": { "logins30d": 120, "trend": "flat" } }
	},
	"expect": { "band": "none" }
}
```

`packages/server/src/eval/scenarios/usage-drop-competitor.json`:

```json
{
	"id": "usage-drop-competitor",
	"description": "Usage dropped on an account flagged evaluating a competitor — escalate.",
	"csp": {
		"/api/v1/accounts/bbbbbbbbbbbbbbbbbbbbbbbb": { "data": { "id": "bbbbbbbbbbbbbbbbbbbbbbbb", "name": "Risky Co", "plan": "Enterprise" } },
		"/api/v1/accounts/bbbbbbbbbbbbbbbbbbbbbbbb/health-score": { "data": { "overallScore": 41, "grade": "D", "trend": "down" } },
		"/api/v1/accounts/bbbbbbbbbbbbbbbbbbbbbbbb/engagement": { "data": { "logins30d": 12, "trend": "down" } }
	},
	"memory": { "instincts": ["Risky Co is actively evaluating a competitor."] },
	"expect": { "band": "escalate" }
}
```

- [ ] **Step 4: Implement the loader**

Create `packages/server/src/eval/load-scenarios.ts`:

```ts
import { readdir, readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { Scenario } from "./types.js";

const SCENARIOS_DIR = join(dirname(fileURLToPath(import.meta.url)), "scenarios");
const VALID_BANDS = ["act", "notify-then-act", "escalate", "prep", "none"];

export async function loadScenarios(dir = SCENARIOS_DIR): Promise<Scenario[]> {
	const files = (await readdir(dir)).filter((f) => f.endsWith(".json"));
	const out: Scenario[] = [];
	for (const f of files) {
		const raw = await readFile(join(dir, f), "utf8");
		const s = JSON.parse(raw) as Scenario;
		if (!s.id) throw new Error(`Scenario ${f} missing id`);
		if (!VALID_BANDS.includes(s.expect?.band)) {
			throw new Error(`Scenario ${f} has invalid expect.band: ${s.expect?.band}`);
		}
		out.push(s);
	}
	return out;
}
```

- [ ] **Step 5: Ensure JSON fixtures ship to dist**

In `packages/server/package.json`, confirm the build copies `src/eval/scenarios/*.json` to `dist` (Turbo/tsc does not copy JSON). If not, add a build step or load from `src` at runtime. For the loader test (vitest runs against `src`), this is already fine; note the dist concern for the runner.

- [ ] **Step 6: Run test to verify it passes**

Run: `pnpm --filter @cerebro-claw/server test -- load-scenarios`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add packages/server/src/eval/scenarios/ packages/server/src/eval/load-scenarios.ts packages/server/src/eval/__tests__/load-scenarios.test.ts
git commit -m "feat(eval): scenario loader + first two fixtures"
```

---

### Task 10: The runner CLI

**Files:**
- Create: `packages/server/src/eval/run.ts`
- Modify: `packages/server/package.json` (add `eval` script)

- [ ] **Step 1: Implement the runner**

Create `packages/server/src/eval/run.ts`. It wires the in-memory ledger, mock CSP fixtures (per scenario, via `CSP_MOCK=1` + `CSP_MOCK_FIXTURES`), the stub channels, and the claude-code agent, runs each scenario's per-account prompt, then scores from the ledger:

```ts
import { InMemoryActionLedger } from "@cerebro-claw/memory";
import { StubCustomerChannel, StubCsmChannel } from "@cerebro-claw/tools";
import { loadScenarios } from "./load-scenarios.js";
import { scoreScenario } from "./score.js";
import type { ScenarioResult } from "./types.js";
// Reuse the real host/runtime wiring helper from the server bootstrap.
import { buildAgentForEval } from "./harness.js"; // see Step 2

async function main() {
	const scenarios = await loadScenarios();
	const results: ScenarioResult[] = [];

	for (const s of scenarios) {
		const ledger = new InMemoryActionLedger();
		const customerChannel = new StubCustomerChannel();
		const csmChannel = new StubCsmChannel();
		await csmChannel.start(async () => null);

		const businessId = Object.keys(s.csp)[0].split("/")[3]; // /api/v1/accounts/:id
		const agent = await buildAgentForEval({ ledger, customerChannel, csmChannel, cspFixtures: s.csp });

		const prompt = `You are reviewing customer "${s.id}" (CSP business id: ${businessId}). Fetch live data with csp_get_account / csp_get_health_score / csp_get_engagement, then pick the right band and use the matching tool. If nothing needs doing, say so.`;
		await agent.prompt(prompt, undefined, `eval:${s.id}`);

		const entries = await ledger.listByWindow(new Date(0), new Date(8640000000000000));
		results.push(scoreScenario(s, entries));
	}

	printScorecard(results);
	const failed = results.filter((r) => !r.pass).length;
	process.exit(failed > 0 ? 1 : 0);
}

function printScorecard(results: ScenarioResult[]) {
	console.log("\n=== Cerebro Agent Eval ===");
	for (const r of results) {
		const mark = r.pass ? "PASS" : "FAIL";
		console.log(`[${mark}] ${r.id}: expected ${r.expectedBand}, got ${r.actualBand}${r.failures.length ? " — " + r.failures.join("; ") : ""}`);
	}
	const passed = results.filter((r) => r.pass).length;
	console.log(`\n${passed}/${results.length} scenarios passed.\n`);
}

main().catch((e) => {
	console.error(e);
	process.exit(1);
});
```

- [ ] **Step 2: Add `buildAgentForEval` harness wiring**

Create `packages/server/src/eval/harness.ts` that constructs an `ExtensionHost` with the action-policy, memory, and csp-connector extensions, passing `CSP_MOCK=1` and `CSP_MOCK_FIXTURES=JSON.stringify(cspFixtures)` into the config, the in-memory ledger, the stub customer channel, and the stub CSM channel; then constructs a `ClaudeCodeRuntime` from `host.getTools()` pointed at the in-process MCP URL. Mirror the wiring in `packages/server/src/app.ts:116-145` but with the stub channels and mock CSP. (Read `app.ts` and `startup.ts` for the exact host construction calls and reuse them — do not duplicate logic that can be imported.)

- [ ] **Step 3: Add the npm script**

In `packages/server/package.json` `scripts`, add:

```json
"eval": "tsx src/eval/run.ts"
```

(Use the runner the repo already uses for TS execution — `tsx` or `node --import tsx`. Match an existing script.)

- [ ] **Step 4: Manual run (requires `claude` on PATH + login)**

Run: `pnpm --filter @cerebro-claw/server eval`
Expected: a scorecard. This is **not** a CI test — it spawns the claude-code subprocess (~60s/scenario). It is the on-demand "is it smart" measurement.

- [ ] **Step 5: Commit**

```bash
git add packages/server/src/eval/run.ts packages/server/src/eval/harness.ts packages/server/package.json
git commit -m "feat(eval): claude-code runner + scorecard CLI"
```

---

## Self-Review

**Spec coverage:**
- Phase 0 (stub world): Task 1 (call), Task 2 (call routing), Task 3 (StubCsmChannel), Task 4 (MockCspProvider). ✓ `StubCustomerChannel` already exists.
- Phase 1 (runtime carries brain): Task 5 (extract prompt), Task 6 (inject persona). MCP tool exposure already works via `host.getTools()`; verified in audit, no task needed. ✓
- Phase 2 (eval harness): Task 7 (types), Task 8 (scorer), Task 9 (loader + fixtures), Task 10 (runner). ✓
- Phases 3–4 (decision engine, hardening): deferred to a follow-up plan once scores exist, per spec sequencing.

**Placeholder scan:** Task 9 Step 5 and Task 10 Step 2 reference reading existing wiring (`app.ts`/`startup.ts`) and matching the repo's TS runner rather than inventing one — these are deliberate "match existing pattern" instructions, not vague placeholders. All code steps contain real code.

**Type consistency:** `scoreScenario(scenario, entries)`, `Scenario`, `ScenarioResult`, `ExpectedBand`, `loadScenarios()`, `buildClaudeArgs()`, `MockCspTransport`, `StubCsmChannel`, `CustomerChannel.call()` are used consistently across tasks. Ledger methods (`record`, `listByWindow`) match `packages/shared/src/types/action.ts`.

**Known integration risks to confirm during execution:**
1. JSON fixtures must reach `dist` for the runner (Task 9 Step 5).
2. `buildAgentForEval` must reuse the real host construction, not fork it (Task 10 Step 2).
3. `InboundMessage` shape for `StubCsmChannel.inject()` (Task 3 Step 3).
