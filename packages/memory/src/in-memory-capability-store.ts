import { randomUUID } from "node:crypto";
import type { CapabilityGrant, CapabilityScope, CapabilityStore } from "@cerebro-claw/shared";

/**
 * In-memory capability store — used for tests and the local demo path.
 * Atomicity is trivial here because JS is single-threaded; the SQLite
 * implementation does the same logical work in one UPDATE.
 */
export class InMemoryCapabilityStore implements CapabilityStore {
	private grants = new Map<string, CapabilityGrant>();

	async grant(
		input: Omit<CapabilityGrant, "id" | "createdAt"> & {
			id?: string;
			createdAt?: Date;
		},
	): Promise<CapabilityGrant> {
		const g: CapabilityGrant = {
			id: input.id ?? randomUUID(),
			grants: input.grants,
			scope: input.scope,
			parentEscalationId: input.parentEscalationId,
			usesRemaining: input.usesRemaining,
			expiresAt: input.expiresAt,
			createdAt: input.createdAt ?? new Date(),
		};
		this.grants.set(g.id, g);
		return g;
	}

	async listActiveForScope(scope: CapabilityScope, now: Date): Promise<CapabilityGrant[]> {
		return Array.from(this.grants.values()).filter(
			(g) =>
				g.scope.accountId === scope.accountId &&
				g.usesRemaining > 0 &&
				!g.consumedAt &&
				g.expiresAt > now,
		);
	}

	async consume(grantId: string, turnId: string, now: Date): Promise<CapabilityGrant | null> {
		const g = this.grants.get(grantId);
		if (!g) return null;
		if (g.usesRemaining <= 0 || g.consumedAt || g.expiresAt <= now) return null;
		const remaining = g.usesRemaining - 1;
		const updated: CapabilityGrant = {
			...g,
			usesRemaining: remaining,
			consumedAt: remaining === 0 ? now : g.consumedAt,
			consumedByTurnId: remaining === 0 ? turnId : g.consumedByTurnId,
		};
		this.grants.set(grantId, updated);
		return updated;
	}

	async get(id: string): Promise<CapabilityGrant | null> {
		return this.grants.get(id) ?? null;
	}
}
