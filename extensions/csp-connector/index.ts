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
 *   - csp_get_renewals
 *   - csp_get_renewal
 */

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

import type { Extension } from "@cerebro-claw/shared";

const DEFAULT_BASE = "http://localhost:5656";

function configFromEnv(getConfig: () => Record<string, string>) {
	const env = getConfig();
	return {
		baseUrl: (env.CSP_BASE_URL ?? process.env.CSP_BASE_URL ?? DEFAULT_BASE).replace(/\/$/, ""),
		token: env.CSP_TOKEN ?? process.env.CSP_TOKEN ?? "",
		defaultCsmEmail: env.CSP_CSM_EMAIL ?? process.env.CSP_CSM_EMAIL ?? "",
	};
}

interface CspResponse {
	ok: boolean;
	status: number;
	body: unknown;
}

async function cspFetch(
	baseUrl: string,
	token: string,
	path: string,
	init: RequestInit = {},
): Promise<CspResponse> {
	if (!token) {
		return {
			ok: false,
			status: 0,
			body: {
				error: "CSP_TOKEN not configured. Set it in your environment to enable CSP queries.",
			},
		};
	}
	try {
		const url = `${baseUrl}${path.startsWith("/") ? path : `/${path}`}`;
		const headers: Record<string, string> = {
			Authorization: `Bearer ${token}`,
			Accept: "application/json",
		};
		if (init.body) headers["Content-Type"] = "application/json";

		const res = await fetch(url, { ...init, headers: { ...headers, ...(init.headers as Record<string, string> | undefined) } });
		const text = await res.text();
		let body: unknown = text;
		try {
			body = text ? JSON.parse(text) : null;
		} catch {
			// keep as text
		}
		return { ok: res.ok, status: res.status, body };
	} catch (err) {
		return {
			ok: false,
			status: 0,
			body: { error: `CSP request failed: ${(err as Error).message}` },
		};
	}
}

