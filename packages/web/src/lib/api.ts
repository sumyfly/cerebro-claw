/** Shared API types + fetch helpers for the agent ops console. */

import type { RecentToolCall } from "@cerebro-claw/shared";
import type { Band, Status } from "./status.js";

export type { RecentToolCall };

export interface LedgerEntry {
	id: string;
	band: Band;
	customerId: string;
	customerName?: string;
	summary: string;
	reason: string;
	status: Status;
	createdAt: string;
	executeAt?: string;
	executedAt?: string;
	payload?: Record<string, unknown>;
	note?: string;
}

export interface DigestCounters {
	headline: string;
	counts: {
		windowHours: number;
		acts: number;
		notifies: { inFlight: number; executed: number; cancelled: number; failed: number };
		escalations: { needsCsm: number; resolved: number };
		situations: { needsCsm: number; watching: number };
		preps: number;
	};
}

/** A persistent storyline the agent works across cycles. */
export interface Situation {
	id: string;
	businessId: string;
	customerName?: string;
	kind: string;
	renewalId?: string;
	title: string;
	status: "open" | "watching" | "escalated" | "resolved";
	openedAt: string;
	updatedAt: string;
	nextCheckpoint?: string;
	waitingFor?: string;
	needsAttention: boolean;
	note?: string;
}

export interface SituationWithStoryline extends Situation {
	storyline: LedgerEntry[];
}

export interface SituationQueue {
	needsCsm: SituationWithStoryline[];
	watchingCount: number;
}

export interface ExtensionInfo {
	loaded: string[];
	channels: string[];
	tools: { name: string; description: string }[];
}

/** A task row in the ops console, joined with the agent's recorded outcome. */
export interface TaskRow {
	id: string;
	title: string;
	status: "open" | "in-progress" | "done" | "blocked";
	description?: string;
	businessId?: string;
	customerName?: string;
	renewalId?: string;
	priority?: string;
	latestAction: { band: Band; status: Status; summary: string } | null;
}

export interface TaskOutcomeRow {
	taskId: string;
	band: Band;
	status: Status;
	summary: string;
	createdAt: string;
}

export interface TaskQueue {
	configured: boolean;
	label: string | null;
	open: TaskRow[];
	recentOutcomes: TaskOutcomeRow[];
}

export type Diagnostics = Record<string, { ok: boolean; detail?: string }>;

/** Error carrying the HTTP status so callers can branch on it (e.g. 404). */
export class HttpError extends Error {
	readonly status: number;
	constructor(status: number, url: string) {
		super(`${status} ${url}`);
		this.name = "HttpError";
		this.status = status;
	}
}

/**
 * Build request headers, attaching the admin bearer token ONLY when
 * VITE_ADMIN_TOKEN is configured (non-empty). In an unsecured local dev deploy
 * the server has no ADMIN_TOKEN and we send no Authorization header.
 */
function authHeaders(extra?: Record<string, string>): Record<string, string> {
	const token = import.meta.env.VITE_ADMIN_TOKEN;
	const headers: Record<string, string> = { ...extra };
	if (token) headers.Authorization = `Bearer ${token}`;
	return headers;
}

export async function getJson<T>(url: string, signal?: AbortSignal): Promise<T> {
	const res = await fetch(url, { headers: authHeaders(), signal });
	if (!res.ok) throw new HttpError(res.status, url);
	return (await res.json()) as T;
}

export async function postJson<T>(url: string, body: unknown): Promise<T> {
	const res = await fetch(url, {
		method: "POST",
		headers: authHeaders({ "Content-Type": "application/json" }),
		body: JSON.stringify(body),
	});
	if (!res.ok) throw new HttpError(res.status, url);
	return (await res.json()) as T;
}
