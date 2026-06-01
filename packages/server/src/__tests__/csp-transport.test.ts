import { describe, expect, it } from "vitest";
// The extension lives at extensions/csp-connector/ at the repo root.
import { MockCspTransport } from "../../../../extensions/csp-connector/transport.ts";

// Fixtures are keyed by the full prefixed CSP path; tools call the transport
// with the UNPREFIXED path (the transport owns the /api/v1 prefix). These tests
// drive the mock exactly as the tools do.
describe("MockCspTransport", () => {
	it("serves fixture data for the unprefixed path a tool sends", async () => {
		const t = new MockCspTransport({
			"/api/v1/accounts/abc": { data: { id: "abc", name: "Acme" } },
		});
		const res = await t.get("/accounts/abc");
		expect(res.ok).toBe(true);
		expect(res.body).toEqual({ data: { id: "abc", name: "Acme" } });
	});

	it("returns 404 for unknown paths", async () => {
		const t = new MockCspTransport({});
		const res = await t.get("/accounts/missing");
		expect(res.ok).toBe(false);
		expect(res.status).toBe(404);
	});

	it("ignores query strings when matching fixtures", async () => {
		const t = new MockCspTransport({ "/api/v1/accounts": { data: [] } });
		const res = await t.get("/accounts?assignedCsmId=x&limit=25");
		expect(res.ok).toBe(true);
	});

	it("post returns the seeded fixture, else a generic created-id stub", async () => {
		const t = new MockCspTransport({ "/api/v1/notes": { data: { id: "note-1" } } });
		expect((await t.post("/notes", {})).body).toEqual({ data: { id: "note-1" } });
		expect((await t.post("/notes/xyz/delete", {})).body).toEqual({
			data: { id: "mock-created" },
		});
	});
});
