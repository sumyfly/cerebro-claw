import type {
	ActionLedger,
	ActionLedgerEntry,
	CustomerChannel,
	ToolDefinition,
	ToolParameterProperty,
	VerificationInput,
	VerificationResult,
} from "@cerebro-claw/shared";

/** Optional link fields shared by every action tool so ledger entries join a Situation storyline. */
const SITUATION_LINK_PROPS: Record<string, ToolParameterProperty> = {
	situation_id: {
		type: "string",
		description: "Link this action to an open Situation (its id) so it joins that storyline.",
	},
	renewal_id: {
		type: "string",
		description: "Renewal UUID this action concerns, when renewal-scoped (the CTA join).",
	},
};

function situationLink(params: Record<string, unknown>): {
	situationId?: string;
	renewalId?: string;
} {
	return {
		situationId: (params.situation_id as string) ?? undefined,
		renewalId: (params.renewal_id as string) ?? undefined,
	};
}

/** Kinds of real effects an Act can point at. */
const EVIDENCE_KINDS = ["note", "activity", "renewal", "other"] as const;

export interface ActEvidence {
	kind: (typeof EVIDENCE_KINDS)[number];
	id: string;
}

/**
 * Parse the `evidence` param into a validated reference, or null. An Act must
 * point at a real effect (the CSP note id, activity id, renewal id, or another
 * verifiable artifact id) — the ledger records deeds, not narration.
 */
function parseEvidence(value: unknown): ActEvidence | null {
	if (!value || typeof value !== "object" || Array.isArray(value)) return null;
	const e = value as Record<string, unknown>;
	const kind = String(e.kind ?? "");
	const id = String(e.id ?? "").trim();
	if (!EVIDENCE_KINDS.includes(kind as ActEvidence["kind"]) || !id) return null;
	return { kind: kind as ActEvidence["kind"], id };
}

/**
 * Context the action-policy tools need.
 *
 * - ledger: where every act/notify/escalate/prep lands.
 * - customerChannel: how the agent reaches a customer (stubbed by default).
 * - sendToCsm: how the agent reaches the CSM internally (Lark, email, etc).
 *   Returns void — failures must throw so the tools can surface them.
 * - defaultCsmRecipientId: where to deliver heads-ups/escalations when the
 *   caller didn't specify one. Usually DEFAULT_CSM_LARK_USER_ID.
 * - defaultPauseMinutes: pause window for notify-then-act when the agent
 *   didn't pick one. 240min (4h) per work-inventory.md.
 * - now: clock — injectable for tests.
 * - resolveOverride: per-customer/per-CSM rule lookup. If it returns a band,
 *   that band is the ENFORCED minimum for the customer — act/notify/prep are
 *   refused and the agent is told to use the required band. This is the hard
 *   gate that makes overrides real, not just prompt guidance.
 */
export interface ActionPolicyToolsContext {
	ledger: ActionLedger;
	customerChannel: CustomerChannel;
	sendToCsm: (recipientId: string, text: string) => Promise<void>;
	defaultCsmRecipientId?: string;
	defaultPauseMinutes?: number;
	now?: () => Date;
	resolveOverride?: (
		customerId: string,
	) => Promise<{ forcesBand?: string } | null> | { forcesBand?: string } | null;
	/**
	 * Critic that verifies a high-stakes action before it commits. When it
	 * returns pass=false the action is blocked (recorded as failed). Absent =
	 * verification disabled. See `verifyBands` for which bands are gated.
	 */
	verify?: (input: VerificationInput) => Promise<VerificationResult>;
	/** Bands gated by `verify`. Default: notify-then-act + escalate. */
	verifyBands?: string[];
}

/** Band severity, low → high. An override forcing a higher band blocks lower ones. */
const BAND_SEVERITY: Record<string, number> = {
	act: 0,
	prep: 1,
	"notify-then-act": 2,
	escalate: 3,
};

