import { InMemoryActionLedger, InMemorySituationStore, InMemoryStore } from "@cerebro-claw/memory";
import type { ToolDefinition } from "@cerebro-claw/shared";
import {
	StubCustomerChannel,
	StubRenewalSource,
	createActionPolicyTools,
	createSituationTools,
} from "@cerebro-claw/tools";
import { describe, expect, it, vi } from "vitest";
import { BrainLoop } from "../brain-loop.js";

const RENEWAL_ID = "00000000-0000-0000-0000-000000000001";
const BIZ = "biz-stub-1";

function wireTools(ledger: InMemoryActionLedger, situationStore: InMemorySituationStore) {
	const action = createActionPolicyTools({
		ledger,
		customerChannel: new StubCustomerChannel(),
		sendToCsm: async () => {},
	});
	const situation = createSituationTools({ store: situationStore });
	return new Map([...action, ...situation].map((t) => [t.name, t]));
}

/** Scripted agent: on a renewal prompt, opens a renewal-risk Situation then acts, linking both. */
function renewalAgent(tools: Map<string, ToolDefinition>) {
	const prompt = vi.fn(async (text: string) => {
		const calls: string[] = [];
		if (text.includes(RENEWAL_ID)) {
			const opened = await tools.get("situation_open")?.execute({
				business_id: BIZ,
				kind: "renewal-risk",
				renewal_id: RENEWAL_ID,
				title: "renewal at risk",
				status: "watching",
				checkpoint_hours: 72,
			});
			calls.push("situation_open");
			const situationId = (opened?.details?.situationId as string) ?? undefined;
			await tools.get("act")?.execute({
				customer_id: BIZ,
				summary: "Posted renewal status nudge",
				reason: "Renewal 16d out, at risk",
				evidence: { kind: "renewal", id: RENEWAL_ID },
				situation_id: situationId,
				renewal_id: RENEWAL_ID,
			});
			calls.push("act");
		}
		return { text: "done", toolCalls: calls.map((c) => ({ name: c })) };
	});
	return { prompt };
}

function makeLoop(
	agent: { prompt: ReturnType<typeof vi.fn> },
	ledger: InMemoryActionLedger,
	situationStore: InMemorySituationStore,
) {
	return new BrainLoop(
		new InMemoryStore(),
		agent as never,
		999_999,
		true,
		null,
		undefined,
		null,
		ledger,
		new StubRenewalSource(),
		situationStore,
	);
}

describe("StubRenewalSource", () => {
	it("lists and fetches renewals", async () => {
		const src = new StubRenewalSource();
		const open = await src.listOpen();
		expect(open).toHaveLength(1);
		expect((await src.getContext(open[0].id))?.businessId).toBe(BIZ);
		expect(await src.getContext("missing")).toBeNull();
	});
});

describe("BrainLoop renewal sweep", () => {
	it("works each renewal, opening a renewal-scoped situation and linking the ledger entry", async () => {
		const ledger = new InMemoryActionLedger();
		const situationStore = new InMemorySituationStore();
		const tools = wireTools(ledger, situationStore);
		const agent = renewalAgent(tools);

		await (
			makeLoop(agent, ledger, situationStore) as unknown as {
				cycle(): Promise<void>;
			}
		).cycle();

		expect(agent.prompt.mock.calls).toHaveLength(1);

		// One renewal-risk situation, keyed by renewalId
		const open = await situationStore.listOpen(BIZ);
		expect(open).toHaveLength(1);
		expect(open[0].kind).toBe("renewal-risk");
		expect(open[0].renewalId).toBe(RENEWAL_ID);

		// Ledger entry carries the situation + renewal links
		const entries = await ledger.listByWindow(new Date(0), new Date(Date.now() + 86_400_000));
		const act = entries.find((e) => e.band === "act");
		expect(act?.situationId).toBe(open[0].id);
		expect(act?.renewalId).toBe(RENEWAL_ID);
	});

	it("converges across cycles — no duplicate situation for the same renewal", async () => {
		const ledger = new InMemoryActionLedger();
		const situationStore = new InMemorySituationStore();
		const tools = wireTools(ledger, situationStore);
		const agent = renewalAgent(tools);
		const loop = makeLoop(agent, ledger, situationStore) as unknown as { cycle(): Promise<void> };

		await loop.cycle();
		await loop.cycle();

		// Still exactly one situation for the renewal — idempotent open converged.
		expect(await situationStore.listOpen(BIZ)).toHaveLength(1);
	});
});
