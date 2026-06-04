import type { TaskOutcome, TaskRecord, TaskSource, TaskStatus } from "@cerebro-claw/shared";

/**
 * CspTaskSource — binds the pluggable TaskSource to CSP's real Task API.
 *
 * A CSP Task is a CTA-derived, often templated work item (e.g. the playbook
 * "T-90 Renewal Reminder" tasks). The account + renewal it concerns come
 * through its CTA (`cta.businessId`, `cta.renewalId`). Closing a templated task
 * requires (a) filling the template's required fields (e.g. `renewalSignal`)
 * and (b) logging a CSM activity. So `writeBack` is a 3-step sequence:
 *   1. POST /tasks/:id/custom-fields   (required structured outputs)
 *   2. POST /csm-activities            (the logged touch, when required/provided)
 *   3. POST /tasks/:id/update {status} (COMPLETED / BLOCKED)
 *
 * This is the adapter layer: it maps CSP's Task model onto the agent's
 * TaskRecord/TaskOutcome. The agent's own work model (bands + ledger) stays
 * separate — CSP's due-date "PriorityBand" is NOT the agent's action band.
 */

export interface CspTaskSourceOptions {
	baseUrl: string;
	token: string;
	timeoutMs?: number;
	/** Max tasks pulled per cycle. */
	maxTasks?: number;
	/** "all" (whole org) or "mine" (token owner). Default "all". */
	scope?: "all" | "mine";
	/** Clock override (tests). */
	now?: () => Date;
}

interface CspResponse {
	ok: boolean;
	status: number;
	body: unknown;
}

/** CSP TaskStatus → agent TaskStatus. */
function mapStatus(csp: string): TaskStatus {
	switch (csp) {
		case "NOT_STARTED":
			return "open";
		case "IN_PROGRESS":
			return "in-progress";
		case "BLOCKED":
		case "BLOCKED_SYSTEM":
			return "blocked";
		default:
			// COMPLETED / CANCELLED — closed from the agent's perspective.
			return "done";
	}
}

interface CspCta {
	id?: string;
	name?: string;
	status?: string;
	businessId?: string;
	renewalId?: string;
}

interface CspTask {
	id: string;
	title: string;
	description?: string;
	status: string;
	priority?: string;
	dueDate?: string;
	renewalId?: string;
	ctaId?: string;
	customFields?: Record<string, unknown>;
	cta?: CspCta;
	template?: {
		fields?: {
			name: string;
			label?: string;
			type?: string;
			options?: string[];
			required?: boolean;
		}[];
		activityRequired?: boolean;
	};
}

export function createCspTaskSource(opts: CspTaskSourceOptions): TaskSource {
	const baseUrl = opts.baseUrl.replace(/\/$/, "");
	const timeoutMs = opts.timeoutMs ?? 10_000;
	const max = opts.maxTasks ?? 25;
	const scope = opts.scope ?? "all";
	const now = opts.now ?? (() => new Date());

	async function call(method: string, path: string, body?: unknown): Promise<CspResponse> {
		const ac = new AbortController();
		const t = setTimeout(() => ac.abort(), timeoutMs);
		try {
			const headers: Record<string, string> = {
				Authorization: `Bearer ${opts.token}`,
				Accept: "application/json",
			};
			if (body !== undefined) headers["Content-Type"] = "application/json";
			const res = await fetch(`${baseUrl}/api/v1${path}`, {
				method,
				headers,
				signal: ac.signal,
				body: body !== undefined ? JSON.stringify(body) : undefined,
			});
			const text = await res.text();
			let parsed: unknown = text;
			try {
				parsed = text ? JSON.parse(text) : null;
			} catch {
				// keep as text
			}
			return { ok: res.ok, status: res.status, body: parsed };
		} catch (err) {
			const e = err as Error & { name?: string };
			const message =
				e.name === "AbortError" ? `timed out after ${timeoutMs}ms` : `request failed: ${e.message}`;
			return { ok: false, status: 0, body: { error: `CSP task ${message}` } };
		} finally {
			clearTimeout(t);
		}
	}

	function toRecord(task: CspTask): TaskRecord {
		return {
			id: task.id,
			title: task.title,
			status: mapStatus(task.status),
			description: task.description,
			businessId: task.cta?.businessId,
			customerName: task.cta?.name,
			renewalId: task.renewalId ?? task.cta?.renewalId,
			dueDate: task.dueDate ? new Date(task.dueDate) : undefined,
			priority: task.priority,
			requiredFields: task.template?.fields?.map((f) => ({
				name: f.name,
				label: f.label,
				type: f.type,
				options: f.options,
				required: f.required,
			})),
			customFields: task.customFields,
			activityRequired: task.template?.activityRequired,
			meta: { ctaId: task.ctaId },
		};
	}

	return {
		label: `CSP tasks (scope=${scope})`,

		async listOpen() {
			const qs = new URLSearchParams();
			qs.set("scope", scope);
			qs.set("status", "NOT_STARTED,IN_PROGRESS,BLOCKED");
			qs.set("pageSize", String(max));
			const res = await call("GET", `/tasks?${qs}`);
			if (!res.ok) {
				console.error(`[csp-tasks] list failed: HTTP ${res.status}`);
				return [];
			}
			const data = (res.body as { data?: CspTask[] })?.data ?? [];
			return data.map(toRecord);
		},

		async getContext(id) {
			const res = await call("GET", `/tasks/${id}`);
			if (!res.ok) return null;
			const task = (res.body as { data?: CspTask })?.data;
			return task ? toRecord(task) : null;
		},

		async writeBack(id, outcome: TaskOutcome) {
			// Need businessId + ctaId for the activity log — read the task first.
			const detail = await call("GET", `/tasks/${id}`);
			if (!detail.ok) {
				throw new Error(`CSP task ${id} not found (HTTP ${detail.status})`);
			}
			const task = (detail.body as { data?: CspTask })?.data;
			const businessId = task?.cta?.businessId;
			const ctaId = task?.ctaId ?? task?.cta?.id;

			// 1) Required structured fields (e.g. renewalSignal).
			if (outcome.customFields && Object.keys(outcome.customFields).length > 0) {
				const r = await call("POST", `/tasks/${id}/custom-fields`, {
					customFields: outcome.customFields,
				});
				if (!r.ok) throw new Error(`custom-fields write failed: ${JSON.stringify(r.body)}`);
			}

			// 2) Logged CSM activity (required by templated tasks).
			if (outcome.activity && businessId) {
				const a = await call("POST", "/csm-activities", {
					businessId,
					ctaId,
					taskId: id,
					type: outcome.activity.type,
					subject: outcome.activity.subject,
					summary: outcome.activity.summary,
					sentiment: outcome.activity.sentiment,
					outcome: outcome.activity.outcome,
					nextSteps: outcome.activity.nextSteps,
					occurredAt: now().toISOString(),
				});
				if (!a.ok) throw new Error(`activity log failed: ${JSON.stringify(a.body)}`);
			}

			// 3) Status transition.
			const status = outcome.kind === "completed" ? "COMPLETED" : "BLOCKED";
			const u = await call("POST", `/tasks/${id}/update`, { status });
			if (!u.ok) throw new Error(`status update failed: ${JSON.stringify(u.body)}`);

			const updated = (u.body as { data?: CspTask })?.data;
			return updated
				? toRecord(updated)
				: { ...toRecord(task as CspTask), status: mapStatus(status) };
		},
	};
}
