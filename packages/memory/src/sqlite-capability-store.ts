import { randomUUID } from "node:crypto";
import type { CapabilityGrant, CapabilityScope, CapabilityStore } from "@cerebro-claw/shared";
import Database from "better-sqlite3";

interface Row {
	id: string;
	grants: string;
	account_id: string;
	parent_escalation_id: string;
	uses_remaining: number;
	expires_at: string;
	created_at: string;
	consumed_at: string | null;
	consumed_by_turn_id: string | null;
}

/**
 * SQLite-backed capability grants.
 *
 * Atomicity. The single UPDATE in `consume` is the whole story — only one
 * concurrent caller can decrement a row's uses_remaining; the other sees the
 * post-update state and returns null. There is no need for explicit
 * transactions because every consume is a one-statement CAS.
 *
 * Expiry. `expires_at` is a wall-clock cutoff; nothing GCs old grants here —
 * a separate sweep job (not in scope) can DELETE stale rows. The store is the
 * truth source; the harness just consults it.
 */
export class SqliteCapabilityStore implements CapabilityStore {
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
			CREATE TABLE IF NOT EXISTS capability_grants (
				id TEXT PRIMARY KEY,
				grants TEXT NOT NULL,
				account_id TEXT NOT NULL,
				parent_escalation_id TEXT NOT NULL,
				uses_remaining INTEGER NOT NULL,
				expires_at TEXT NOT NULL,
				created_at TEXT NOT NULL,
				consumed_at TEXT,
				consumed_by_turn_id TEXT
			);
			CREATE INDEX IF NOT EXISTS idx_capability_active
				ON capability_grants(account_id, uses_remaining, expires_at);
		`);
	}

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
		this.db
			.prepare(
				`INSERT INTO capability_grants
				 (id, grants, account_id, parent_escalation_id, uses_remaining, expires_at, created_at)
				 VALUES (?, ?, ?, ?, ?, ?, ?)`,
			)
			.run(
				g.id,
				g.grants,
				g.scope.accountId,
				g.parentEscalationId,
				g.usesRemaining,
				g.expiresAt.toISOString(),
				g.createdAt.toISOString(),
			);
		return g;
	}

	async listActiveForScope(scope: CapabilityScope, now: Date): Promise<CapabilityGrant[]> {
		const rows = this.db
			.prepare(
				`SELECT * FROM capability_grants
				 WHERE account_id = ?
				   AND uses_remaining > 0
				   AND consumed_at IS NULL
				   AND expires_at > ?`,
			)
			.all(scope.accountId, now.toISOString()) as Row[];
		return rows.map(this.toGrant);
	}

	async consume(grantId: string, turnId: string, now: Date): Promise<CapabilityGrant | null> {
		// One statement: decrement, mark consumed iff this was the last use.
		// The WHERE clause guarantees we don't go below zero or revive an expired grant.
		const info = this.db
			.prepare(
				`UPDATE capability_grants
				 SET uses_remaining = uses_remaining - 1,
				     consumed_at = CASE WHEN uses_remaining - 1 = 0 THEN ? ELSE consumed_at END,
				     consumed_by_turn_id = CASE WHEN uses_remaining - 1 = 0 THEN ? ELSE consumed_by_turn_id END
				 WHERE id = ?
				   AND uses_remaining > 0
				   AND consumed_at IS NULL
				   AND expires_at > ?`,
			)
			.run(now.toISOString(), turnId, grantId, now.toISOString());
		if (info.changes === 0) return null;
		return this.get(grantId);
	}

	async get(id: string): Promise<CapabilityGrant | null> {
		const row = this.db.prepare("SELECT * FROM capability_grants WHERE id = ?").get(id) as
			| Row
			| undefined;
		return row ? this.toGrant(row) : null;
	}

	close(): void {
		if (this.ownsConnection) this.db.close();
	}

	private toGrant = (row: Row): CapabilityGrant => ({
		id: row.id,
		grants: row.grants,
		scope: { accountId: row.account_id },
		parentEscalationId: row.parent_escalation_id,
		usesRemaining: row.uses_remaining,
		expiresAt: new Date(row.expires_at),
		createdAt: new Date(row.created_at),
		consumedAt: row.consumed_at ? new Date(row.consumed_at) : undefined,
		consumedByTurnId: row.consumed_by_turn_id ?? undefined,
	});
}
