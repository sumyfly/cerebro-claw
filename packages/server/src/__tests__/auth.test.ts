import type { NextFunction, Request, Response } from "express";
import { describe, expect, it, vi } from "vitest";
import { createAdminAuth } from "../auth.js";

function makeReq(path: string, authorization?: string): Request {
	return { path, headers: authorization ? { authorization } : {} } as unknown as Request;
}

function makeRes(): {
	res: Response;
	jsonSpy: ReturnType<typeof vi.fn>;
	statusSpy: ReturnType<typeof vi.fn>;
} {
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
		auth(makeReq("/api/ledger"), res, next);
		expect(next).toHaveBeenCalled();
	});

	it("rejects requests without bearer token when configured", () => {
		const auth = createAdminAuth("secret");
		const next = vi.fn() as unknown as NextFunction;
		const { res, statusSpy } = makeRes();
		auth(makeReq("/api/ledger"), res, next);
		expect(statusSpy).toHaveBeenCalledWith(401);
		expect(next).not.toHaveBeenCalled();
	});

	it("accepts valid bearer token", () => {
		const auth = createAdminAuth("secret");
		const next = vi.fn() as unknown as NextFunction;
		const { res } = makeRes();
		auth(makeReq("/api/ledger", "Bearer secret"), res, next);
		expect(next).toHaveBeenCalled();
	});

	it("rejects wrong bearer token", () => {
		const auth = createAdminAuth("secret");
		const next = vi.fn() as unknown as NextFunction;
		const { res, statusSpy } = makeRes();
		auth(makeReq("/api/ledger", "Bearer wrong"), res, next);
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