const BAND_LABEL: Record<string, string> = {
	act: "Act",
	"notify-then-act": "Notify-then-act",
	escalate: "Escalate",
	prep: "Prep",
};

export function createActionPolicyTools(ctx: ActionPolicyToolsContext): ToolDefinition[] {
	const now = () => ctx.now?.() ?? new Date();
	const defaultPauseMinutes = ctx.defaultPauseMinutes ?? 240;

	// Resolve where to send the CSM heads-up / brief / artifact. When nothing is
	// configured (no DEFAULT_CSM_LARK_USER_ID, no per-call override), fall back
	// to a stub recipient. The wired sendToCsm callback decides what "stub"
	// means in practice — usually logging to stderr — so the action policy
	// degrades gracefully instead of failing the whole tool call.
	function csmRecipient(explicit?: string): string {
		return explicit ?? ctx.defaultCsmRecipientId ?? "stub-csm";
	}

	/**
	 * Hard override gate. If the customer has an override forcing a band stricter
	 * than `attemptedBand`, refuse the action and tell the agent to use the
	 * required band. Returns a refusal ToolResult, or null when allowed.
	 */
	async function overrideBlock(customerId: string, attemptedBand: string) {
		if (!ctx.resolveOverride) return null;
		const override = await ctx.resolveOverride(customerId);
		const forced = override?.forcesBand;
		if (!forced) return null;
		if ((BAND_SEVERITY[forced] ?? 0) <= (BAND_SEVERITY[attemptedBand] ?? 0)) return null;
		return {
			content: `Blocked by override: account ${customerId} requires the "${forced}" band. Do not use ${BAND_LABEL[attemptedBand] ?? attemptedBand} here — call ${forced === "escalate" ? "escalate (with situation + options + recommendation)" : `\`${forced}\``} instead.`,
			success: false,
			details: { blockedBy: "override", requiredBand: forced, attemptedBand },
		};
	}

	const verifyBands = new Set(ctx.verifyBands ?? ["notify-then-act", "escalate"]);

	/**
	 * Critic gate. For a band in `verifyBands`, run the verifier; if it fails,
	 * record the blocked attempt (a `failed` ledger entry carrying the critic's
	 * reason) and return a failure ToolResult so the action does NOT proceed.
	 * Returns null when allowed (verification off, band not gated, or passed).
	 */
	async function verifyGate(
		band: string,
		params: Record<string, unknown>,
		summary: string,
		reason: string,
	) {
		if (!ctx.verify || !verifyBands.has(band)) return null;
		const result = await ctx.verify({
			band,
			customerId: params.customer_id as string,
			customerName: (params.customer_name as string) ?? undefined,
			summary,
			reason,
			payload: params as Record<string, unknown>,
		});
		if (result.pass) return null;
		const entry = await ctx.ledger.record({
			band: band as ActionLedgerEntry["band"],
			customerId: params.customer_id as string,
			customerName: (params.customer_name as string) ?? undefined,
			summary,
			reason,
			status: "failed",
			createdAt: now(),
			note: `Blocked by verifier: ${result.reason}`,
			...situationLink(params),
		});
		return {
			content: `Blocked by verifier (#${entry.id.slice(0, 8)}): ${result.reason}${
				result.suggestedBand ? ` — consider ${result.suggestedBand} instead` : ""
			}`,
			success: false,
			details: {
				blockedBy: "verifier",
				reason: result.reason,
				suggestedBand: result.suggestedBand,
				actionId: entry.id,
			},
		};
	}

	const act: ToolDefinition = {
		name: "act",
		description:
			"Record an autonomous action the agent has already taken (Act band), citing evidence of the real effect (the artifact id). NOTE: CSP writes (csp_create_note, csp_update_renewal) are recorded in the ledger AUTOMATICALLY — do NOT also call act for those. Use act only for other verifiable work (e.g. an instinct captured via memory_instinct — cite its id). Reversible, low-stakes, fact-based work only. Increments the daily Act counter in the digest.",
		parameters: {
			type: "object",
			properties: {
				customer_id: {
					type: "string",
					description: "Customer this action relates to (CSP business id)",
				},
				customer_name: { type: "string", description: "Customer name for the digest line" },
				summary: { type: "string", description: "One-line description of what you just did" },
				reason: {
					type: "string",
					description: "Why this action was warranted (signal + judgment)",
				},
				evidence: {
					type: "object",
					description:
						'Reference to the real effect behind this act: {kind: "note"|"activity"|"renewal"|"other", id: "<object id>"} — e.g. the CSP note id returned by csp_create_note, the renewal UUID you updated, or the instinct/memory id you wrote.',
				},
				...SITUATION_LINK_PROPS,
			},
			required: ["customer_id", "summary", "reason", "evidence"],
		},
		async execute(params) {
			const blocked = await overrideBlock(params.customer_id as string, "act");
			if (blocked) return blocked;
			const evidence = parseEvidence(params.evidence);
			if (!evidence) {
				return {
					content:
						"Act refused: no evidence of a real effect. Do the actual work first (e.g. memory_instinct — it returns the instinct id), then call act with evidence {kind, id} referencing what you created. CSP notes and renewal updates are recorded automatically — don't call act for those at all. If there is nothing to point at, this is not an Act — say no action is needed, or use prep/escalate.",
					success: false,
					details: { blockedBy: "missing-evidence" },
				};
			}
			// Dedup by evidence: if a ledger entry already cites this artifact
			// (e.g. the observer auto-recorded the CSP write), don't add a second —
			// one deed must count once in the digest, regardless of call order.
			const recent = await ctx.ledger.listRecentByCustomer(params.customer_id as string, 20);
			const already = recent.find(
				(e) =>
					(e.payload as { evidence?: { id?: string } } | undefined)?.evidence?.id === evidence.id,
			);
			if (already) {
				return {
					content: `Already recorded (#${already.id.slice(0, 8)}): an entry citing evidence ${evidence.id} exists — not double-counting. Nothing more to do.`,
					success: true,
					details: { actionId: already.id, deduped: true },
				};
			}
			const ts = now();
			const entry = await ctx.ledger.record({
				band: "act",
				customerId: params.customer_id as string,
				customerName: (params.customer_name as string) ?? undefined,
				summary: params.summary as string,
				reason: params.reason as string,
				status: "done",
				createdAt: ts,
				executedAt: ts,
				payload: { evidence },
				...situationLink(params),
			});
			return {
				content: `Act logged (#${entry.id.slice(0, 8)}): ${entry.summary}`,
				success: true,
				details: { actionId: entry.id, band: entry.band },
			};
		},
	};

	const notify: ToolDefinition = {
		name: "notify_then_send_to_customer",
		description:
			"Notify-then-act band: send a heads-up to the CSM now, schedule the customer-facing message after a short pause window (default 4h). If the CSM cancels via cancel_pending_action during the window, the send never happens. Use this for routine customer touches: monthly check-ins, feature-adoption nudges, post-onboarding follow-ups, renewal nudges. The CSM only needs to step in if they want to cancel.",
		parameters: {
			type: "object",
			properties: {
				customer_id: { type: "string", description: "Customer this is about (CSP business id)" },
				customer_name: { type: "string", description: "Customer name for the digest line" },
				recipient: {
					type: "string",
					description: "How to reach the customer (email, phone, contact id, etc.)",
				},
				text: { type: "string", description: "The message to send to the customer" },
				channel: {
					type: "string",
					description: "How to reach the customer: 'message' (default) or 'call'.",
					enum: ["message", "call"],
				},
				reason: {
					type: "string",
					description: "Why you're sending this — shown to the CSM in the heads-up",
				},
				pause_minutes: {
					type: "number",
					description:
						"Minutes the CSM has to cancel before the send dispatches (default 240, max 1440)",
				},
				csm_recipient_id: {
					type: "string",
					description: "Override the CSM channel recipient (defaults to DEFAULT_CSM_LARK_USER_ID)",
				},
				...SITUATION_LINK_PROPS,
			},
			required: ["customer_id", "recipient", "text", "reason"],
		},
		async execute(params) {
			const blocked = await overrideBlock(params.customer_id as string, "notify-then-act");
			if (blocked) return blocked;
			const customerName = (params.customer_name as string) ?? (params.customer_id as string);
			// Dedup gate — one in-flight customer touch per customer.
			const findOpenNotify = async () => {
				const openEntries = await ctx.ledger.listOpen();
				return openEntries.find(
					(e) =>
						e.band === "notify-then-act" &&
						e.status === "in-flight" &&
						e.customerId === (params.customer_id as string),
				);
			};
			const dedupRefusal = (dup: ActionLedgerEntry) => ({
				content: `Notify refused: ${customerName} already has an in-flight send (#${dup.id.slice(0, 8)}${dup.executeAt ? `, dispatches ${dup.executeAt.toISOString()}` : ""}): "${dup.summary}". If this new touch supersedes it, cancel first with cancel_pending_action ${dup.id} — otherwise let the pending send run.`,
				success: false,
				details: { blockedBy: "dedup", openActionId: dup.id },
			});
			// First check before the critic so a duplicate never costs a verifier turn.
			const dup = await findOpenNotify();
			if (dup) return dedupRefusal(dup);
			// Critic gate — verify the send follows from its justification before scheduling.
			const refused = await verifyGate(
				"notify-then-act",
				params,
				`Send to ${customerName}: ${(params.text as string).slice(0, 100)}`,
				params.reason as string,
			);
			if (refused) return refused;
			// Re-check AFTER the critic: the verify turn takes seconds, and a
			// concurrent agent turn for the same customer (parallel sweep subjects)
			// may have recorded a send in that window. The re-check → record path
			// has no further awaits between them, so it cannot interleave.
			const lateDup = await findOpenNotify();
			if (lateDup) return dedupRefusal(lateDup);
			const rawPause = params.pause_minutes as number | undefined;
			const pauseMin = Math.min(
				1440,
				Math.max(
					1,
					Number.isFinite(rawPause) && (rawPause as number) > 0
						? (rawPause as number)
						: defaultPauseMinutes,
				),
			);
			const created = now();
			const executeAt = new Date(created.getTime() + pauseMin * 60_000);

			const entry = await ctx.ledger.record({
				band: "notify-then-act",
				customerId: params.customer_id as string,
				customerName,
				summary: `Send to ${customerName}: ${(params.text as string).slice(0, 100)}`,
				reason: params.reason as string,
				status: "in-flight",
				createdAt: created,
				executeAt,
				payload: {
					recipient: params.recipient,
					text: params.text,
					channel: (params.channel as string) === "call" ? "call" : "message",
				},
				...situationLink(params),
			});

			// Heads-up to the CSM — they have `pauseMin` minutes to cancel.
			const headsUp = [
				`📤 About to send to ${customerName} in ${pauseMin}m`,
				"",
				`Why: ${entry.reason}`,
				`To: ${params.recipient}`,
				"",
				`> ${(params.text as string).slice(0, 240)}`,
				"",
				`Cancel with: cancel_pending_action ${entry.id}`,
			].join("\n");
			try {
				await ctx.sendToCsm(csmRecipient(params.csm_recipient_id as string | undefined), headsUp);
			} catch (err) {
				await ctx.ledger.update(entry.id, {
					status: "failed",
					note: `Heads-up to CSM failed: ${(err as Error).message}`,
				});
				throw err;
			}

			return {
				content: `Notify-then-act queued (#${entry.id.slice(0, 8)}). Will send to ${customerName} at ${executeAt.toISOString()} unless cancelled.`,
				success: true,
				details: { actionId: entry.id, executeAt: executeAt.toISOString(), pauseMinutes: pauseMin },
			};
		},
	};

	const escalate: ToolDefinition = {
		name: "escalate",
		description:
			"Escalate band: brief the CSM with situation + options + your recommendation. Use this for high-stakes or genuinely ambiguous decisions: churn intervention, discount/commercial concession, contract change, complaint, upsell pitch, stakeholder change. DOES NOT send anything to the customer. The CSM owns the decision; you've done the homework.",
		parameters: {
			type: "object",
			properties: {
				customer_id: { type: "string", description: "Customer (CSP business id)" },
				customer_name: { type: "string", description: "Customer name" },
				situation: { type: "string", description: "What's going on, in one paragraph" },
				options: {
					type: "string",
					description: "Numbered list of options the CSM could take",
				},
				recommendation: {
					type: "string",
					description: "Which option you'd pick and why",
				},
				urgency: {
					type: "string",
					description: "Why this needs attention now (deadline, signal)",
				},
				csm_recipient_id: {
					type: "string",
					description: "Override the CSM channel recipient",
				},
				...SITUATION_LINK_PROPS,
			},
			required: ["customer_id", "situation", "options", "recommendation"],
		},
		async execute(params) {
			const customerName = (params.customer_name as string) ?? (params.customer_id as string);
			// Critic gate — verify the escalation is warranted before briefing the CSM.
			const refused = await verifyGate(
				"escalate",
				params,
				`Escalation: ${customerName} — needs CSM decision`,
				params.situation as string,
			);
			if (refused) return refused;
			const brief = [
				`⚠️ Escalation: ${customerName}`,
				"",
				`Situation: ${params.situation}`,
				"",
				`Options:\n${params.options}`,
				"",
				`Recommendation: ${params.recommendation}`,
				params.urgency ? `\nUrgency: ${params.urgency}` : "",
			]
				.filter(Boolean)
				.join("\n");

			const entry = await ctx.ledger.record({
				band: "escalate",
				customerId: params.customer_id as string,
				customerName,
				summary: `Escalation: ${customerName} — needs CSM decision`,
				reason: params.situation as string,
				status: "needs-csm",
				createdAt: now(),
				payload: {
					situation: params.situation,
					options: params.options,
					recommendation: params.recommendation,
					urgency: params.urgency,
				},
				...situationLink(params),
			});

			try {
				await ctx.sendToCsm(csmRecipient(params.csm_recipient_id as string | undefined), brief);
			} catch (err) {
				await ctx.ledger.update(entry.id, {
					status: "failed",
					note: `Brief to CSM failed: ${(err as Error).message}`,
				});
				throw err;
			}

			return {
				content: `Escalation briefed (#${entry.id.slice(0, 8)}). CSM owns the decision.`,
				success: true,
				details: { actionId: entry.id },
			};
		},
	};

	const prep: ToolDefinition = {
		name: "prep",
		description:
			"Prep band: ship a finished v1 the CSM will use to drive a CSM-owned conversation. Examples: pre-call brief 30 min before, renewal brief 30 days out, QBR deck v1, weekly portfolio status, handoff brief. The artifact is delivered to the CSM directly and recorded in the ledger.",
		parameters: {
			type: "object",
			properties: {
				customer_id: {
					type: "string",
					description: "Customer (CSP business id), or 'portfolio' for cross-customer briefs",
				},
				customer_name: { type: "string", description: "Customer name (or 'Portfolio')" },
				artifact_type: {
					type: "string",
					description:
						"What you prepared (pre-call brief, renewal brief, QBR deck, weekly status, handoff brief)",
				},
				body: { type: "string", description: "The finished artifact, formatted for the channel" },
				csm_recipient_id: {
					type: "string",
					description: "Override the CSM channel recipient",
				},
				...SITUATION_LINK_PROPS,
			},
			required: ["customer_id", "artifact_type", "body"],
		},
		async execute(params) {
			// No override gate: prep produces a CSM-facing artifact (a brief/deck the
			// CSM uses), not a customer touch or an autonomous account action — an
			// "escalate/notify everything" override is about reaching the customer,
			// and prepping material for the CSM only helps them own that decision.
			const customerName = (params.customer_name as string) ?? (params.customer_id as string);
			const ts = now();
			const entry = await ctx.ledger.record({
				band: "prep",
				customerId: params.customer_id as string,
				customerName,
				summary: `${params.artifact_type} ready: ${customerName}`,
				reason: `Prep artifact: ${params.artifact_type}`,
				status: "done",
				createdAt: ts,
				executedAt: ts,
				payload: {
					artifactType: params.artifact_type,
					body: params.body,
				},
				...situationLink(params),
			});

			try {
				await ctx.sendToCsm(
					csmRecipient(params.csm_recipient_id as string | undefined),
					`📋 ${params.artifact_type} — ${customerName}\n\n${params.body}`,
				);
			} catch (err) {
				await ctx.ledger.update(entry.id, {
					status: "failed",
					note: `Delivery to CSM failed: ${(err as Error).message}`,
				});
				throw err;
			}

			return {
				content: `Prep delivered (#${entry.id.slice(0, 8)}): ${params.artifact_type} for ${customerName}.`,
				success: true,
				details: { actionId: entry.id },
			};
		},
	};

	const cancel: ToolDefinition = {
		name: "cancel_pending_action",
		description:
			"Cancel a notify-then-act or escalate entry before it dispatches. Use when new evidence changes the call (CSM said don't, customer self-served, situation resolved). Acts and prep cannot be cancelled — they already happened.",
		parameters: {
			type: "object",
			properties: {
				action_id: { type: "string", description: "Ledger entry id to cancel" },
				reason: { type: "string", description: "Why this is being cancelled" },
			},
			required: ["action_id", "reason"],
		},
		async execute(params) {
			const id = params.action_id as string;
			const existing = await ctx.ledger.get(id);
			if (!existing) {
				return { content: `No action found with id ${id}.`, success: false };
			}
			if (existing.band !== "notify-then-act" && existing.band !== "escalate") {
				return {
					content: `Cannot cancel ${BAND_LABEL[existing.band]} actions — they already happened.`,
					success: false,
				};
			}
			if (existing.status !== "in-flight" && existing.status !== "needs-csm") {
				return {
					content: `Action #${id.slice(0, 8)} is already ${existing.status} — cannot cancel.`,
					success: false,
				};
			}
			const updated = await ctx.ledger.update(id, {
				status: "cancelled",
				note: params.reason as string,
				executedAt: now(),
			});
			return {
				content: `Cancelled action #${id.slice(0, 8)}: ${updated?.summary}`,
				success: true,
				details: { actionId: id },
			};
		},
	};

	const resolve: ToolDefinition = {
		name: "resolve_escalation",
		description:
			"Mark an escalation as resolved after the CSM has decided. Records what they chose so the digest moves it out of 'needs-csm' into 'handled today'.",
		parameters: {
			type: "object",
			properties: {
				action_id: { type: "string", description: "Ledger entry id to resolve" },
				outcome: { type: "string", description: "What the CSM decided" },
			},
			required: ["action_id", "outcome"],
		},
		async execute(params) {
			const id = params.action_id as string;
			const existing = await ctx.ledger.get(id);
			if (!existing) {
				return { content: `No action found with id ${id}.`, success: false };
			}
			if (existing.band !== "escalate") {
				return { content: `Action ${id} is not an escalation.`, success: false };
			}
			if (existing.status !== "needs-csm") {
				return {
					content: `Escalation #${id.slice(0, 8)} is already ${existing.status}.`,
					success: false,
				};
			}
			const updated = await ctx.ledger.update(id, {
				status: "resolved",
				note: params.outcome as string,
				executedAt: now(),
			});
			return {
				content: `Escalation resolved (#${id.slice(0, 8)}): ${updated?.note}`,
				success: true,
			};
		},
	};

	return [act, notify, escalate, prep, cancel, resolve];
}

export type { ActionLedgerEntry };
