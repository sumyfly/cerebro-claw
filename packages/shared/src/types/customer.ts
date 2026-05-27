export interface CustomerProfile {
	id: string;
	companyName: string;
	companySize?: string;
	plan?: string;
	contractValue?: number;
	contacts: CustomerContact[];
	csmOwnerId: string;
	createdAt: Date;
	updatedAt: Date;
}

export interface CustomerContact {
	name: string;
	role: string;
	email?: string;
	isDecisionMaker: boolean;
	notes?: string;
}

export type HealthStatus = "good" | "at-risk" | "critical";
export type UsageTrend = "up" | "flat" | "dropping";

export interface CustomerState {
	customerId: string;
	health: HealthStatus;
	openIssues: number;
	lastContactDate: Date;
	renewalDate?: Date;
	nextQbrDate?: Date;
	usageTrend: UsageTrend;
	updatedAt: Date;
}

export interface HistoryEntry {
	id: string;
	customerId: string;
	type: "call" | "email" | "ticket" | "message" | "event" | "decision";
	summary: string;
	details?: string;
	timestamp: Date;
}

export interface InstinctEntry {
	id: string;
	customerId: string;
	content: string;
	source: string;
	createdAt: Date;
}
