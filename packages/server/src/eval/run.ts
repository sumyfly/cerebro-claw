/**
 * Eval runner CLI.
 *
 * For each scenario fixture: spin up an in-memory ledger + stub channels + a
 * mock CSP (fed the scenario's `csp` fixtures), run the claude-code agent on the
 * per-account brain-loop review prompt, score the resulting ledger entries with
 * the existing scoreScenario, and print a scorecard.
 *
 * This SPAWNS the `claude` subprocess (~60s/scenario) — it is an on-demand
 * measurement, NOT a CI unit test. Requires `claude` on PATH and logged in.
 *
 *   pnpm --filter @cerebro-claw/server eval
 */
import { InMemoryActionLedger } from "@cerebro-claw/memory";
import { StubCsmChannel, StubCustomerChannel } from "@cerebro-claw/tools";
import { loadConfig } from "../config.js";
import { renderDecisionContext } from "../engine/decision-context.js";
import { computeSignals } from "../engine/signals.js";
import { reviewMessage } from "../review-prompt.js";
import { buildAgentForEval } from "./harness.js";
import { loadScenarios } from "./load-scenarios.js";
import { scoreScenario } from "./score.js";
import { snapshotFromScenario } from "./snapshot.js";
import type { Scenario, ScenarioResult } from "./types.js";

/** Fixed clock for the eval so renewal/contact day-math is deterministic. */
const EVAL_NOW = new Date("2026-06-02T00:00:00Z");

/**
 * Pull the business id from the scenario's bare account fixture key. Anchored
 * with `$` so it matches the same key snapshotFromScenario uses — otherwise a
 * scenario with only sub-path keys could yield an id here but a null snapshot
 * there, silently running the agent with no decision-signals context.
 */
function firstBusinessId(scenario: Scenario): string | null {
	for (const path of Object.keys(scenario.csp)) {
		const m = path.match(/\/api\/v1\/accounts\/([0-9a-f]{24})$/i);
		if (m) return m[1];
	}
	return null;
}

export function printScorecard(results: ScenarioResult[]): number {
	const passed = results.filter((r) => r.pass).length;
	console.log("");
	console.log("┌─ Eval scorecard ──────────────────────────────────");
	for (const r of results) {
		const tag = r.pass ? "[PASS]" : "[FAIL]";
		const detail = r.failures.length > 0 ? ` — ${r.failures.join("; ")}` : "";
		console.log(`│ ${tag} ${r.id}: expected ${r.expectedBand}, got ${r.actualBand}${detail}`);
	}
	console.log("└────────────────────────────────────────────────────");
	console.log(`${passed}/${results.length} passed`);
	console.log("");
	return results.length - passed;
}

async function runScenario(scenario: Scenario): Promise<ScenarioResult> {
	const businessId = firstBusinessId(scenario);
	if (!businessId) {
		return {
			id: scenario.id,
			pass: false,
			expectedBand: scenario.expect.band,
			actualBand: "none",
			failures: ["no CSP account fixture found (need a /api/v1/accounts/<id> key)"],
		};
	}

	const ledger = new InMemoryActionLedger();
	const customerChannel = new StubCustomerChannel();
	const csmChannel = new StubCsmChannel();
	await csmChannel.start(async () => null);

	const instincts = scenario.memory?.instincts ?? [];
	const overrides = scenario.memory?.overrides ?? [];
	const agent = await buildAgentForEval({
		ledger,
		customerChannel,
		csmChannel,
		cspFixtures: scenario.csp,
		instincts,
		customerId: businessId,
		overrides,
	});

	// Compute the decision signals from the scenario's CSP data + memory and
	// render them as the per-account context — the same engine the production
	// loop uses. This is what gives the agent structured inputs (health/usage/
	// renewal/override/change) instead of raw text, plus the instinct notes.
	const built = snapshotFromScenario(scenario, EVAL_NOW);
	let context: string | undefined;
	if (built) {
		let signals = computeSignals(built.snapshot);
		// No-change scenario: replay last cycle's identical state so the agent is
		// told nothing has moved and should default to no action.
		const ld = scenario.memory?.lastDecision;
		if (ld?.sameAsCurrent) {
			signals = computeSignals({
				...built.snapshot,
				lastDecision: {
					signalFingerprint: signals.signalFingerprint,
					band: ld.band,
					reason: ld.reason,
				},
			});
		}
		context = renderDecisionContext(signals, instincts);
	}

	try {
		await agent.prompt(reviewMessage(scenario.id, businessId), context, `eval:${scenario.id}`);
	} finally {
		await agent.close();
	}

	// Widest possible window so every entry the agent logged is in scope.
	const entries = await ledger.listByWindow(new Date(0), new Date(8640000000000000));
	return scoreScenario(scenario, entries);
}

async function main(): Promise<void> {
	const config = loadConfig();
	console.log(`[eval] runtime model: ${config.model}`);
	console.log(`[eval] claude binary: ${config.claudeBinary}`);

	const scenarios = await loadScenarios();
	if (scenarios.length === 0) {
		console.log("[eval] No scenarios found.");
		process.exit(0);
	}
	console.log(
		`[eval] Running ${scenarios.length} scenario(s) — this spawns the claude subprocess (~60s each).`,
	);

	const results: ScenarioResult[] = [];
	for (const scenario of scenarios) {
		console.log(`[eval] ▶ ${scenario.id} — ${scenario.description}`);
		try {
			results.push(await runScenario(scenario));
		} catch (err) {
			results.push({
				id: scenario.id,
				pass: false,
				expectedBand: scenario.expect.band,
				actualBand: "none",
				failures: [`run threw: ${err instanceof Error ? err.message : String(err)}`],
			});
		}
	}

	const failed = printScorecard(results);
	process.exit(failed > 0 ? 1 : 0);
}

main().catch((err) => {
	console.error("[eval] Fatal:", err);
	process.exit(1);
});
