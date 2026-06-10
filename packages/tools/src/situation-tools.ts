import type {
	SituationKind,
	SituationStatus,
	SituationStore,
	ToolDefinition,
} from "@cerebro-claw/shared";

/**
 * Situation tools — let the agent maintain persistent storylines.
 *
 * A Situation is how the agent remembers across cycles: instead of re-logging
 * "renewal risk, on watch" every cycle (an `act` that re-discovers the same
 * thing), the agent opens ONE Situation and advances it. "Just watching" is a
 * Situation, not an `act` — keeping the act count honest.
 */
export interface SituationToolsContext {
	store: SituationStore;
	now?: () => Date;
}

const KINDS: SituationKind[] = [
	"renewal-risk",
	"adoption-gap",
	"support-escalation",
	"relationship-change",
	"billing-issue",
	"other",
];

/** Statuses the agent may set (it cannot directly set `resolved` — use situation_resolve). */
const SETTABLE: SituationStatus[] = ["open", "watching", "escalated"];

export function createSituationTools(ctx: SituationToolsContext): ToolDefinition[] {
	const now = () => ctx.now?.() ?? new Date();
	const checkpointFrom = (hours?: number): Date | undefined =>
		hours != null ? new Date(now().getTime() + hours * 3_600_000) : undefined;

	const open: ToolDefinition = {
		name: "situation_open",
		kind: "act",
		blastRadius: "internal",
		description:
			"Open (or fetch the existing) Situation — a persistent storyline for an account or renewal. Use this INSTEAD of logging an `act` when you are noticing-and-watching with no work performed. Idempotent: returns the existing open Situation for the same account/kind (and renewalId for renewal-risk) rather than creating a duplicate, so you never re-discover the same risk. Set status to 'watching' and a checkpoint when you want to revisit later.",
		parameters: {
			type: "object",
			properties: {
				business_id: { type: "string", description: "Account this concerns (CSP business id)" },
				customer_name: { type: "string", description: "Account name for digest/UI lines" },
				kind: { type: "string", enum: KINDS, description: "Situation kind" },
				renewal_id: {
					type: "string",
					description:
						"Renewal UUID — REQUIRED for kind 'renewal-risk' so two renewals on one account stay separate threads",
				},
				title: { type: "string", description: "One-line storyline title" },
				status: { type: "string", enum: SETTABLE, description: "Initial status (default 'open')" },
				waiting_for: {
					type: "string",
					description: "What you're waiting on before this can advance",
				},
				checkpoint_hours: {
					type: "number",
					description:
						"Revisit after this many hours (clamped 1h–30d; defaults to 72h when status is 'watching')",
				},
				needs_attention: {
					type: "boolean",
					description: "Flag for the CSM to look even though not yet escalated",
				},
			},
			required: ["business_id", "kind", "title"],
		},
		async execute(params) {
			const s = await ctx.store.open({
				businessId: params.business_id as string,
				customerName: (params.customer_name as string) ?? undefined,
				kind: params.kind as SituationKind,
				renewalId: (params.renewal_id as string) ?? undefined,
				title: params.title as string,
				status: (params.status as SituationStatus) ?? undefined,
				waitingFor: (params.waiting_for as string) ?? undefined,
				nextCheckpoint: checkpointFrom(params.checkpoint_hours as number | undefined),
				needsAttention: (params.needs_attention as boolean) ?? undefined,
			});
			return {
				content: `Situation #${s.id.slice(0, 8)} (${s.kind}, ${s.status}): ${s.title}`,
				success: true,
				details: { situationId: s.id, status: s.status, nextCheckpoint: s.nextCheckpoint },
			};
		},
	};

	const advance: ToolDefinition = {
		name: "situation_advance",
		kind: "act",
		blastRadius: "internal",
		description:
			"Advance an existing Situation: change status (open/watching/escalated), update what you're waiting on, set the next checkpoint, or flag it for the CSM. Use this each time the storyline moves.",
		parameters: {
			type: "object",
			properties: {
				situation_id: { type: "string", description: "Situation id to advance" },
				status: { type: "string", enum: SETTABLE, description: "New status" },
				title: { type: "string", description: "Updated title" },
				waiting_for: { type: "string", description: "What you're now waiting on" },
				checkpoint_hours: {
					type: "number",
					description: "Revisit after this many hours (clamped 1h–30d)",
				},
				needs_attention: { type: "boolean", description: "Flag/unflag for the CSM" },
			},
			required: ["situation_id"],
		},
		async execute(params) {
			const s = await ctx.store.update(params.situation_id as string, {
				status: (params.status as SituationStatus) ?? undefined,
				title: (params.title as string) ?? undefined,
				waitingFor: (params.waiting_for as string) ?? undefined,
				nextCheckpoint: checkpointFrom(params.checkpoint_hours as number | undefined),
				needsAttention: (params.needs_attention as boolean) ?? undefined,
			});
			if (!s) {
				return { content: `No situation ${params.situation_id}`, success: false };
			}
			return {
				content: `Situation #${s.id.slice(0, 8)} → ${s.status}${s.waitingFor ? ` (waiting: ${s.waitingFor})` : ""}`,
				success: true,
				details: { situationId: s.id, status: s.status, nextCheckpoint: s.nextCheckpoint },
			};
		},
	};

	const resolve: ToolDefinition = {
		name: "situation_resolve",
		kind: "act",
		blastRadius: "internal",
		description:
			"Resolve a Situation when the condition no longer holds (recovered / renewed / churned / decided). It drops out of the agent's working set so it is never re-surfaced.",
		parameters: {
			type: "object",
			properties: {
				situation_id: { type: "string", description: "Situation id to resolve" },
				note: { type: "string", description: "Closing note (what the outcome was)" },
			},
			required: ["situation_id"],
		},
		async execute(params) {
			const s = await ctx.store.resolve(
				params.situation_id as string,
				(params.note as string) ?? undefined,
			);
			if (!s) {
				return { content: `No situation ${params.situation_id}`, success: false };
			}
			return {
				content: `Situation #${s.id.slice(0, 8)} resolved.`,
				success: true,
				details: { situationId: s.id, status: s.status },
			};
		},
	};

	const list: ToolDefinition = {
		name: "situation_list",
		kind: "observe",
		blastRadius: "none",
		description:
			"List the open Situations for an account so you can see what is already in flight before acting. (The work loop also injects these into your context.)",
		parameters: {
			type: "object",
			properties: {
				business_id: { type: "string", description: "Account (CSP business id)" },
			},
			required: ["business_id"],
		},
		async execute(params) {
			const situations = await ctx.store.listOpen(params.business_id as string);
			return {
				content:
					situations.length === 0
						? "No open situations for this account."
						: situations
								.map(
									(s) =>
										`#${s.id.slice(0, 8)} ${s.kind}/${s.status}: ${s.title}${s.waitingFor ? ` — waiting: ${s.waitingFor}` : ""}`,
								)
								.join("\n"),
				success: true,
				details: {
					situations: situations.map((s) => ({
						id: s.id,
						kind: s.kind,
						status: s.status,
						title: s.title,
						renewalId: s.renewalId,
						nextCheckpoint: s.nextCheckpoint,
						waitingFor: s.waitingFor,
						needsAttention: s.needsAttention,
					})),
				},
			};
		},
	};

	return [open, advance, resolve, list];
}
