import { InMemoryActionLedger } from "@cerebro-claw/memory";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CspCustomerChannel } from "../csp-customer-channel.js";
import { NotifyThenActDispatcher } from "../dispatcher.js";

const NOW = new Date("2026-06-10T08:00:00Z");
const BIZ = "aaaaaaaaaaaaaaaaaaaaaaaa";

type Call = { path: string; body: Record<string, unknown> };

function mockCsp(handler: (path: string) => { status: number; body?: unknown }) {
	const calls: Call[] = [];
	vi.stubGlobal(
		"fetch",
		vi.fn(async (url: string, init?: RequestInit) => {
			const path = new URL(url).pathname;
			calls.push({ path, body: JSON.parse(String(init?.body ?? "{}")) });
			const res = handler(path);
			return {
				ok: res.status >= 200 && res.status < 300,
				status: res.status,
				json: async () => res.body ?? {},
			} as unknown as Response;
		}),
	);
	return calls;
}

afterEach(() => vi.unstubAllGlobals());

function channel() {
	return new CspCustomerChannel({
		baseUrl: "http://csp.test",
		token: "t",
		now: () => NOW,
	});
}

describe("CspCustomerChannel", () => {
	it("send writes a CSM activity + note and returns the activity id as evidence", async () => {
		const calls = mockCsp((path) =>
			path.endsWith("/csm-activities")
				? { status: 200, body: { data: { id: "act-1" } } }
				: { status: 200, body: { data: { id: "note-1" } } },
		);
		const res = await channel().send({
			customerId: BIZ,
			recipient: "alice@acme.com",
			text: "Hi Alice — checking in.",
		});
		expect(res.messageId).toBe("act-1");
		expect(res.deliveredAt).toEqual(NOW);
		const activity = calls.find((c) => c.path.endsWith("/csm-activities"));
		expect(activity?.body).toMatchObject({
			businessId: BIZ,
			type: "EMAIL", // recipient is an email address
			summary: "Hi Alice — checking in.",
		});
		expect(String(activity?.body.subject)).toContain("agent:");
		const note = calls.find((c) => c.path.endsWith("/notes"));
		expect(note?.body).toMatchObject({ businessId: BIZ, content: "Hi Alice — checking in." });
	});

	it("uses MESSAGE type for non-email recipients", async () => {
		const calls = mockCsp(() => ({ status: 200, body: { data: { id: "x" } } }));
		await channel().send({ customerId: BIZ, recipient: "+60123456789", text: "hi" });
		const activity = calls.find((c) => c.path.endsWith("/csm-activities"));
		expect(activity?.body.type).toBe("MESSAGE");
	});

	it("throws when the activity write fails (dispatcher marks the entry failed)", async () => {
		mockCsp(() => ({ status: 500, body: { error: "boom" } }));
		await expect(
			channel().send({ customerId: BIZ, recipient: "a@b.com", text: "hi" }),
		).rejects.toThrow(/HTTP 500/);
	});

	it("does NOT throw when only the note write fails — the activity is authoritative", async () => {
		mockCsp((path) =>
			path.endsWith("/csm-activities")
				? { status: 200, body: { data: { id: "act-2" } } }
				: { status: 403, body: {} },
		);
		const res = await channel().send({ customerId: BIZ, recipient: "a@b.com", text: "hi" });
		expect(res.messageId).toBe("act-2");
	});

	it("dispatcher.tick() executes a due notify through CSP and stores the activity id", async () => {
		mockCsp((path) =>
			path.endsWith("/csm-activities")
				? { status: 200, body: { data: { id: "act-dispatch-1" } } }
				: { status: 200, body: { data: { id: "note-9" } } },
		);
		const ledger = new InMemoryActionLedger();
		const entry = await ledger.record({
			band: "notify-then-act",
			customerId: BIZ,
			customerName: "Acme",
			summary: "Send to Acme: check-in",
			reason: "30d silent",
			status: "in-flight",
			createdAt: new Date(NOW.getTime() - 3_600_000),
			executeAt: new Date(NOW.getTime() - 60_000), // due
			payload: { recipient: "alice@acme.com", text: "Hi Alice", channel: "message" },
		});
		const dispatcher = new NotifyThenActDispatcher({
			ledger,
			customerChannel: channel(),
			now: () => NOW,
		});
		const tick = await dispatcher.tick();
		expect(tick).toEqual({ dispatched: 1, failed: 0 });
		const updated = await ledger.get(entry.id);
		expect(updated?.status).toBe("executed");
		expect(updated?.payload?.messageId).toBe("act-dispatch-1");
	});

	it("dispatcher.tick() marks the entry failed when the CSP write fails", async () => {
		mockCsp(() => ({ status: 502, body: { error: "bad gateway" } }));
		const ledger = new InMemoryActionLedger();
		const entry = await ledger.record({
			band: "notify-then-act",
			customerId: BIZ,
			summary: "Send to Acme: check-in",
			reason: "x",
			status: "in-flight",
			createdAt: new Date(NOW.getTime() - 3_600_000),
			executeAt: new Date(NOW.getTime() - 60_000),
			payload: { recipient: "alice@acme.com", text: "Hi Alice" },
		});
		const dispatcher = new NotifyThenActDispatcher({
			ledger,
			customerChannel: channel(),
			now: () => NOW,
		});
		const tick = await dispatcher.tick();
		expect(tick).toEqual({ dispatched: 0, failed: 1 });
		const updated = await ledger.get(entry.id);
		expect(updated?.status).toBe("failed");
		expect(updated?.note).toContain("HTTP 502");
	});

	it("call writes a CALL activity carrying the script", async () => {
		const calls = mockCsp(() => ({ status: 200, body: { data: { id: "call-1" } } }));
		const res = await channel().call({
			customerId: BIZ,
			recipient: "+60123456789",
			script: "Renewal reminder script",
		});
		expect(res.callId).toBe("call-1");
		const activity = calls.find((c) => c.path.endsWith("/csm-activities"));
		expect(activity?.body).toMatchObject({ type: "CALL", summary: "Renewal reminder script" });
	});
});
