import { randomUUID } from "node:crypto";
import Database from "better-sqlite3";
import type {
	ActionBand,
	ActionLedger,
	ActionLedgerEntry,
	ActionStatus,
} from "@cerebro-claw/shared";

interface Row {
	id: string;
	band: string;
	customer_id: string;
	customer_name: string | null;
	summary: string;
	reason: string;
	status: string;
	created_at: string;
	execute_at: string | null;
	executed_at: string | null;
	payload: string | null;
	note: string | null;
}

export class SqliteActionLedger implements ActionLedger {
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
			CREATE TABLE IF NOT EXISTS action_ledger (
				id TEXT PRIMARY KEY,
				band TEXT NOT NULL,
				customer_id TEXT NOT NULL,
				customer_name TEXT,
				summary TEXT NOT NULL,
				reason TEXT NOT NULL,
				status TEXT NOT NULL,
				created_at TEXT NOT NULL,
				execute_at TEXT,
				executed_at TEXT,
				payload TEXT,
				note TEXT
			);
			CREATE INDEX IF NOT EXISTS idx_ledger_created ON action_ledger(created_at);
			CREATE INDEX IF NOT EXISTS idx_ledger_status ON action_ledger(status);
			CREATE INDEX IF NOT EXISTS idx_ledger_execute_at ON action_ledger(execute_at);
		`);
	}

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
		this.db
			.prepare(
				`INSERT INTO action_ledger
				(id, band, customer_id, customer_name, summary, reason, status, created_at, execute_at, executed_at, payload, note)
				VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
			)
			.run(
				entry.id,
				entry.band,
				entry.customerId,
				entry.customerName ?? null,
				entry.summary,
				entry.reason,
				entry.status,
				entry.createdAt.toISOString(),
				entry.executeAt?.toISOString() ?? null,
				entry.executedAt?.toISOString() ?? null,
				entry.payload ? JSON.stringify(entry.payload) : null,
				entry.note ?? null,
			);
		return entry;
	}

	async update(
		id: string,
		patch: Partial<Pick<ActionLedgerEntry, "status" | "executedAt" | "note" | "payload">>,
	): Promise<ActionLedgerEntry | null> {
		const existing = await this.get(id);
		if (!existing) return null;
		const merged: ActionLedgerEntry = { ...existing, ...patch };
		this.db
			.prepare(
				`UPDATE action_ledger
				SET status = ?, executed_at = ?, note = ?, payload = ?
				WHERE id = ?`,
			)
			.run(
				merged.status,
				merged.executedAt?.toISOString() ?? null,
				merged.note ?? null,
				merged.payload ? JSON.stringify(merged.payload) : null,
				id,
			);
		return merged;
	}

	async get(id: string): Promise<ActionLedgerEntry | null> {
		const row = this.db
			.prepare("SELECT * FROM action_ledger WHERE id = ?")
			.get(id) as Row | undefined;
		return row ? this.toEntry(row) : null;
	}

	async listByWindow(since: Date, until: Date): Promise<ActionLedgerEntry[]> {
		const rows = this.db
			.prepare(
				"SELECT * FROM action_ledger WHERE created_at >= ? AND created_at < ? ORDER BY created_at",
			)
			.all(since.toISOString(), until.toISOString()) as Row[];
		return rows.map((r) => this.toEntry(r));
	}

	async listDue(now: Date): Promise<ActionLedgerEntry[]> {
		const rows = this.db
			.prepare(
				`SELECT * FROM action_ledger
				WHERE band = 'notify-then-act' AND status = 'in-flight' AND execute_at IS NOT NULL AND execute_at <= ?
				ORDER BY execute_at`,
			)
			.all(now.toISOString()) as Row[];
		return rows.map((r) => this.toEntry(r));
	}

	async listOpen(): Promise<ActionLedgerEntry[]> {
		const rows = this.db
			.prepare(
				"SELECT * FROM action_ledger WHERE status IN ('in-flight', 'needs-csm') ORDER BY created_at",
			)
			.all() as Row[];
		return rows.map((r) => this.toEntry(r));
	}

	close(): void {
		if (this.ownsConnection) this.db.close();
	}

	private toEntry(row: Row): ActionLedgerEntry {
		return {
			id: row.id,
			band: row.band as ActionBand,
			customerId: row.customer_id,
			customerName: row.customer_name ?? undefined,
			summary: row.summary,
			reason: row.reason,
			status: row.status as ActionStatus,
			createdAt: new Date(row.created_at),
			executeAt: row.execute_at ? new Date(row.execute_at) : undefined,
			executedAt: row.executed_at ? new Date(row.executed_at) : undefined,
			payload: row.payload ? JSON.parse(row.payload) : undefined,
			note: row.note ?? undefined,
		};
	}
}
