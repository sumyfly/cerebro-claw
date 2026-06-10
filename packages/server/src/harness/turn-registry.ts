import { AsyncLocalStorage } from "node:async_hooks";
import type { TurnContext } from "@cerebro-claw/shared";

/**
 * In-memory registry of in-flight turns. The runtime registers a TurnContext
 * when it starts an `agent.prompt()`; the MCP server reads it on every
 * `tools/list` / `tools/call` request that carries a `turn_id` path param.
 *
 * Lifetime. The runtime MUST call `release(turnId)` after the subprocess exits,
 * win or lose — otherwise the registry leaks. The dispatcher path never goes
 * through here (it executes outside any turn).
 *
 * Concurrency. Registry mutations happen serially in this process; the JS event
 * loop guarantees no torn reads. Two MCP requests for the same turn are fine —
 * both see the same TurnContext object.
 */
export class TurnRegistry {
	private turns = new Map<string, TurnContext>();

	register(turn: TurnContext): void {
		this.turns.set(turn.id, turn);
	}

	get(turnId: string): TurnContext | undefined {
		return this.turns.get(turnId);
	}

	release(turnId: string): void {
		this.turns.delete(turnId);
	}

	size(): number {
		return this.turns.size;
	}
}

/**
 * AsyncLocalStorage that carries the active turn down into any code running
 * inside a tool's execute(). The harness pipeline runs every `execute()` inside
 * `currentTurn.run(turn, fn)`; the wrapped ledger reads from this so it can
 * stamp every row with turn_id/account_id/task_id without the tool knowing.
 *
 * Why ALS instead of an explicit context arg: tools today take only
 * `(params)`; threading a context object everywhere would require touching
 * every tool, every ledger writer, every helper. ALS slips into one place
 * (the pipeline) and inherits through the call tree.
 */
export const currentTurn = new AsyncLocalStorage<TurnContext>();