const extension: Extension = {
	id: "csp-connector",
	factory: (api) => {
		const cfg = configFromEnv(api.getConfig);

		if (!cfg.token) {
			console.warn(
				"[csp-connector] CSP_TOKEN not set — CSP tools registered but will return errors until configured.",
			);
		} else {
			console.log(`[csp-connector] Wired to ${cfg.baseUrl} as CSM ${cfg.defaultCsmEmail || "(unspecified)"}`);
		}

		api.registerTool({
			name: "csp_list_my_accounts",
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
				qs.set("limit", String(Math.min(Number(params.limit ?? 20), 100)));

				const res = await cspFetch(cfg.baseUrl, cfg.token, `/api/accounts?${qs}`);
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
				if (!/^[a-f\d]{24}$/i.test(id)) {
					return { content: `Invalid business_id (expected 24-char hex): ${id}`, success: false };
				}
				const res = await cspFetch(cfg.baseUrl, cfg.token, `/api/accounts/${id}`);
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
				if (!/^[a-f\d]{24}$/i.test(id)) {
					return { content: `Invalid business_id (expected 24-char hex): ${id}`, success: false };
				}
				const res = await cspFetch(cfg.baseUrl, cfg.token, `/api/accounts/${id}/health-score`);
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
			description:
				"Fetch the engagement signal for an account from CSP (logins, activity, recent events). Use this to gauge real product usage — it's the authoritative usage trend, much better than guessing.",
			parameters: {
				type: "object",
				properties: {
					business_id: { type: "string", description: "The CSP account id (24-char hex businessid)." },
				},
				required: ["business_id"],
			},
			async execute(params) {
				const id = String(params.business_id);
				if (!/^[a-f\d]{24}$/i.test(id)) {
					return { content: `Invalid business_id (expected 24-char hex): ${id}`, success: false };
				}
				const res = await cspFetch(cfg.baseUrl, cfg.token, `/api/accounts/${id}/engagement`);
				if (!res.ok) {
					return { content: `CSP error ${res.status}: ${JSON.stringify(res.body)}`, success: false };
				}
				return { content: JSON.stringify(res.body, null, 2), success: true };
			},
		});

		api.registerTool({
			name: "csp_get_notes",
			description:
				"List notes for an account from CSP. Returns the most recent notes first by default. These are the CSM's real notes — calls, meetings, decisions, observations.",
			parameters: {
				type: "object",
				properties: {
					business_id: { type: "string", description: "The CSP account id (24-char hex businessid)." },
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
				if (!/^[a-f\d]{24}$/i.test(id)) {
					return { content: `Invalid business_id (expected 24-char hex): ${id}`, success: false };
				}
				const qs = new URLSearchParams();
				qs.set("businessId", id);
				if (params.search) qs.set("search", String(params.search));
				if (params.type) qs.set("type", String(params.type));
				qs.set("pageSize", String(Math.min(Number(params.limit ?? 10), 50)));
				qs.set("sortBy", "createdAt");
				qs.set("sortOrder", "desc");

				const res = await cspFetch(cfg.baseUrl, cfg.token, `/api/notes?${qs}`);
				if (!res.ok) {
					return { content: `CSP error ${res.status}: ${JSON.stringify(res.body)}`, success: false };
				}
				return { content: JSON.stringify(res.body, null, 2), success: true };
			},
		});

		api.registerTool({
			name: "csp_create_note",
			description:
				"Create a note on a CSP account — this writes back to the platform so the CSM and team can see it. Use this when the CSM tells you to log something ('add a note that...'), when you finalize a brief worth keeping, or when you observe something that should be visible to the team. For private agent observations the CSM doesn't need to see logged, prefer memory_instinct instead.",
			parameters: {
				type: "object",
				properties: {
					business_id: { type: "string", description: "The CSP account id (24-char hex businessid)." },
					content: { type: "string", description: "The note body (required). Use Markdown if helpful." },
					title: { type: "string", description: "Optional short title for the note." },
					type: {
						type: "string",
						description: `Note type. Defaults to GENERAL.`,
						enum: [...NOTE_TYPES],
					},
					priority: {
						type: "string",
						description: `Note priority. Defaults to NORMAL.`,
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
				if (!/^[a-f\d]{24}$/i.test(id)) {
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

				const res = await cspFetch(cfg.baseUrl, cfg.token, "/api/notes", {
					method: "POST",
					body: JSON.stringify(body),
				});
				if (!res.ok) {
					return { content: `CSP error ${res.status}: ${JSON.stringify(res.body)}`, success: false };
				}
				return {
					content: `Note created in CSP. ${JSON.stringify(res.body)}`,
					success: true,
				};
			},
		});

		api.registerTool({
			name: "csp_get_renewals",
			description:
				"List renewals for an account from CSP. Returns renewal records with date, status, owner, ARR. Use this to understand what renewals are coming up for a specific account.",
			parameters: {
				type: "object",
				properties: {
					business_id: { type: "string", description: "The CSP account id (24-char hex businessid)." },
					status: { type: "string", description: "Optional filter by renewal status." },
					limit: { type: "number", description: "Page size (default 10, max 50)." },
				},
				required: ["business_id"],
			},
			async execute(params) {
				const id = String(params.business_id);
				if (!/^[a-f\d]{24}$/i.test(id)) {
					return { content: `Invalid business_id (expected 24-char hex): ${id}`, success: false };
				}
				const qs = new URLSearchParams();
				if (params.status) qs.set("status", String(params.status));
				qs.set("pageSize", String(Math.min(Number(params.limit ?? 10), 50)));

				const res = await cspFetch(
					cfg.baseUrl,
					cfg.token,
					`/api/accounts/${id}/renewals?${qs}`,
				);
				if (!res.ok) {
					return { content: `CSP error ${res.status}: ${JSON.stringify(res.body)}`, success: false };
				}
				return { content: JSON.stringify(res.body, null, 2), success: true };
			},
		});

		api.registerTool({
			name: "csp_get_renewal",
			description:
				"Fetch a single renewal record by its ID. Returns full detail including status history, playbook progress, owner, ARR.",
			parameters: {
				type: "object",
				properties: {
					renewal_id: { type: "string", description: "The CSP renewal id (24-char hex)." },
				},
				required: ["renewal_id"],
			},
			async execute(params) {
				const id = String(params.renewal_id);
				if (!/^[a-f\d]{24}$/i.test(id)) {
					return { content: `Invalid renewal_id (expected 24-char hex): ${id}`, success: false };
				}
				const res = await cspFetch(cfg.baseUrl, cfg.token, `/api/renewals/${id}`);
				if (!res.ok) {
					return { content: `CSP error ${res.status}: ${JSON.stringify(res.body)}`, success: false };
				}
				return { content: JSON.stringify(res.body, null, 2), success: true };
			},
		});
	},
};

export default extension;
