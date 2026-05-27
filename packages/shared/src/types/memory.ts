import type {
	CustomerProfile,
	CustomerState,
	HistoryEntry,
	InstinctEntry,
} from "./customer.js";

export interface MemoryStore {
	// Profile layer
	getProfile(customerId: string): Promise<CustomerProfile | null>;
	listProfiles(): Promise<CustomerProfile[]>;
	upsertProfile(profile: CustomerProfile): Promise<void>;

	// State layer
	getState(customerId: string): Promise<CustomerState | null>;
	updateState(state: CustomerState): Promise<void>;

	// History layer
	addHistory(entry: HistoryEntry): Promise<void>;
	getHistory(customerId: string, limit?: number): Promise<HistoryEntry[]>;
	searchHistory(customerId: string, query: string): Promise<HistoryEntry[]>;

	// Instinct layer
	addInstinct(entry: InstinctEntry): Promise<void>;
	getInstincts(customerId: string): Promise<InstinctEntry[]>;
	searchInstincts(customerId: string, query: string): Promise<InstinctEntry[]>;
}
