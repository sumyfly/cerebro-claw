import type {
	CustomerProfile,
	CustomerState,
	DecisionRecord,
	HistoryEntry,
	InstinctEntry,
	MemoryStore,
} from "@cerebro-claw/shared";
import Database from "better-sqlite3";

export class SqliteStore implements MemoryStore {
	private db: Database.Database;

	constructor(dbPath: string) {
		this.db = new Database(dbPath);
		this.db.pragma("journal_mode = WAL");
		this.migrate();
	}

	private migrate(): void {
		this.db.exec(`
			CREATE TABLE IF NOT EXISTS profiles (
				id TEXT PRIMARY KEY,
				data TEXT NOT NULL,
				created_at TEXT NOT NULL
			);
			CREATE TABLE IF NOT EXISTS states (
				customer_id TEXT PRIMARY KEY,
				data TEXT NOT NULL
			);
			CREATE TABLE IF NOT EXISTS history (
				id TEXT PRIMARY KEY,
				customer_id TEXT NOT NULL,
				type TEXT NOT NULL,
				summary TEXT NOT NULL,
				details TEXT,
				timestamp TEXT NOT NULL
			);
			CREATE INDEX IF NOT EXISTS idx_history_customer ON history(customer_id);
			CREATE TABLE IF NOT EXISTS instincts (
				id TEXT PRIMARY KEY,
				customer_id TEXT NOT NULL,
				content TEXT NOT NULL,
				source TEXT NOT NULL,
				created_at TEXT NOT NULL
			);
			CREATE INDEX IF NOT EXISTS idx_instincts_customer ON instincts(customer_id);
			CREATE TABLE IF NOT EXISTS decisions (
				customer_id TEXT PRIMARY KEY,
				signal_fingerprint TEXT NOT NULL,
				band TEXT NOT NULL,
				reason TEXT,
				ts TEXT NOT NULL,
				health_score REAL
			);
		`);
		// Migrate older dbs that predate the health_score column.
		try {
			this.db.exec("ALTER TABLE decisions ADD COLUMN health_score REAL");
		} catch {
			// Column already exists — fine.
		}
	}

	async getProfile(customerId: string): Promise<CustomerProfile | null> {
		const row = this.db.prepare("SELECT data FROM profiles WHERE id = ?").get(customerId) as
			| { data: string }
			| undefined;
		if (!row) return null;
		return this.parseProfile(row.data);
	}

	async listProfiles(): Promise<CustomerProfile[]> {
		const rows = this.db.prepare("SELECT data FROM profiles ORDER BY created_at").all() as {
			data: string;
		}[];
		return rows.map((r) => this.parseProfile(r.data));
	}

	async upsertProfile(profile: CustomerProfile): Promise<void> {
		this.db
			.prepare("INSERT OR REPLACE INTO profiles (id, data, created_at) VALUES (?, ?, ?)")
			.run(profile.id, JSON.stringify(profile), profile.createdAt.toISOString());
	}

	async getState(customerId: string): Promise<CustomerState | null> {
		const row = this.db.prepare("SELECT data FROM states WHERE customer_id = ?").get(customerId) as
			| { data: string }
			| undefined;
		if (!row) return null;
		return this.parseState(row.data);
	}

	async updateState(state: CustomerState): Promise<void> {
		this.db
			.prepare("INSERT OR REPLACE INTO states (customer_id, data) VALUES (?, ?)")
			.run(state.customerId, JSON.stringify(state));
	}

	async addHistory(entry: HistoryEntry): Promise<void> {
		this.db
			.prepare(
				"INSERT INTO history (id, customer_id, type, summary, details, timestamp) VALUES (?, ?, ?, ?, ?, ?)",
			)
			.run(
				entry.id,
				entry.customerId,
				entry.type,
				entry.summary,
				entry.details ?? null,
				entry.timestamp.toISOString(),
			);
	}

	async getHistory(customerId: string, limit = 50): Promise<HistoryEntry[]> {
		const rows = this.db
			.prepare("SELECT * FROM history WHERE customer_id = ? ORDER BY timestamp DESC LIMIT ?")
			.all(customerId, limit) as {
			id: string;
			customer_id: string;
			type: string;
			summary: string;
			details: string | null;
			timestamp: string;
		}[];
		return rows.reverse().map((r) => ({
			id: r.id,
			customerId: r.customer_id,
			type: r.type as HistoryEntry["type"],
			summary: r.summary,
			details: r.details ?? undefined,
			timestamp: new Date(r.timestamp),
		}));
	}

