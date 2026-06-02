import type { NextFunction, Request, Response } from "express";
import { describe, expect, it, vi } from "vitest";
import { errorHandler, notFoundHandler, requestLogger } from "../middleware.js";

function makeRes(): {
	res: Response;
	jsonSpy: ReturnType<typeof vi.fn>;
	statusSpy: ReturnType<typeof vi.fn>;
	setHeaderSpy: ReturnType<typeof vi.fn>;
	locals: Record<string, unknown>;
	onCallbacks: Record<string, () => void>;
} {
	const jsonSpy = vi.fn();
	const statusSpy = vi.fn(() => ({ json: jsonSpy }));
	const setHeaderSpy = vi.fn();
	const locals: Record<string, unknown> = {};
	const onCallbacks: Record<string, () => void> = {};
	const res = {
		status: statusSpy,
		json: jsonSpy,
		setHeader: setHeaderSpy,
		locals,
		headersSent: false,
		on: (event: string, cb: () => void) => {
			onCallbacks[event] = cb;
		},
	} as unknown as Response;
	return { res, jsonSpy, statusSpy, setHeaderSpy, locals, onCallbacks };
}

describe("requestLogger", () => {
	it("assigns a request ID and exposes it via header and locals", () => {
		const log = requestLogger();
		const { res, setHeaderSpy, locals } = makeRes();
		const req = { header: () => undefined, method: "GET", path: "/x" } as unknown as Request;
		const next = vi.fn() as unknown as NextFunction;
		log(req, res, next);
		expect(setHeaderSpy).toHaveBeenCalledWith("X-Request-Id", expect.any(String));
		expect(locals.requestId).toBeTypeOf("string");
		expect(next).toHaveBeenCalled();
	});

	it("respects incoming X-Request-Id", () => {
		const log = requestLogger();
		const { res, setHeaderSpy } = makeRes();
		const req = {
			header: (h: string) => (h === "X-Request-Id" ? "external-abc" : undefined),
			method: "GET",
			path: "/x",
		} as unknown as Request;
		const next = vi.fn() as unknown as NextFunction;
		log(req, res, next);
		expect(setHeaderSpy).toHaveBeenCalledWith("X-Request-Id", "external-abc");
	});
});

describe("errorHandler", () => {
	it("returns JSON with error message and status", () => {
		const handler = errorHandler();
		const { res, jsonSpy, statusSpy } = makeRes();
		const req = { method: "GET", path: "/boom" } as unknown as Request;
		handler(new Error("kaboom"), req, res, vi.fn() as unknown as NextFunction);
		expect(statusSpy).toHaveBeenCalledWith(500);
		expect(jsonSpy).toHaveBeenCalledWith(expect.objectContaining({ error: "kaboom" }));
	});

	it("uses err.status when provided", () => {
		const handler = errorHandler();
		const { res, statusSpy } = makeRes();
		const req = { method: "GET", path: "/boom" } as unknown as Request;
		const err = Object.assign(new Error("bad input"), { status: 400 });
		handler(err, req, res, vi.fn() as unknown as NextFunction);
		expect(statusSpy).toHaveBeenCalledWith(400);
	});

	it("skips when headers already sent", () => {
		const handler = errorHandler();
		const { res, statusSpy } = makeRes();
		(res as { headersSent: boolean }).headersSent = true;
		const req = { method: "GET", path: "/late" } as unknown as Request;
		handler(new Error("oops"), req, res, vi.fn() as unknown as NextFunction);
		expect(statusSpy).not.toHaveBeenCalled();
	});
});

describe("notFoundHandler", () => {
	it("returns 404 JSON with method+path", () => {
		const handler = notFoundHandler();
		const { res, jsonSpy, statusSpy } = makeRes();
		const req = { method: "POST", path: "/missing" } as unknown as Request;
		handler(req, res);
		expect(statusSpy).toHaveBeenCalledWith(404);
		expect(jsonSpy).toHaveBeenCalledWith(
			expect.objectContaining({ error: "No route for POST /missing" }),
		);
	});
});
