import { afterEach, describe, expect, it, vi } from "vitest";
import { createCspTaskSource } from "../csp-task-source.js";

const NOW = new Date("2026-06-04T08:00:00Z");

/** Route a mocked fetch by "METHOD path" → {ok,status,body}. */
function mockFetch(routes: Record<string, { ok?: boolean; status?: number; body: unknown }>) {
	const calls: { method: string; url: string; body?: unknown }[] = [];
	vi.stubGlobal(
		"fetch",
		vi.fn(async (url: string, init?: { method?: string; body?: string }) => {
			const method = init?.method ?? "GET";
			const path = new URL(url).pathname + new URL(url).search;
			calls.push({ method, url: path, body: init?.body ? JSON.parse(init.body) : undefined });
			// match by "METHOD pathname" (ignoring query) — longest key wins
			const pathname = new URL(url).pathname;
			const key = Object.keys(routes).find((k) => k === `${method} ${pathname}`);
			const r = key ? routes[key] : { ok: false, status: 404, body: { error: "no route" } };
			return {
				ok: r.ok ?? true,
				status: r.status ?? 200,
				text: async () => JSON.stringify(r.body),
			} as unknown as Response;
		}),
	);
	return calls;
}

afterEach(() => vi.unstubAllGlobals());

const opts = { baseUrl: "http://csp.test", token: "tok", now: () => NOW };

const TASK_DETAIL = {
	id: "t-1",
	title: "T-90 Satisfaction Survey - giannistrattoria",
	description: "Renewal reminder",
	status: "IN_PROGRESS",
	priority: "NORMAL",
	dueDate: "2026-02-02T00:00:00.000Z",
	renewalId: null,
	ctaId: "cta-1",
	customFields: {},
	cta: {
		id: "cta-1",
		name: "Renewal - gianni",
		businessId: "6450cbc64cb4cb0007432c42",
		renewalId: "ren-1",
	},
	template: {
		fields: [
			{
				name: "renewalSignal",
				label: "Renewal Signal",
				type: "select",
				options: ["Renewing", "Churn"],
				required: true,
			},
		],
		activityRequired: true,
	},
};

describe("createCspTaskSource", () => {
	it("listOpen queries active statuses with scope and maps records", async () => {
		const calls = mockFetch({
			"GET /api/v1/tasks": {
				body: {
					data: [{ ...TASK_DETAIL, cta: { id: "cta-1", name: "Renewal - gianni", status: "NEW" } }],
				},
			},
		});
		const src = createCspTaskSource(opts);
		const list = await src.listOpen();

		const url = calls[0].url;
		expect(url).toContain("scope=all");
		expect(url).toContain("status=NOT_STARTED%2CIN_PROGRESS%2CBLOCKED");
		expect(list).toHaveLength(1);
		expect(list[0].id).toBe("t-1");
		expect(list[0].status).toBe("in-progress");
	});

	it("getContext maps CTA businessId/renewal + template requirements", async () => {
		mockFetch({ "GET /api/v1/tasks/t-1": { body: { data: TASK_DETAIL } } });
		const src = createCspTaskSource(opts);
		const task = await src.getContext("t-1");

		expect(task?.businessId).toBe("6450cbc64cb4cb0007432c42");
		expect(task?.renewalId).toBe("ren-1"); // falls back to cta.renewalId
		expect(task?.activityRequired).toBe(true);
		expect(task?.requiredFields?.[0]).toMatchObject({
			name: "renewalSignal",
			options: ["Renewing", "Churn"],
		});
	});

	it("writeBack completed runs custom-fields → activity → update in order", async () => {
		const calls = mockFetch({
			"GET /api/v1/tasks/t-1": { body: { data: TASK_DETAIL } },
			"POST /api/v1/tasks/t-1/custom-fields": { body: { success: true } },
			"POST /api/v1/csm-activities": { body: { success: true } },
			"POST /api/v1/tasks/t-1/update": { body: { data: { ...TASK_DETAIL, status: "COMPLETED" } } },
		});
		const src = createCspTaskSource(opts);
		const updated = await src.writeBack("t-1", {
			kind: "completed",
			result: "Renewing — survey sent",
			customFields: { renewalSignal: "Renewing" },
			activity: { type: "MESSAGE", subject: "T-90 survey", sentiment: "POSITIVE" },
		});

		// order: detail GET, custom-fields, activity, update
		const seq = calls.map((c) => `${c.method} ${c.url.split("?")[0]}`);
		expect(seq).toEqual([
			"GET /api/v1/tasks/t-1",
			"POST /api/v1/tasks/t-1/custom-fields",
			"POST /api/v1/csm-activities",
			"POST /api/v1/tasks/t-1/update",
		]);
		// custom-fields body
		expect(calls[1].body).toEqual({ customFields: { renewalSignal: "Renewing" } });
		// activity carries businessId + ctaId + taskId from the task
		expect(calls[2].body).toMatchObject({
			businessId: "6450cbc64cb4cb0007432c42",
			ctaId: "cta-1",
			taskId: "t-1",
			type: "MESSAGE",
		});
		// status transition
		expect(calls[3].body).toEqual({ status: "COMPLETED" });
		expect(updated.status).toBe("done");
	});

	it("writeBack blocked sets BLOCKED and skips empty custom-fields/activity", async () => {
		const calls = mockFetch({
			"GET /api/v1/tasks/t-1": { body: { data: TASK_DETAIL } },
			"POST /api/v1/tasks/t-1/update": { body: { data: { ...TASK_DETAIL, status: "BLOCKED" } } },
		});
		const src = createCspTaskSource(opts);
		await src.writeBack("t-1", { kind: "blocked", result: "needs CSM" });

		const seq = calls.map((c) => `${c.method} ${c.url.split("?")[0]}`);
		expect(seq).toEqual(["GET /api/v1/tasks/t-1", "POST /api/v1/tasks/t-1/update"]);
		expect(calls[1].body).toEqual({ status: "BLOCKED" });
	});

	it("writeBack throws when a step fails (so the ledger marks it failed)", async () => {
		mockFetch({
			"GET /api/v1/tasks/t-1": { body: { data: TASK_DETAIL } },
			"POST /api/v1/tasks/t-1/custom-fields": {
				ok: false,
				status: 400,
				body: { error: "MISSING_REQUIRED_FIELDS" },
			},
		});
		const src = createCspTaskSource(opts);
		await expect(
			src.writeBack("t-1", {
				kind: "completed",
				result: "x",
				customFields: { renewalSignal: "Renewing" },
			}),
		).rejects.toThrow(/custom-fields write failed/);
	});
});
