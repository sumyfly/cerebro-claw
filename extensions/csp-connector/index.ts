/**
 * CSP Connector — connects the agent to the Customer Success Platform backend.
 *
 * Pure proxy: every tool call hits CSP. No local sync, no schema duplication.
 * CSP is the source of truth for accounts, health, renewals, notes.
 *
 * Env:
 *   CSP_BASE_URL    — e.g. http://localhost:5656 (default)
 *   CSP_TOKEN       — long-lived JWT bearer token (required)
 *   CSP_CSM_EMAIL   — current CSM's email (used by csp_list_my_accounts)
 *
 * Tools registered:
 *   - csp_list_my_accounts
 *   - csp_get_account
 *   - csp_get_health_score
 *   - csp_get_engagement
 *   - csp_get_notes
 *   - csp_create_note          (write-back)
 *   - csp_delete_note          (write-back)
 *   - csp_get_renewals
 *   - csp_get_renewal
 *   - csp_update_renewal       (write-back)
 */

import type { Extension } from "@cerebro-claw/shared";
import { type CspTransport, HttpCspTransport, MockCspTransport } from "./transport.js";

const NOTE_TYPES = [
	"GENERAL",
	"MEETING",
	"CALL",
	"EMAIL",
	"RENEWAL",
	"RISK",
	"CHURN_RISK",
	"RETENTION_EFFORT",
] as const;
const PRIORITIES = ["LOW", "NORMAL", "HIGH", "URGENT"] as const;

const DEFAULT_BASE = "http://localhost:5656";
const DEFAULT_TIMEOUT_MS = 10_000;
const BUSINESS_ID_RE = /^[a-f\d]{24}$/i;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function configFromEnv() {
	return {
		baseUrl: (process.env.CSP_BASE_URL ?? DEFAULT_BASE).replace(/\/$/, ""),
		token: process.env.CSP_TOKEN ?? "",
		defaultCsmEmail: process.env.CSP_CSM_EMAIL ?? "",
		timeoutMs: Number(process.env.CSP_TIMEOUT_MS ?? DEFAULT_TIMEOUT_MS),
	};
}

function clampLimit(value: unknown, defaultValue: number, max: number): number {
	const n = Math.floor(Number(value ?? defaultValue));
	if (!Number.isFinite(n) || n <= 0) return defaultValue;
	return Math.min(n, max);
}

/**
 * Build the transport the tools share for this factory invocation.
 * `CSP_MOCK=1` swaps in the offline fixture transport (fixtures parsed from
 * `CSP_MOCK_FIXTURES` JSON, keyed by full CSP path); otherwise the live HTTP
 * transport is used. Reads from `process.env`, matching production wiring.
 */
function makeTransport(cfg: {
	baseUrl: string;
	token: string;
	timeoutMs: number;
}): CspTransport {
	if (process.env.CSP_MOCK === "1") {
		let fixtures: Record<string, unknown>;
		try {
			fixtures = JSON.parse(process.env.CSP_MOCK_FIXTURES ?? "{}");
		} catch (err) {
			throw new Error(`CSP_MOCK_FIXTURES is not valid JSON: ${(err as Error).message}`);
		}
		return new MockCspTransport(fixtures);
	}
	return new HttpCspTransport(cfg.baseUrl, cfg.token, cfg.timeoutMs);
}

