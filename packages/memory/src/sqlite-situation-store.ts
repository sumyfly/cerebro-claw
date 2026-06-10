import { randomUUID } from "node:crypto";
import {
	type Situation,
	type SituationKind,
	type SituationOpenInput,
	type SituationPatch,
	type SituationStatus,
	type SituationStore,
	resolveNextCheckpoint,
} from "@cerebro-claw/shared";
import Database from "better-sqlite3";

interface Row {
	id: string;
	business_id: string;
	customer_name: string | null;
	kind: string;
	renewal_id: string | null;
	title: string;
	status: string;
	opened_at: string;
	updated_at: string;
	next_checkpoint: string | null;
	waiting_for: string | null;
	needs_attention: number;
	note: string | null;
}

export class SqliteSituationStore implements SituationStore {
	private db: Database.Database;
	private ownsConnection: boolean;

	constructor(dbOrPath: string | Database.Database) {
		if (typeof dbOrPath === "string") {
			this.db = new Database(dbOrPath);
			this.db.pragma("journal_mode = WAL");
			this.ownsConnection = true;
		} else {
			this.db = dbOrPath;
			this.ownsConnection = false;
		}
		this.migrate();
	}

	private migrate(): void {
		this.db.exec(`
			CREATE TABLE IF NOT EXISTS situations (
				id TEXT PRIMARY KEY,
				business_id TEXT NOT NULL,
				customer_name TEXT,
				kind TEXT NOT NULL,
				renewal_id TEXT,
				title TEXT NOT NULL,
				status TEXT NOT NULL,
				opened_at TEXT NOT NULL,
				updated_at TEXT NOT NULL,
				next_checkpoint TEXT,
				waiting_for TEXT,
				needs_attention INTEGER NOT NULL DEFAULT 0,
				note TEXT
			);
			CREATE INDEX IF NOT EXISTS idx_situations_business ON situations(business_id);
			CREATE INDEX IF NOT EXISTS idx_situations_status ON situations(status);
			-- Identity invariant: at most one non-resolved situation per (businessId, kind, renewalId).
			CREATE UNIQUE INDEX IF NOT EXISTS idx_situations_identity
				ON situations(business_id, kind, ifnull(renewal_id, ''))
				WHERE status != 'resolved';
		`);
	}

	async open(input: SituationOpenInput): Promise<Situation> {
		const existing = await this.findOpen(input.businessId, input.kind, input.renewalId);
		if (existing) return existing;

		const now = new Date();
		const status: SituationStatus = input.status ?? "open";
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
		this.db
			.prepare(
				`INSERT INTO situations
				(id, business_id, customer_name, kind, renewal_id, title, status, opened_at, updated_at, next_checkpoint, waiting_for, needs_attention, note)
				VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
			)
			.run(
				situation.id,
				situation.businessId,
				situation.customerName ?? null,
				situation.kind,
				situation.renewalId ?? null,
				situation.title,
				situation.status,
				situation.openedAt.toISOString(),
				situation.updatedAt.toISOString(),
				situation.nextCheckpoint?.toISOString() ?? null,
				situation.waitingFor ?? null,
				situation.needsAttention ? 1 : 0,
				situation.note ?? null,
			);
		return situation;
	}

	async get(id: string): Promise<Situation | null> {
		const row = this.db.prepare("SELECT * FROM situations WHERE id = ?").get(id) as Row | undefined;
		return row ? this.toSituation(row) : null;
	}

	async findOpen(
		businessId: string,
		kind: SituationKind,
		renewalId?: string,
	): Promise<Situation | null> {
		const row =
			kind === "renewal-risk"
				? (this.db
						.prepare(
							`SELECT * FROM situations
							WHERE business_id = ? AND kind = ? AND ifnull(renewal_id, '') = ? AND status != 'resolved'
							LIMIT 1`,
						)
						.get(businessId, kind, renewalId ?? "") as Row | undefined)
				: (this.db
						.prepare(
							"SELECT * FROM situations WHERE business_id = ? AND kind = ? AND status != 'resolved' LIMIT 1",
						)
						.get(businessId, kind) as Row | undefined);
		return row ? this.toSituation(row) : null;
	}

	async listOpen(businessId: string): Promise<Situation[]> {
		const rows = this.db
			.prepare(
				"SELECT * FROM situations WHERE business_id = ? AND status != 'resolved' ORDER BY opened_at",
			)
			.all(businessId) as Row[];
		return rows.map((r) => this.toSituation(r));
	}

	async listNeedingCsm(): Promise<Situation[]> {
		const rows = this.db
			.prepare(
				`SELECT * FROM situations
				WHERE status != 'resolved' AND (status = 'escalated' OR needs_attention = 1)
				ORDER BY opened_at`,
			)
			.all() as Row[];
		return rows.map((r) => this.toSituation(r));
	}

	async listWatching(): Promise<Situation[]> {
		const rows = this.db
			.prepare("SELECT * FROM situations WHERE status = 'watching' ORDER BY opened_at")
			.all() as Row[];
		return rows.map((r) => this.toSituation(r));
	}

	async update(id: string, patch: SituationPatch): Promise<Situation | null> {
		const existing = await this.get(id);
		if (!existing) return null;
		const now = new Date();
		const merged: Situation = { ...existing, ...patch, updatedAt: now };
		if (merged.status === "watching" || patch.nextCheckpoint) {
			merged.nextCheckpoint = resolveNextCheckpoint(
				patch.nextCheckpoint ?? existing.nextCheckpoint,
				now,
			);
		}
		this.write(merged);
		return merged;
	}

	async resolve(id: string, note?: string): Promise<Situation | null> {
		const existing = await this.get(id);
		if (!existing) return null;
		const merged: Situation = {
			...existing,
			status: "resolved",
			note: note ?? existing.note,
			needsAttention: false,
			updatedAt: new Date(),
		};
		this.write(merged);
		return merged;
	}

	close(): void {
		if (this.ownsConnection) this.db.close();
	}

	private write(s: Situation): void {
		this.db
			.prepare(
				`UPDATE situations
				SET customer_name = ?, title = ?, status = ?, updated_at = ?, next_checkpoint = ?, waiting_for = ?, needs_attention = ?, note = ?
				WHERE id = ?`,
			)
			.run(
				s.customerName ?? null,
				s.title,
				s.status,
				s.updatedAt.toISOString(),
				s.nextCheckpoint?.toISOString() ?? null,
				s.waitingFor ?? null,
				s.needsAttention ? 1 : 0,
				s.note ?? null,
				s.id,
			);
	}

	private toSituation(row: Row): Situation {
		return {
			id: row.id,
			businessId: row.business_id,
			customerName: row.customer_name ?? undefined,
			kind: row.kind as SituationKind,
			renewalId: row.renewal_id ?? undefined,
			title: row.title,
			status: row.status as SituationStatus,
			openedAt: new Date(row.opened_at),
			updatedAt: new Date(row.updated_at),
			nextCheckpoint: row.next_checkpoint ? new Date(row.next_checkpoint) : undefined,
			waitingFor: row.waiting_for ?? undefined,
			needsAttention: row.needs_attention === 1,
			note: row.note ?? undefined,
		};
	}
}
