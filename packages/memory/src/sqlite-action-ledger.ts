import { randomUUID } from "node:crypto";
import type {
	ActionBand,
	ActionLedger,
	ActionLedgerEntry,
	ActionStatus,
} from "@cerebro-claw/shared";
import Database from "better-sqlite3";

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
	situation_id: string | null;
	renewal_id: string | null;
	turn_id: string | null;
	task_id: string | null;
	tool_name: string | null;
	blast_radius: string | null;
	idempotency_key: string | null;
	claimed_at: string | null;
	claimed_by: string | null;
	attempt_count: number | null;
	resolution: string | null;
	resolved_at: string | null;
	resolved_by: string | null;
	parent_id: string | null;
	capability_id: string | null;
}

/**
 * SQLite-backed ledger.
 *
 *  - Append-only with status updates (never delete).
 *  - The notify dispatcher path uses an atomic CAS (`claimForDispatch`) plus a
 *    UNIQUE constraint on `idempotency_key` so the same send can't fire twice
 *    even under multiple dispatchers / restarts.
 *  - Schema evolution is additive: new columns are ALTER-added inside a try/catch
 *    so old DBs upgrade in place without a migration framework. Order matters —
 *    columns are added in declaration order so a half-applied upgrade is
 *    consistent.
 */
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
				note TEXT,
				situation_id TEXT,
				renewal_id TEXT
			);
			CREATE INDEX IF NOT EXISTS idx_ledger_created ON action_ledger(created_at);
			CREATE INDEX IF NOT EXISTS idx_ledger_status ON action_ledger(status);
			CREATE INDEX IF NOT EXISTS idx_ledger_execute_at ON action_ledger(execute_at);
		`);
		// Additive columns for pre-existing databases (idempotent).
		const additive = [
			"situation_id TEXT",
			"renewal_id TEXT",
			"turn_id TEXT",
			"task_id TEXT",
			"tool_name TEXT",
			"blast_radius TEXT",
			"idempotency_key TEXT",
			"claimed_at TEXT",
			"claimed_by TEXT",
			"attempt_count INTEGER",
			"resolution TEXT",
			"resolved_at TEXT",
			"resolved_by TEXT",
			"parent_id TEXT",
			"capability_id TEXT",
		];
		for (const col of additive) {
			try {
				this.db.exec(`ALTER TABLE action_ledger ADD COLUMN ${col}`);
			} catch {
				// Column already exists — ignore.
			}
		}
		this.db.exec("CREATE INDEX IF NOT EXISTS idx_ledger_situation ON action_ledger(situation_id)");
		this.db.exec(
			"CREATE INDEX IF NOT EXISTS idx_ledger_customer_created ON action_ledger(customer_id, created_at)",
		);
		// Dispatcher queue + dedup indexes (v2). UNIQUE on idempotency_key is what
		// makes parallel-turn dedup structural rather than advisory — two turns
		// proposing the same send collide at the DB layer, regardless of order.
		this.db.exec(
			"CREATE UNIQUE INDEX IF NOT EXISTS idx_ledger_idempotency ON action_ledger(idempotency_key) WHERE idempotency_key IS NOT NULL",
		);
		this.db.exec("CREATE INDEX IF NOT EXISTS idx_ledger_turn ON action_ledger(turn_id)");
		this.db.exec("CREATE INDEX IF NOT EXISTS idx_ledger_task ON action_ledger(task_id)");
		// Dedup index used by hasOpenWork — `WHERE status IN (...)` keeps the index small.
		this.db.exec(
			"CREATE INDEX IF NOT EXISTS idx_ledger_dedup ON action_ledger(customer_id, task_id, status)",
		);
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
		this.db
			.prepare(
				`INSERT INTO action_ledger
				(id, band, customer_id, customer_name, summary, reason, status, created_at,
				 execute_at, executed_at, payload, note, situation_id, renewal_id,
				 turn_id, task_id, tool_name, blast_radius, idempotency_key,
				 claimed_at, claimed_by, attempt_count,
				 resolution, resolved_at, resolved_by, parent_id, capability_id)
				VALUES (?, ?, ?, ?, ?, ?, ?, ?,
				        ?, ?, ?, ?, ?, ?,
				        ?, ?, ?, ?, ?,
				        ?, ?, ?,
				        ?, ?, ?, ?, ?)`,
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
				entry.situationId ?? null,
				entry.renewalId ?? null,
				entry.turnId ?? null,
				entry.taskId ?? null,
				entry.toolName ?? null,
				entry.blastRadius ?? null,
				entry.idempotencyKey ?? null,
				entry.claimedAt?.toISOString() ?? null,
				entry.claimedBy ?? null,
				entry.attemptCount ?? null,
				entry.resolution ?? null,
				entry.resolvedAt?.toISOString() ?? null,
				entry.resolvedBy ?? null,
				entry.parentId ?? null,
				entry.capabilityId ?? null,
			);
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
		const existing = await this.get(id);
		if (!existing) return null;
		const merged: ActionLedgerEntry = { ...existing, ...patch };
		this.db
			.prepare(
				`UPDATE action_ledger
				SET status = ?, execute_at = ?, executed_at = ?, note = ?, payload = ?,
				    claimed_at = ?, claimed_by = ?, attempt_count = ?,
				    resolution = ?, resolved_at = ?, resolved_by = ?
				WHERE id = ?`,
			)
			.run(
				merged.status,
				merged.executeAt?.toISOString() ?? null,
				merged.executedAt?.toISOString() ?? null,
				merged.note ?? null,
				merged.payload ? JSON.stringify(merged.payload) : null,
				merged.claimedAt?.toISOString() ?? null,
				merged.claimedBy ?? null,
				merged.attemptCount ?? null,
				merged.resolution ?? null,
				merged.resolvedAt?.toISOString() ?? null,
				merged.resolvedBy ?? null,
				id,
			);
		return merged;
	}

	async get(id: string): Promise<ActionLedgerEntry | null> {
		const row = this.db.prepare("SELECT * FROM action_ledger WHERE id = ?").get(id) as
			| Row
			| undefined;
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
				"SELECT * FROM action_ledger WHERE status IN ('in-flight', 'claimed', 'needs-csm') ORDER BY created_at",
			)
			.all() as Row[];
		return rows.map((r) => this.toEntry(r));
	}

	async listBySituation(situationId: string): Promise<ActionLedgerEntry[]> {
		const rows = this.db
			.prepare("SELECT * FROM action_ledger WHERE situation_id = ? ORDER BY created_at")
			.all(situationId) as Row[];
		return rows.map((r) => this.toEntry(r));
	}

	async listRecentByCustomer(customerId: string, limit: number): Promise<ActionLedgerEntry[]> {
		const rows = this.db
			.prepare("SELECT * FROM action_ledger WHERE customer_id = ? ORDER BY created_at DESC LIMIT ?")
			.all(customerId, Math.max(0, Math.floor(limit))) as Row[];
		return rows.map((r) => this.toEntry(r));
	}

	/**
	 * Atomic CAS claim for the dispatcher. The UPDATE only writes if the row is
	 * still in-flight at the time of the call — two workers cannot both win the
	 * same row. attempt_count is incremented in the same statement so retries
	 * are recorded even when the subsequent send throws and is rolled back to
	 * `in-flight`.
	 */
	async claimForDispatch(
		id: string,
		now: Date,
		workerId: string,
	): Promise<ActionLedgerEntry | null> {
		const info = this.db
			.prepare(
				`UPDATE action_ledger
				 SET status = 'claimed',
				     claimed_at = ?,
				     claimed_by = ?,
				     attempt_count = COALESCE(attempt_count, 0) + 1
				 WHERE id = ?
				   AND status = 'in-flight'
				   AND band = 'notify-then-act'
				   AND execute_at IS NOT NULL
				   AND execute_at <= ?`,
			)
			.run(now.toISOString(), workerId, id, now.toISOString());
		if (info.changes === 0) return null;
		return this.get(id);
	}

	async hasOpenWork(customerId: string, taskId?: string): Promise<boolean> {
		const row = taskId
			? (this.db
					.prepare(
						`SELECT 1 AS hit FROM action_ledger
						 WHERE customer_id = ? AND task_id = ?
						   AND status IN ('in-flight', 'claimed', 'needs-csm')
						 LIMIT 1`,
					)
					.get(customerId, taskId) as { hit?: number } | undefined)
			: (this.db
					.prepare(
						`SELECT 1 AS hit FROM action_ledger
						 WHERE customer_id = ?
						   AND status IN ('in-flight', 'claimed', 'needs-csm')
						 LIMIT 1`,
					)
					.get(customerId) as { hit?: number } | undefined);
		return !!row?.hit;
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
			situationId: row.situation_id ?? undefined,
			renewalId: row.renewal_id ?? undefined,
			turnId: row.turn_id ?? undefined,
			taskId: row.task_id ?? undefined,
			toolName: row.tool_name ?? undefined,
			blastRadius: row.blast_radius ?? undefined,
			idempotencyKey: row.idempotency_key ?? undefined,
			claimedAt: row.claimed_at ? new Date(row.claimed_at) : undefined,
			claimedBy: row.claimed_by ?? undefined,
			attemptCount: row.attempt_count ?? undefined,
			resolution: row.resolution ?? undefined,
			resolvedAt: row.resolved_at ? new Date(row.resolved_at) : undefined,
			resolvedBy: row.resolved_by ?? undefined,
			parentId: row.parent_id ?? undefined,
			capabilityId: row.capability_id ?? undefined,
		};
	}
}
