import { randomUUID } from "node:crypto";
import {
	type Situation,
	type SituationKind,
	type SituationOpenInput,
	type SituationPatch,
	type SituationStore,
	resolveNextCheckpoint,
	situationNeedsCsm,
} from "@cerebro-claw/shared";

/** Identity match per decision D2: renewal-risk is scoped by renewalId; other kinds are not. */
function identityMatches(
	s: Situation,
	businessId: string,
	kind: SituationKind,
	renewalId?: string,
): boolean {
	if (s.businessId !== businessId || s.kind !== kind) return false;
	if (kind === "renewal-risk") return (s.renewalId ?? undefined) === (renewalId ?? undefined);
	return true;
}

export class InMemorySituationStore implements SituationStore {
	private situations = new Map<string, Situation>();

	async open(input: SituationOpenInput): Promise<Situation> {
		const existing = await this.findOpen(input.businessId, input.kind, input.renewalId);
		if (existing) return existing;

		const now = new Date();
		const status = input.status ?? "open";
		let nextCheckpoint = input.nextCheckpoint;
		if (status === "watching" || nextCheckpoint) {
			nextCheckpoint = resolveNextCheckpoint(nextCheckpoint, now);
		}
		const situation: Situation = {
			id: randomUUID(),
			businessId: input.businessId,
			customerName: input.customerName,
			kind: input.kind,
			renewalId: input.renewalId,
			title: input.title,
			status,
			openedAt: now,
			updatedAt: now,
			nextCheckpoint,
			waitingFor: input.waitingFor,
			needsAttention: input.needsAttention ?? false,
		};
		this.situations.set(situation.id, situation);
		return situation;
	}

	async get(id: string): Promise<Situation | null> {
		return this.situations.get(id) ?? null;
	}

	async findOpen(
		businessId: string,
		kind: SituationKind,
		renewalId?: string,
	): Promise<Situation | null> {
		for (const s of this.situations.values()) {
			if (s.status !== "resolved" && identityMatches(s, businessId, kind, renewalId)) return s;
		}
		return null;
	}

	async listOpen(businessId: string): Promise<Situation[]> {
		return Array.from(this.situations.values()).filter(
			(s) => s.businessId === businessId && s.status !== "resolved",
		);
	}

	async listNeedingCsm(): Promise<Situation[]> {
		return Array.from(this.situations.values()).filter(
			(s) => s.status !== "resolved" && situationNeedsCsm(s),
		);
	}

	async listWatching(): Promise<Situation[]> {
		return Array.from(this.situations.values()).filter((s) => s.status === "watching");
	}

	async update(id: string, patch: SituationPatch): Promise<Situation | null> {
		const existing = this.situations.get(id);
		if (!existing) return null;
		const now = new Date();
		const merged: Situation = { ...existing, ...patch, updatedAt: now };
		if (merged.status === "watching" || patch.nextCheckpoint) {
			merged.nextCheckpoint = resolveNextCheckpoint(
				patch.nextCheckpoint ?? existing.nextCheckpoint,
				now,
			);
		}
		this.situations.set(id, merged);
		return merged;
	}

	async resolve(id: string, note?: string): Promise<Situation | null> {
		const existing = this.situations.get(id);
		if (!existing) return null;
		const merged: Situation = {
			...existing,
			status: "resolved",
			note: note ?? existing.note,
			needsAttention: false,
			updatedAt: new Date(),
		};
		this.situations.set(id, merged);
		return merged;
	}
}
