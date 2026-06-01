/**
 * CSP transport seam.
 *
 * The connector tools speak to CSP through a `CspTransport` rather than calling
 * `fetch` directly. Two implementations:
 *
 *   - `HttpCspTransport` — the live path. Faithfully reproduces the original
 *     `cspFetch` behavior: prepends the `/api/v1` prefix, attaches the bearer
 *     token, guards a missing token, parses text-then-JSON, and shapes timeout /
 *     network errors. This is a transport extraction, not a behavior change.
 *   - `MockCspTransport` — the offline path. Serves a fixture map keyed by exact
 *     CSP path (query string ignored), so the agent's fetch-then-decide flow can
 *     run against deterministic data with `CSP_MOCK=1`.
 *
 * Paths passed to the transport are CSP API paths *without* the `/api/v1`
 * prefix (e.g. `/accounts/<id>`), matching what the tools build today. The
 * HTTP transport adds the prefix; the mock fixtures are keyed by the full
 * prefixed path (e.g. `/api/v1/accounts/<id>`) so fixtures read naturally.
 */

const API_PREFIX = "/api/v1";

export interface CspResponse {
	ok: boolean;
	status: number;
	body: unknown;
}

export interface CspTransport {
	get(path: string, init?: { headers?: Record<string, string> }): Promise<CspResponse>;
	post(
		path: string,
		body: unknown,
		init?: { headers?: Record<string, string> },
	): Promise<CspResponse>;
}

/** Live transport — wraps fetch against the real CSP base URL (with `/api/v1`). */
export class HttpCspTransport implements CspTransport {
	constructor(
		private baseUrl: string,
		private token: string,
		private timeoutMs: number,
	) {}

	private async call(
		method: string,
		apiPath: string,
		body?: unknown,
		init: { headers?: Record<string, string> } = {},
	): Promise<CspResponse> {
		if (!this.token) {
			return {
				ok: false,
				status: 0,
				body: {
					error: "CSP integration not configured (CSP_TOKEN missing). Fall back to memory_* tools.",
				},
			};
		}
		const ac = new AbortController();
		const timeout = setTimeout(() => ac.abort(), this.timeoutMs);
		try {
			const path = apiPath.startsWith("/") ? apiPath : `/${apiPath}`;
			const url = `${this.baseUrl}${API_PREFIX}${path}`;
			const headers: Record<string, string> = {
				Authorization: `Bearer ${this.token}`,
				Accept: "application/json",
			};
			if (body !== undefined) headers["Content-Type"] = "application/json";

			const res = await fetch(url, {
				method,
				signal: ac.signal,
				body: body !== undefined ? JSON.stringify(body) : undefined,
				headers: { ...headers, ...init.headers },
			});
			const text = await res.text();
			let parsed: unknown = text;
			try {
				parsed = text ? JSON.parse(text) : null;
			} catch {
				// keep as text
			}
			return { ok: res.ok, status: res.status, body: parsed };
		} catch (err) {
			const e = err as Error & { name?: string };
			const message =
				e.name === "AbortError"
					? `CSP request timed out after ${this.timeoutMs}ms`
					: `CSP request failed: ${e.message}`;
			return { ok: false, status: 0, body: { error: message } };
		} finally {
			clearTimeout(timeout);
		}
	}

	get(path: string, init?: { headers?: Record<string, string> }) {
		return this.call("GET", path, undefined, init);
	}

	post(path: string, body: unknown, init?: { headers?: Record<string, string> }) {
		return this.call("POST", path, body, init);
	}
}

/** Mock transport — serves a fixture map keyed by exact path (query string ignored). */
export class MockCspTransport implements CspTransport {
	constructor(private fixtures: Record<string, unknown>) {}

	async get(path: string): Promise<CspResponse> {
		const key = path.split("?")[0];
		if (key in this.fixtures) return { ok: true, status: 200, body: this.fixtures[key] };
		return { ok: false, status: 404, body: null };
	}

	async post(path: string): Promise<CspResponse> {
		const key = path.split("?")[0];
		if (key in this.fixtures) return { ok: true, status: 200, body: this.fixtures[key] };
		return { ok: true, status: 200, body: { data: { id: "mock-created" } } };
	}
}
