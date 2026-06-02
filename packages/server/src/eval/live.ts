/**
 * LIVE smoke — run the agent against REAL Cerebro (CSP) data via real Claude Code.
 *
 * Unlike run.ts (deterministic fixtures), this hits the live CSP backend using
 * CSP_TOKEN/CSP_BASE_URL/CSP_CSM_EMAIL from the environment. For each of the
 * CSM's first N accounts it: fetches live data, computes decision signals,
 * injects the decision-context, runs the claude-code agent over the real csp_*
 * tools, and prints the band the agent chose (from the action ledger).
 *
 *   set -a; . ./.env; set +a
 *   pnpm --filter @cerebro-claw/server eval:live           # first 2 accounts
 *   pnpm --filter @cerebro-claw/server eval:live -- 3      # first 3
 *   pnpm --filter @cerebro-claw/server eval:live -- <businessId> [<id> ...]
 *
 * NOTE: a real agent action may write a CSP note (csp_create_note) to the test
 * backend — that is the product behaving as designed, not a test artifact.
 */
import { InMemoryActionLedger, InMemoryStore } from "@cerebro-claw/memory";
import type { ActionLedgerEntry } from "@cerebro-claw/shared";
import { StubCsmChannel, StubCustomerChannel } from "@cerebro-claw/tools";
import { createCspAccountSource } from "../brain-loop.js";
import { reviewMessage } from "../review-prompt.js";
import { buildAgentForEval } from "./harness.js";

async function main(): Promise<void> {
	if (/^(1|true|yes)$/i.test(process.env.CSP_INSECURE_TLS ?? "")) {
		process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0";
	}
	const baseUrl = process.env.CSP_BASE_URL;
	const token = process.env.CSP_TOKEN;
	const csmEmail = process.env.CSP_CSM_EMAIL;
	if (!baseUrl || !token || !csmEmail) {
		console.error("[live] CSP_BASE_URL, CSP_TOKEN and CSP_CSM_EMAIL must be set (source .env).");
		process.exit(2);
	}

	const args = process.argv.slice(2);
	const explicitIds = args.filter((a) => /^[0-9a-f]{24}$/i.test(a));
	const n = Number(args.find((a) => /^\d{1,2}$/.test(a)) ?? 2);

	const store = new InMemoryStore();
	const source = createCspAccountSource({ baseUrl, token, csmEmail, store, maxAccounts: 25 });

	let accounts: { id: string; companyName: string }[];
	if (explicitIds.length > 0) {
		accounts = explicitIds.map((id) => ({ id, companyName: id }));
	} else {
		const all = await source.list();
		accounts = all.slice(0, n);
	}
	if (accounts.length === 0) {
		console.error("[live] No accounts returned from CSP — check creds / CSM email.");
		process.exit(1);
	}

	console.log(
		`[live] Reviewing ${accounts.length} live account(s) for ${csmEmail} via real claude.`,
	);
	console.log("");

	for (const acct of accounts) {
		const ledger = new InMemoryActionLedger();
		const customerChannel = new StubCustomerChannel();
		const csmChannel = new StubCsmChannel();
		await csmChannel.start(async () => null);

		// Live decision-context (fetches real CSP data + computes signals).
		const context = await source.buildSummary(acct.id, acct.companyName);

		const agent = await buildAgentForEval({
			ledger,
			customerChannel,
			csmChannel,
			cspFixtures: {},
			live: true,
		});
		let text = "";
		try {
			const res = (await agent.prompt(
				reviewMessage(acct.companyName, acct.id),
				context,
				`live:${acct.id}`,
			)) as { text?: string };
			text = res?.text ?? "";
		} finally {
			await source.onEvaluated?.(acct.id);
			await agent.close();
		}

		const entries = await ledger.listByWindow(new Date(0), new Date(8640000000000000));
		const bands = entries.map((e: ActionLedgerEntry) => e.band);
		const decision = bands.length > 0 ? bands.join(", ") : "none";
		console.log(`┌─ ${acct.companyName} (${acct.id})`);
		// Surface the computed signal line so the decision is interpretable.
		const sigLine = context.split("\n").find((l) => l.startsWith("- Health:"));
		if (sigLine) console.log(`│ signals: ${sigLine.replace(/^- /, "")}`);
		console.log(`│ agent decision (ledger bands): ${decision}`);
		for (const e of entries) {
			console.log(`│   • ${e.band}: ${e.summary}`);
		}
		if (text) console.log(`│ agent said: ${text.slice(0, 200).replace(/\n/g, " ")}`);
		console.log("└────────────────────────────────────────");
	}
}

main().catch((err) => {
	console.error("[live] Fatal:", err);
	process.exit(1);
});
