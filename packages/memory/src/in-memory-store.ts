import type {
	CustomerProfile,
	CustomerState,
	DecisionRecord,
	HistoryEntry,
	InstinctEntry,
	MemoryStore,
} from "@cerebro-claw/shared";

export class InMemoryStore implements MemoryStore {
	private profiles = new Map<string, CustomerProfile>();
	private states = new Map<string, CustomerState>();
	private history = new Map<string, HistoryEntry[]>();
	private instincts = new Map<string, InstinctEntry[]>();
	private decisions = new Map<string, DecisionRecord>();

	async getProfile(customerId: string): Promise<CustomerProfile | null> {
		return this.profiles.get(customerId) ?? null;
	}

	async listProfiles(): Promise<CustomerProfile[]> {
		return Array.from(this.profiles.values());
	}

	async upsertProfile(profile: CustomerProfile): Promise<void> {
		this.profiles.set(profile.id, profile);
	}

	async getState(customerId: string): Promise<CustomerState | null> {
		return this.states.get(customerId) ?? null;
	}

	async updateState(state: CustomerState): Promise<void> {
		this.states.set(state.customerId, state);
	}

	async addHistory(entry: HistoryEntry): Promise<void> {
		const entries = this.history.get(entry.customerId) ?? [];
		entries.push(entry);
		this.history.set(entry.customerId, entries);
	}

	async getHistory(customerId: string, limit = 50): Promise<HistoryEntry[]> {
		const entries = this.history.get(customerId) ?? [];
		return entries.slice(-limit);
	}

	async searchHistory(customerId: string, query: string): Promise<HistoryEntry[]> {
		const entries = this.history.get(customerId) ?? [];
		const lower = query.toLowerCase();
		return entries.filter(
			(e) => e.summary.toLowerCase().includes(lower) || e.details?.toLowerCase().includes(lower),
		);
	}

	async addInstinct(entry: InstinctEntry): Promise<void> {
		const entries = this.instincts.get(entry.customerId) ?? [];
		entries.push(entry);
		this.instincts.set(entry.customerId, entries);
	}

	async getInstincts(customerId: string): Promise<InstinctEntry[]> {
		return this.instincts.get(customerId) ?? [];
	}

	async searchInstincts(customerId: string, query: string): Promise<InstinctEntry[]> {
		const entries = this.instincts.get(customerId) ?? [];
		const lower = query.toLowerCase();
		return entries.filter((e) => e.content.toLowerCase().includes(lower));
	}

	async getLastDecision(customerId: string): Promise<DecisionRecord | null> {
		return this.decisions.get(customerId) ?? null;
	}

	async recordDecision(record: DecisionRecord): Promise<void> {
		this.decisions.set(record.customerId, record);
	}
}
