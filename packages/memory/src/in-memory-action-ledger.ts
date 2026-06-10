import { randomUUID } from "node:crypto";
import type { ActionLedger, ActionLedgerEntry } from "@cerebro-claw/shared";

/**
 * In-memory ledger — used in tests and the local demo path. Mirrors the SQLite
 * implementation's behavior including the UNIQUE idempotency_key constraint
 * (we enforce it by scanning), so harness tests that exercise dispatcher dedup
 * pass identically against both backends.
 */
export class InMemoryActionLedger implements ActionLedger {
	private entries = new Map<string, ActionLedgerEntry>();

	async record(
		input: Omit<ActionLedgerEntry, "id" | "createdAt"> & {
			id?: string;
			createdAt?: Date;
		},
	): Promise<ActionLedgerEntry> {
		// Emulate the UNIQUE INDEX on idempotency_key — the SQLite path would
		// throw a constraint violation here too. Same semantics for tests.
		if (input.idempotencyKey) {
			for (const existing of this.entries.values()) {
				if (existing.idempotencyKey === input.idempotencyKey) {
					throw new Error(
						`UNIQUE constraint failed: action_ledger.idempotency_key (${input.idempotencyKey})`,
					);
				}
			}
		}
		const entry: ActionLedgerEntry = {
			id: input.id ?? randomUUID(),
			band: input.band,
			customerId: input.customerId,
			customerName: input.customerName,
			summary: input.summary,
			reason: input.reason,
			status: input.status,
			createdAt: input.createdAt ?? new Date(),
			executeAt: input.executeAt,
			executedAt: input.executedAt,
			payload: input.payload,
			note: input.note,
			situationId: input.situationId,
			renewalId: input.renewalId,
			turnId: input.turnId,
			taskId: input.taskId,
			toolName: input.toolName,
			blastRadius: input.blastRadius,
			idempotencyKey: input.idempotencyKey,
			claimedAt: input.claimedAt,
			claimedBy: input.claimedBy,
			attemptCount: input.attemptCount,
			resolution: input.resolution,
			resolvedAt: input.resolvedAt,
			resolvedBy: input.resolvedBy,
			parentId: input.parentId,
			capabilityId: input.capabilityId,
		};
		this.entries.set(entry.id, entry);
		return entry;
	}

	async update(
		id: string,
		patch: Partial<
			Pick<
				ActionLedgerEntry,
				| "status"
				| "executeAt"
				| "executedAt"
				| "note"
				| "payload"
				| "claimedAt"
				| "claimedBy"
				| "attemptCount"
				| "resolution"
				| "resolvedAt"
				| "resolvedBy"
			>
		>,
	): Promise<ActionLedgerEntry | null> {
		const existing = this.entries.get(id);
		if (!existing) return null;
		const merged: ActionLedgerEntry = { ...existing, ...patch };
		this.entries.set(id, merged);
		return merged;
	}

	async get(id: string): Promise<ActionLedgerEntry | null> {
		return this.entries.get(id) ?? null;
	}

	async listByWindow(since: Date, until: Date): Promise<ActionLedgerEntry[]> {
		return Array.from(this.entries.values())
			.filter((e) => e.createdAt >= since && e.createdAt < until)
			.sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
	}

	async listDue(now: Date): Promise<ActionLedgerEntry[]> {
		return Array.from(this.entries.values()).filter(
			(e) =>
				e.band === "notify-then-act" &&
				e.status === "in-flight" &&
				e.executeAt !== undefined &&
				e.executeAt <= now,
		);
	}

	async listOpen(): Promise<ActionLedgerEntry[]> {
		return Array.from(this.entries.values()).filter(
			(e) => e.status === "in-flight" || e.status === "claimed" || e.status === "needs-csm",
		);
	}

	async listBySituation(situationId: string): Promise<ActionLedgerEntry[]> {
		return Array.from(this.entries.values())
			.filter((e) => e.situationId === situationId)
			.sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
	}

	async listRecentByCustomer(customerId: string, limit: number): Promise<ActionLedgerEntry[]> {
		return Array.from(this.entries.values())
			.filter((e) => e.customerId === customerId)
			.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
			.slice(0, Math.max(0, limit));
	}

	async claimForDispatch(
		id: string,
		now: Date,
		workerId: string,
	): Promise<ActionLedgerEntry | null> {
		const existing = this.entries.get(id);
		if (!existing) return null;
		if (
			existing.band !== "notify-then-act" ||
			existing.status !== "in-flight" ||
			!existing.executeAt ||
			existing.executeAt > now
		) {
			return null;
		}
		const claimed: ActionLedgerEntry = {
			...existing,
			status: "claimed",
			claimedAt: now,
			claimedBy: workerId,
			attemptCount: (existing.attemptCount ?? 0) + 1,
		};
		this.entries.set(id, claimed);
		return claimed;
	}

	async hasOpenWork(customerId: string, taskId?: string): Promise<boolean> {
		for (const e of this.entries.values()) {
			if (e.customerId !== customerId) continue;
			if (taskId && e.taskId !== taskId) continue;
			if (e.status === "in-flight" || e.status === "claimed" || e.status === "needs-csm") {
				return true;
			}
		}
		return false;
	}
}
