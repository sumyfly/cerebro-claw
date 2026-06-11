/**
 * Harness probe — verifies the AsyncLocalStorage / wrapped ledger contract
 * without spawning the agent runtime.
 *
 * What we prove:
 *  1. A ledger write done OUTSIDE any turn frame lands unstamped (control).
 *  2. A ledger write done INSIDE `currentTurn.run(turn, ...)` is auto-stamped
 *     with the turn's `id` and the subject's `accountId`.
 *  3. The action-observer pattern (a ledger write fired AFTER tool.execute()
 *     but still inside the same ALS frame) also inherits stamping — this is
 *     the regression #1 was meant to fix.
 *
 * Run: pnpm --filter @cerebro-claw/server exec node --import tsx src/eval/harness-probe.ts
 */

import { InMemoryActionLedger } from "@cerebro-claw/memory";
import type { TurnContext } from "@cerebro-claw/shared";
import {
	currentTurn,
	setCurrentTool,
	TurnRegistry,
	wrapLedgerForHarness,
} from "../harness/index.js";

const raw = new InMemoryActionLedger();
const ledger = wrapLedgerForHarness(raw);
const registry = new TurnRegistry();

let pass = 0;
let fail = 0;

function expect(name: string, ok: boolean, detail?: string) {
	if (ok) {
		pass += 1;
		console.log(`  ✓ ${name}`);
	} else {
		fail += 1;
		console.error(`  ✗ ${name}${detail ? ` — ${detail}` : ""}`);
	}
}

// ---------------------------------------------------------------- Case 1
console.log("\nCase 1: write OUTSIDE any turn (control)");
{
	const entry = await ledger.record({
		band: "act",
		customerId: "explicit-cust",
		summary: "out-of-turn write",
		reason: "control case",
		status: "done",
		createdAt: new Date(),
	});
	const stored = await raw.get(entry.id);
	expect("no turnId stamped", stored?.turnId === undefined);
	expect("customerId preserved", stored?.customerId === "explicit-cust");
}

// ---------------------------------------------------------------- Case 2
console.log("\nCase 2: write INSIDE turn frame, tool calls record() directly");
{
	const turn: TurnContext = {
		id: "turn-account-1",
		subject: { kind: "account", accountId: "acc-A" },
		startedAt: new Date(),
	};
	registry.register(turn);

	const created = await currentTurn.run(turn, async () => {
		setCurrentTool(turn, { name: "memory_instinct", blastRadius: "internal" });
		try {
			return await ledger.record({
				band: "act",
				customerId: "acc-A",
				summary: "in-turn write",
				reason: "case 2",
				status: "done",
				createdAt: new Date(),
			});
		} finally {
			setCurrentTool(turn, undefined);
		}
	});
	const stored = await raw.get(created.id);
	expect("turnId auto-stamped", stored?.turnId === "turn-account-1");
	expect("toolName auto-stamped", stored?.toolName === "memory_instinct");
	expect("blastRadius auto-stamped", stored?.blastRadius === "internal");
	registry.release(turn.id);
}

// ---------------------------------------------------------------- Case 3
console.log("\nCase 3: observer write — record() runs AFTER tool.execute() but in same frame");
{
	const turn: TurnContext = {
		id: "turn-task-1",
		subject: { kind: "task", taskId: "task-XYZ", accountId: "acc-B" },
		startedAt: new Date(),
	};
	registry.register(turn);

	// Mimic the pipeline shape: tool runs, observer runs, both inside the frame.
	// The tool itself doesn't write to the ledger; the observer does (this is the
	// csp_create_note path: tool returns OK, observer auto-records an Act).
	const observerEntry = await currentTurn.run(turn, async () => {
		setCurrentTool(turn, { name: "csp_create_note", blastRadius: "csm-only" });
		try {
			// (a) tool.execute() — no ledger write here
			await new Promise((r) => setTimeout(r, 0));
			// (b) observer hook — records on the tool's behalf. The observer code
			//     provides customerId itself but DOES NOT provide turnId/taskId/
			//     toolName — those must come from the wrap.
			return await ledger.record({
				band: "act",
				customerId: "acc-B",
				summary: "Logged a CSP note",
				reason: "csp_create_note (observed)",
				status: "done",
				createdAt: new Date(),
				payload: { evidence: { kind: "note", id: "note-1" } },
			});
		} finally {
			setCurrentTool(turn, undefined);
		}
	});
	const stored = await raw.get(observerEntry.id);
	expect("observer write turnId stamped", stored?.turnId === "turn-task-1");
	expect("observer write taskId stamped", stored?.taskId === "task-XYZ");
	expect("observer write toolName stamped", stored?.toolName === "csp_create_note");
	expect(
		"observer write blastRadius stamped",
		stored?.blastRadius === "csm-only",
		`got "${stored?.blastRadius}"`,
	);
	expect("observer write customerId preserved", stored?.customerId === "acc-B");
	registry.release(turn.id);
}

// ---------------------------------------------------------------- Case 4
console.log("\nCase 4: caller-provided fields beat auto-injection");
{
	const turn: TurnContext = {
		id: "turn-acc-X",
		subject: { kind: "account", accountId: "auto-cust" },
		startedAt: new Date(),
	};
	registry.register(turn);

	const created = await currentTurn.run(turn, async () => {
		return await ledger.record({
			band: "act",
			customerId: "explicit-different-cust",
			summary: "explicit override",
			reason: "case 4",
			status: "done",
			createdAt: new Date(),
		});
	});
	const stored = await raw.get(created.id);
	expect(
		"caller customerId wins over turn subject",
		stored?.customerId === "explicit-different-cust",
	);
	expect("but turnId still stamped", stored?.turnId === "turn-acc-X");
	registry.release(turn.id);
}

// ---------------------------------------------------------------- Summary
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
