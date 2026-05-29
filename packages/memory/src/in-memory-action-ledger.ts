import { randomUUID } from "node:crypto";
import type { ActionLedger, ActionLedgerEntry } from "@cerebro-claw/shared";

export class InMemoryActionLedger implements ActionLedger {
	private entries = new Map<string, ActionLedgerEntry>();

	async record(
		input: Omit<ActionLedgerEntry, "id" | "createdAt"> & {
			id?: string;
			createdAt?: Date;
		},
	): Promise<ActionLedgerEntry> {
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
		};
		this.entries.set(entry.id, entry);
		return entry;
	}

	async update(
		id: string,
		patch: Partial<Pick<ActionLedgerEntry, "status" | "executedAt" | "note" | "payload">>,
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
			(e) => e.status === "in-flight" || e.status === "needs-csm",
		);
	}
}