const extension: Extension = {
	id: "csp-connector",
	factory: (api) => {
		const cfg = configFromEnv();

		// One transport shared by every tool in this factory invocation.
		const transport = makeTransport(cfg);

		if (!cfg.token) {
			console.warn(
				"[csp-connector] CSP_TOKEN not set — CSP tools registered but will return errors until configured.",
			);
		} else {
			console.log(
				`[csp-connector] Wired to ${cfg.baseUrl} as CSM ${cfg.defaultCsmEmail || "(unspecified)"}`,
			);
		}

		api.registerTool({
			name: "csp_list_my_accounts",
			kind: "observe",
			blastRadius: "none",
			description:
				"List the accounts assigned to a CSM in CSP. Returns paginated account summaries (id, name, plan, country, status, health score range). Use this to discover which accounts exist before drilling into details. If no csm_email is provided, the default from CSP_CSM_EMAIL is used.",
			parameters: {
				type: "object",
				properties: {
					csm_email: {
						type: "string",
						description: "Optional. The CSM's email. Defaults to CSP_CSM_EMAIL.",
					},
					search: { type: "string", description: "Optional. Search by account name." },
					limit: { type: "number", description: "Optional page size (default 20, max 100)." },
				},
			},
			async execute(params) {
				const csmEmail = (params.csm_email as string) || cfg.defaultCsmEmail;
				const qs = new URLSearchParams();
				if (csmEmail) qs.set("assignedCsmId", csmEmail);
				if (params.search) qs.set("search", params.search as string);
				qs.set("limit", String(clampLimit(params.limit, 20, 100)));

				const res = await transport.get(`/accounts?${qs}`);
				if (!res.ok) {
					return {
						content: `CSP error ${res.status}: ${JSON.stringify(res.body)}`,
						success: false,
					};
				}
				return {
					content: JSON.stringify(res.body, null, 2),
					success: true,
					details: { status: res.status },
				};
			},
		});

		api.registerTool({
			name: "csp_get_account",
			kind: "observe",
			blastRadius: "none",
			description:
				"Fetch a full account profile from CSP by business ID (24-char hex). Returns name, plan, country, industry, assignedCsmName/Email, status, createdAt, etc. Use this when you need detailed account info — it's the authoritative source.",
			parameters: {
				type: "object",
				properties: {
					business_id: {
						type: "string",
						description: "The CSP account id (24-char hex businessid).",
					},
				},
				required: ["business_id"],
			},
			async execute(params) {
				const id = String(params.business_id);
				if (!BUSINESS_ID_RE.test(id)) {
					return { content: `Invalid business_id (expected 24-char hex): ${id}`, success: false };
				}
				const res = await transport.get(`/accounts/${id}`);
				if (!res.ok) {
					return {
						content: `CSP error ${res.status}: ${JSON.stringify(res.body)}`,
						success: false,
					};
				}
				return {
					content: JSON.stringify(res.body, null, 2),
					success: true,
				};
			},
		});

		api.registerTool({
			name: "csp_get_health_score",
			kind: "observe",
			blastRadius: "none",
			description:
				"Fetch the current health score for an account from CSP. Returns overallScore (0-100), grade, trend, calculatedAt, and the underlying details (drivers). Use this when judging whether an account needs attention.",
			parameters: {
				type: "object",
				properties: {
					business_id: {
						type: "string",
						description: "The CSP account id (24-char hex businessid).",
					},
				},
				required: ["business_id"],
			},
			async execute(params) {
				const id = String(params.business_id);
				if (!BUSINESS_ID_RE.test(id)) {
					return { content: `Invalid business_id (expected 24-char hex): ${id}`, success: false };
				}
				const res = await transport.get(`/accounts/${id}/health-score`);
				if (!res.ok) {
					return {
						content: `CSP error ${res.status}: ${JSON.stringify(res.body)}`,
						success: false,
					};
				}
				return { content: JSON.stringify(res.body, null, 2), success: true };
			},
		});

		api.registerTool({
			name: "csp_get_engagement",
			kind: "observe",
			blastRadius: "none",
			description:
				"Fetch the engagement signal for an account from CSP (logins, activity, recent events). Use this to gauge real product usage — it's the authoritative usage trend, much better than guessing.",
			parameters: {
				type: "object",
				properties: {
					business_id: {
						type: "string",
						description: "The CSP account id (24-char hex businessid).",
					},
				},
				required: ["business_id"],
			},
			async execute(params) {
				const id = String(params.business_id);
				if (!BUSINESS_ID_RE.test(id)) {
					return { content: `Invalid business_id (expected 24-char hex): ${id}`, success: false };
				}
				const res = await transport.get(`/accounts/${id}/engagement`);
				if (!res.ok) {
					return {
						content: `CSP error ${res.status}: ${JSON.stringify(res.body)}`,
						success: false,
					};
				}
				return { content: JSON.stringify(res.body, null, 2), success: true };
			},
		});

		api.registerTool({
			name: "csp_get_notes",
			kind: "observe",
			blastRadius: "none",
			description:
				"List notes for an account from CSP. Returns the most recent notes first by default. These are the CSM's real notes — calls, meetings, decisions, observations.",
			parameters: {
				type: "object",
				properties: {
					business_id: {
						type: "string",
						description: "The CSP account id (24-char hex businessid).",
					},
					search: { type: "string", description: "Optional keyword search across note content." },
					type: {
						type: "string",
						description: `Optional filter by note type. One of: ${NOTE_TYPES.join(", ")}.`,
						enum: [...NOTE_TYPES],
					},
					limit: { type: "number", description: "Page size (default 10, max 50)." },
				},
				required: ["business_id"],
			},
			async execute(params) {
				const id = String(params.business_id);
				if (!BUSINESS_ID_RE.test(id)) {
					return { content: `Invalid business_id (expected 24-char hex): ${id}`, success: false };
				}
				const qs = new URLSearchParams();
				qs.set("businessId", id);
				if (params.search) qs.set("search", String(params.search));
				if (params.type) qs.set("type", String(params.type));
				qs.set("pageSize", String(clampLimit(params.limit, 10, 50)));
				qs.set("sortBy", "createdAt");
				qs.set("sortOrder", "desc");

				const res = await transport.get(`/notes?${qs}`);
				if (!res.ok) {
					return {
						content: `CSP error ${res.status}: ${JSON.stringify(res.body)}`,
						success: false,
					};
				}
				return { content: JSON.stringify(res.body, null, 2), success: true };
			},
		});

		api.registerTool({
			name: "csp_create_note",
			// A CSP note is a CSM-visible artifact (the CSM and team see it in CSP).
			// Notes are reversible (delete works) and authored on the agent's behalf —
			// so this is `act` + csm-only, not customer-reaching.
			kind: "act",
			blastRadius: "csm-only",
			description:
				"Create a note on a CSP account — this writes back to the platform so the CSM and team can see it. Use this when the CSM tells you to log something ('add a note that...'), when you finalize a brief worth keeping, or when you observe something that should be visible to the team. For private agent observations the CSM doesn't need to see logged, prefer memory_instinct instead.",
			parameters: {
				type: "object",
				properties: {
					business_id: {
						type: "string",
						description: "The CSP account id (24-char hex businessid).",
					},
					content: {
						type: "string",
						description: "The note body (required). Use Markdown if helpful.",
					},
					title: { type: "string", description: "Optional short title for the note." },
					type: {
						type: "string",
						description: "Note type. Defaults to GENERAL.",
						enum: [...NOTE_TYPES],
					},
					priority: {
						type: "string",
						description: "Note priority. Defaults to NORMAL.",
						enum: [...PRIORITIES],
					},
					is_private: {
						type: "boolean",
						description: "If true, the note is only visible to the author. Defaults to false.",
					},
					renewal_id: { type: "string", description: "Optional renewal this note relates to." },
				},
				required: ["business_id", "content"],
			},
			async execute(params) {
				const id = String(params.business_id);
				if (!BUSINESS_ID_RE.test(id)) {
					return { content: `Invalid business_id (expected 24-char hex): ${id}`, success: false };
				}
				const body: Record<string, unknown> = {
					businessId: id,
					content: String(params.content),
				};
				if (params.title) body.title = String(params.title);
				if (params.type) body.type = String(params.type);
				if (params.priority) body.priority = String(params.priority);
				if (params.is_private !== undefined) body.isPrivate = Boolean(params.is_private);
				if (params.renewal_id) body.renewalId = String(params.renewal_id);

				const res = await transport.post("/notes", body);
				if (!res.ok) {
					return {
						content: `CSP error ${res.status}: ${JSON.stringify(res.body)}`,
						success: false,
					};
				}
				return {
					content: `Note created in CSP. ${JSON.stringify(res.body)}`,
					success: true,
				};
			},
		});

		api.registerTool({
			name: "csp_delete_note",
			kind: "act",
			blastRadius: "csm-only",
			description:
				"Delete a note in CSP by its id. Use this only when the CSM explicitly asks to remove a note, or to clean up notes the agent itself created during testing. Once deleted the note is gone — there is no undo.",
			parameters: {
				type: "object",
				properties: {
					note_id: {
						type: "string",
						description: "The CSP note id (UUID, 36 chars with dashes).",
					},
				},
				required: ["note_id"],
			},
			async execute(params) {
				const id = String(params.note_id);
				if (!UUID_RE.test(id)) {
					return {
						content: `Invalid note_id (expected UUID): ${id}`,
						success: false,
					};
				}
				const res = await transport.post(`/notes/${id}/delete`, {});
				if (!res.ok) {
					return {
						content: `CSP error ${res.status}: ${JSON.stringify(res.body)}`,
						success: false,
					};
				}
				return { content: `Note ${id} deleted from CSP.`, success: true };
			},
		});

		api.registerTool({
			name: "csp_get_renewals",
			kind: "observe",
			blastRadius: "none",
			description:
				"List renewals for an account from CSP. Returns renewal records with date, status, owner, ARR. Use this to understand what renewals are coming up for a specific account.",
			parameters: {
				type: "object",
				properties: {
					business_id: {
						type: "string",
						description: "The CSP account id (24-char hex businessid).",
					},
					status: { type: "string", description: "Optional filter by renewal status." },
					limit: { type: "number", description: "Page size (default 10, max 50)." },
				},
				required: ["business_id"],
			},
			async execute(params) {
				const id = String(params.business_id);
				if (!BUSINESS_ID_RE.test(id)) {
					return { content: `Invalid business_id (expected 24-char hex): ${id}`, success: false };
				}
				const qs = new URLSearchParams();
				if (params.status) qs.set("status", String(params.status));
				qs.set("pageSize", String(clampLimit(params.limit, 10, 50)));

				const res = await transport.get(`/accounts/${id}/renewals?${qs}`);
				if (!res.ok) {
					return {
						content: `CSP error ${res.status}: ${JSON.stringify(res.body)}`,
						success: false,
					};
				}
				return { content: JSON.stringify(res.body, null, 2), success: true };
			},
		});

		api.registerTool({
			name: "csp_get_renewal",
			kind: "observe",
			blastRadius: "none",
			description:
				"Fetch a single renewal record by its ID (UUID). Returns full detail including status history, playbook progress, owner, ARR.",
			parameters: {
				type: "object",
				properties: {
					renewal_id: {
						type: "string",
						description: "The CSP renewal id (UUID, 36 chars with dashes).",
					},
				},
				required: ["renewal_id"],
			},
			async execute(params) {
				const id = String(params.renewal_id);
				if (!UUID_RE.test(id)) {
					return {
						content: `Invalid renewal_id (expected UUID): ${id}`,
						success: false,
					};
				}
				const res = await transport.get(`/renewals/${id}`);
				if (!res.ok) {
					return {
						content: `CSP error ${res.status}: ${JSON.stringify(res.body)}`,
						success: false,
					};
				}
				return { content: JSON.stringify(res.body, null, 2), success: true };
			},
		});

		api.registerTool({
			name: "csp_update_renewal",
			// A renewal update changes a customer-visible record (the CSM and customer
			// can see status / stage shifts in CSP). CSP rejects irreversible commercial
			// transitions for the agent's role; the tool guidance routes those to
			// escalate. So in practice this is customer-reversible at the harness layer.
			kind: "act",
			blastRadius: "customer-reversible",
			description:
				"Advance a renewal in CSP (write-back): update its status and/or playbook stage. Use this to move a renewal forward as part of the action policy — pair it with the right band: a routine status note is an Act; a customer nudge goes through notify_then_send_to_customer; a discount/contract change is an Escalate (don't self-approve commercial terms). IMPORTANT: if CSP rejects the update (transition not permitted for your role), do NOT force it — fall back to csp_create_note to record the intent and/or escalate so the CSM can act. Report what you could and could not change.",
			parameters: {
				type: "object",
				properties: {
					renewal_id: {
						type: "string",
						description: "The CSP renewal id (UUID, 36 chars with dashes).",
					},
					status: {
						type: "string",
						description: "Optional new renewal status (e.g. IN_PROGRESS, AT_RISK, WON, LOST).",
					},
					playbook_stage: {
						type: "string",
						description: "Optional playbook stage to advance the renewal to.",
					},
					note: {
						type: "string",
						description: "Optional short note recorded with the update (why you advanced it).",
					},
				},
				required: ["renewal_id"],
			},
			async execute(params) {
				const id = String(params.renewal_id);
				if (!UUID_RE.test(id)) {
					return {
						content: `Invalid renewal_id (expected UUID): ${id}`,
						success: false,
					};
				}
				const body: Record<string, unknown> = {};
				if (params.status) body.status = String(params.status);
				if (params.playbook_stage) body.playbookStage = String(params.playbook_stage);
				if (params.note) body.note = String(params.note);
				if (Object.keys(body).length === 0) {
					return {
						content: "Nothing to update — provide at least one of status, playbook_stage, note.",
						success: false,
					};
				}

				// CSP renewal mutation endpoint. The exact path/permitted transitions are
				// confirmed as part of the task-backend open question (design.md); this is
				// the write-back seam — the agent guidance above handles a rejection.
				const res = await transport.post(`/renewals/${id}/update`, body);
				if (!res.ok) {
					return {
						content: `CSP rejected the renewal update (${res.status}): ${JSON.stringify(res.body)}. Fall back to csp_create_note and/or escalate — do not force the transition.`,
						success: false,
						details: { status: res.status, renewalId: id },
					};
				}
				return {
					content: `Renewal ${id} updated in CSP. ${JSON.stringify(res.body)}`,
					success: true,
					details: { renewalId: id },
				};
			},
		});
	},
};

export default extension;
