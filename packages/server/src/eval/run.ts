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
import { buildAgentForEval } from "./harness.js";
import { loadScenarios } from "./load-scenarios.js";
import { scoreScenario } from "./score.js";
import type { Scenario, ScenarioResult } from "./types.js";

/**
 * Pull the first CSP business id out of the scenario's fixture keys. CSP account
 * paths look like /api/v1/accounts/<24-hex-id>[/...]; we take the id segment.
 */
function firstBusinessId(scenario: Scenario): string | null {
	for (const path of Object.keys(scenario.csp)) {
		const m = path.match(/\/api\/v1\/accounts\/([0-9a-f]{24})/i);
		if (m) return m[1];
	}
	return null;
}

/**
 * The per-account review prompt the brain loop uses for the CSP source: name the
 * business id, tell the agent to fetch live data via csp_* tools, then pick a band.
 * Mirrors createCspAccountSource().buildSummary + evaluateCustomer in brain-loop.ts.
 */
function reviewPrompt(businessId: string): string {
	return [
		`You are reviewing a customer account (CSP business id: ${businessId}). Decide if any action is needed right now.`,
		"",
		"Fetch the live data yourself using csp_get_account, csp_get_health_score, and csp_get_engagement. Use csp_get_notes for recent context and csp_get_renewals if a renewal is close.",
		"",
		"Then pick the right band from the action policy:",
		"- act — log something you noticed (csp_create_note for team-visible, memory_instinct for agent-private).",
		"- notify_then_send_to_customer — routine customer-facing touch (heads-up to CSM, dispatched after pause window).",
		"- escalate — high-stakes or ambiguous (brief CSM with situation + options + recommendation).",
		"- prep — finished v1 artifact for a CSM-owned conversation.",
		"",
		"If nothing needs doing, just say so and move on. Don't draft and wait — that's the bug, not the feature.",
	].join("\n");
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
	const agent = await buildAgentForEval({
		ledger,
		customerChannel,
		csmChannel,
		cspFixtures: scenario.csp,
		instincts,
		customerId: businessId,
	});

	// The instincts are seeded into the store (memory_* tools can find them) and
	// also injected as per-account context so the agent reliably sees what the
	// CSM has told it about this account — the band call often hinges on it.
	const context =
		instincts.length > 0
			? `What the CSM has told you about this account (instinct notes):\n${instincts
					.map((i) => `- ${i}`)
					.join("\n")}`
			: undefined;

	try {
		await agent.prompt(reviewPrompt(businessId), context, `eval:${scenario.id}`);
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
