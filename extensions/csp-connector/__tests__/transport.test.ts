import { describe, expect, it } from "vitest";
import { MockCspTransport } from "../transport.js";

describe("MockCspTransport", () => {
	it("serves fixture data by path", async () => {
		const t = new MockCspTransport({
			"/api/v1/accounts/abc": { data: { id: "abc", name: "Acme" } },
		});
		const res = await t.get("/api/v1/accounts/abc");
		expect(res.ok).toBe(true);
		expect(res.body).toEqual({ data: { id: "abc", name: "Acme" } });
	});

	it("returns 404 for unknown paths", async () => {
		const t = new MockCspTransport({});
		const res = await t.get("/api/v1/accounts/missing");
		expect(res.ok).toBe(false);
		expect(res.status).toBe(404);
	});

	it("ignores query strings when matching fixtures", async () => {
		const t = new MockCspTransport({ "/api/v1/accounts": { data: [] } });
		const res = await t.get("/api/v1/accounts?assignedCsmId=x&limit=25");
		expect(res.ok).toBe(true);
	});
});
