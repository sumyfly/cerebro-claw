/**
 * LIVE portfolio run — the actual CSM daily loop over real Cerebro.
 *
 * Reviews the CSM's first N live accounts with ONE agent into ONE shared action
 * ledger (like the brain loop's cycle), then prints the CSM's daily view: the
 * three-number headline + the escalations that need them and the notifies
 * in-flight. This is the product's headline deliverable, end-to-end, on live data.
 *
 *   set -a; . ./.env; set +a
 *   pnpm --filter @cerebro-claw/server eval:portfolio          # first 4 accounts
 *   pnpm --filter @cerebro-claw/server eval:portfolio -- 6
 */
import { InMemoryActionLedger, InMemoryStore } from "@cerebro-claw/memory";
import { StubCsmChannel, StubCustomerChannel } from "@cerebro-claw/tools";
import { createCspAccountSource } from "../brain-loop.js";
import { computeDigestCounts, digestHeadline } from "../digest.js";
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
		console.error("[portfolio] CSP_BASE_URL, CSP_TOKEN, CSP_CSM_EMAIL must be set (source .env).");
		process.exit(2);
	}
	const n = Number(process.argv.slice(2).find((a) => /^\d{1,2}$/.test(a)) ?? 4);

	const store = new InMemoryStore();
	const ledger = new InMemoryActionLedger();
	const customerChannel = new StubCustomerChannel();
	const csmChannel = new StubCsmChannel();
	await csmChannel.start(async () => null);
	const source = createCspAccountSource({ baseUrl, token, csmEmail, store, maxAccounts: 25 });

	const accounts = (await source.list()).slice(0, n);
	if (accounts.length === 0) {
		console.error("[portfolio] No accounts from CSP.");
		process.exit(1);
	}

	// ONE agent + ONE ledger across the whole portfolio slice, like the brain loop.
	const agent = await buildAgentForEval({
		ledger,
		customerChannel,
		csmChannel,
		cspFixtures: {},
		live: true,
	});

	console.log(`[portfolio] Working ${accounts.length} live accounts for ${csmEmail}…\n`);
	try {
		for (const acct of accounts) {
			const context = await source.buildSummary(acct.id, acct.companyName);
			await agent.prompt(reviewMessage(acct.companyName, acct.id), context, `pf:${acct.id}`);
			await source.onEvaluated?.(acct.id);
			process.stdout.write(`  · reviewed ${acct.companyName}\n`);
		}
	} finally {
		await agent.close();
	}

	const counts = await computeDigestCounts(ledger, new Date(), 24);
	const open = await ledger.listOpen();
	const all = await ledger.listByWindow(new Date(0), new Date(8640000000000000));

	console.log("\n══════════════════════════════════════════════");
	console.log("  CSM daily digest (live Cerebro)");
	console.log("══════════════════════════════════════════════");
	console.log(`  ${digestHeadline(counts)}\n`);

	const escalations = open.filter((e) => e.band === "escalate");
	if (escalations.length > 0) {
		console.log("  Escalations needing you:");
		for (const e of escalations)
			console.log(`   ⚑ ${e.customerName ?? e.customerId}: ${e.summary}`);
		console.log("");
	}
	const inflight = open.filter((e) => e.band === "notify-then-act");
	if (inflight.length > 0) {
		console.log("  Notifies in-flight (cancel if you disagree):");
		for (const e of inflight) console.log(`   → ${e.customerName ?? e.customerId}: ${e.summary}`);
		console.log("");
	}
	const acts = all.filter((e) => e.band === "act");
	if (acts.length > 0) {
		console.log("  Acts logged (FYI):");
		for (const e of acts) console.log(`   ✓ ${e.customerName ?? e.customerId}: ${e.summary}`);
	}
	console.log("══════════════════════════════════════════════");
}

main().catch((err) => {
	console.error("[portfolio] Fatal:", err);
	process.exit(1);
});