	async searchHistory(customerId: string, query: string): Promise<HistoryEntry[]> {
		const pattern = `%${query}%`;
		const rows = this.db
			.prepare(
				"SELECT * FROM history WHERE customer_id = ? AND (summary LIKE ? OR details LIKE ?) ORDER BY timestamp",
			)
			.all(customerId, pattern, pattern) as {
			id: string;
			customer_id: string;
			type: string;
			summary: string;
			details: string | null;
			timestamp: string;
		}[];
		return rows.map((r) => ({
			id: r.id,
			customerId: r.customer_id,
			type: r.type as HistoryEntry["type"],
			summary: r.summary,
			details: r.details ?? undefined,
			timestamp: new Date(r.timestamp),
		}));
	}

	async addInstinct(entry: InstinctEntry): Promise<void> {
		this.db
			.prepare(
				"INSERT INTO instincts (id, customer_id, content, source, created_at) VALUES (?, ?, ?, ?, ?)",
			)
			.run(entry.id, entry.customerId, entry.content, entry.source, entry.createdAt.toISOString());
	}

	async getInstincts(customerId: string): Promise<InstinctEntry[]> {
		const rows = this.db
			.prepare("SELECT * FROM instincts WHERE customer_id = ? ORDER BY created_at")
			.all(customerId) as {
			id: string;
			customer_id: string;
			content: string;
			source: string;
			created_at: string;
		}[];
		return rows.map((r) => ({
			id: r.id,
			customerId: r.customer_id,
			content: r.content,
			source: r.source,
			createdAt: new Date(r.created_at),
		}));
	}

	async searchInstincts(customerId: string, query: string): Promise<InstinctEntry[]> {
		const pattern = `%${query}%`;
		const rows = this.db
			.prepare(
				"SELECT * FROM instincts WHERE customer_id = ? AND content LIKE ? ORDER BY created_at",
			)
			.all(customerId, pattern) as {
			id: string;
			customer_id: string;
			content: string;
			source: string;
			created_at: string;
		}[];
		return rows.map((r) => ({
			id: r.id,
			customerId: r.customer_id,
			content: r.content,
			source: r.source,
			createdAt: new Date(r.created_at),
		}));
	}

	async getLastDecision(customerId: string): Promise<DecisionRecord | null> {
		const row = this.db.prepare("SELECT * FROM decisions WHERE customer_id = ?").get(customerId) as
			| {
					customer_id: string;
					signal_fingerprint: string;
					band: string;
					reason: string | null;
					ts: string;
					health_score: number | null;
			  }
			| undefined;
		if (!row) return null;
		return {
			customerId: row.customer_id,
			signalFingerprint: row.signal_fingerprint,
			band: row.band,
			reason: row.reason ?? undefined,
			ts: new Date(row.ts),
			healthScore: row.health_score ?? undefined,
		};
	}

	async recordDecision(record: DecisionRecord): Promise<void> {
		this.db
			.prepare(
				"INSERT OR REPLACE INTO decisions (customer_id, signal_fingerprint, band, reason, ts, health_score) VALUES (?, ?, ?, ?, ?, ?)",
			)
			.run(
				record.customerId,
				record.signalFingerprint,
				record.band,
				record.reason ?? null,
				record.ts.toISOString(),
				record.healthScore ?? null,
			);
	}

	close(): void {
		this.db.close();
	}

	private parseProfile(data: string): CustomerProfile {
		const p = JSON.parse(data);
		p.createdAt = new Date(p.createdAt);
		p.updatedAt = new Date(p.updatedAt);
		return p;
	}

	private parseState(data: string): CustomerState {
		const s = JSON.parse(data);
		s.lastContactDate = new Date(s.lastContactDate);
		s.updatedAt = new Date(s.updatedAt);
		if (s.renewalDate) s.renewalDate = new Date(s.renewalDate);
		if (s.nextQbrDate) s.nextQbrDate = new Date(s.nextQbrDate);
		return s;
	}
}
