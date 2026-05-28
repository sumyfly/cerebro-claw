import { describe, it, expect, vi } from "vitest";
import { createAdminAuth } from "../auth.js";
import type { Request, Response, NextFunction } from "express";

function makeReq(path: string, authorization?: string): Request {
	return { path, headers: authorization ? { authorization } : {} } as unknown as Request;
}

function makeRes(): { res: Response; jsonSpy: ReturnType<typeof vi.fn>; statusSpy: ReturnType<typeof vi.fn> } {
	const jsonSpy = vi.fn();
	const statusSpy = vi.fn(() => ({ json: jsonSpy }));
	const res = { status: statusSpy } as unknown as Response;
	return { res, jsonSpy, statusSpy };
}

describe("createAdminAuth", () => {
	it("passes through when no token configured", () => {
		const auth = createAdminAuth("");
		const next = vi.fn() as unknown as NextFunction;
		const { res } = makeRes();
		auth(makeReq("/api/customers"), res, next);
		expect(next).toHaveBeenCalled();
	});

	it("rejects requests without bearer token when configured", () => {
		const auth = createAdminAuth("secret");
		const next = vi.fn() as unknown as NextFunction;
		const { res, statusSpy } = makeRes();
		auth(makeReq("/api/customers"), res, next);
		expect(statusSpy).toHaveBeenCalledWith(401);
		expect(next).not.toHaveBeenCalled();
	});

	it("accepts valid bearer token", () => {
		const auth = createAdminAuth("secret");
		const next = vi.fn() as unknown as NextFunction;
		const { res } = makeRes();
		auth(makeReq("/api/customers", "Bearer secret"), res, next);
		expect(next).toHaveBeenCalled();
	});

	it("rejects wrong bearer token", () => {
		const auth = createAdminAuth("secret");
		const next = vi.fn() as unknown as NextFunction;
		const { res, statusSpy } = makeRes();
		auth(makeReq("/api/customers", "Bearer wrong"), res, next);
		expect(statusSpy).toHaveBeenCalledWith(401);
		expect(next).not.toHaveBeenCalled();
	});

	it("bypasses auth for webhook paths", () => {
		const auth = createAdminAuth("secret");
		const next = vi.fn() as unknown as NextFunction;
		const { res } = makeRes();
		auth(makeReq("/webhook/lark"), res, next);
		expect(next).toHaveBeenCalled();
	});

	it("bypasses auth for health endpoint", () => {
		const auth = createAdminAuth("secret");
		const next = vi.fn() as unknown as NextFunction;
		const { res } = makeRes();
		auth(makeReq("/health"), res, next);
		expect(next).toHaveBeenCalled();
	});
});
