import { randomUUID } from "node:crypto";
import type { NextFunction, Request, Response } from "express";

/**
 * Endpoints the admin UI polls on a short interval (usePoll, ~5s). Logging every
 * successful poll buries the meaningful lines (brain-loop, mutations, errors) in
 * noise, so we suppress them when they succeed. Failures (>=400) still log, and
 * LOG_ALL_REQUESTS=true re-enables full verbosity for debugging.
 */
const NOISY_POLL_PATHS = new Set([
	"/health",
	"/api/ledger",
	"/api/ledger/open",
	"/api/tasks",
	"/api/digest/counters",
	"/api/tools/recent",
]);

/**
 * Tags every incoming request with a UUID and logs method + path + status + duration.
 * Request ID is exposed as X-Request-Id and on res.locals.requestId for downstream use.
 */
export function requestLogger() {
	const logAll = /^(1|true|yes)$/i.test(process.env.LOG_ALL_REQUESTS ?? "");
	return (req: Request, res: Response, next: NextFunction) => {
		const requestId = (req.header("X-Request-Id") as string | undefined) ?? randomUUID();
		res.setHeader("X-Request-Id", requestId);
		res.locals.requestId = requestId;

		const start = Date.now();
		res.on("finish", () => {
			const duration = Date.now() - start;
			// Skip successful high-frequency UI polls unless full logging is requested.
			if (!logAll && req.method === "GET" && res.statusCode < 400 && NOISY_POLL_PATHS.has(req.path))
				return;
			console.log(
				`[req ${requestId.slice(0, 8)}] ${req.method} ${req.path} ${res.statusCode} ${duration}ms`,
			);
		});

		next();
	};
}

/**
 * Catches anything thrown from an async route handler and returns a JSON
 * error response instead of Express's default HTML stack trace.
 */
export function errorHandler() {
	return (err: unknown, req: Request, res: Response, _next: NextFunction) => {
		const requestId = (res.locals.requestId as string | undefined) ?? "unknown";
		const message = err instanceof Error ? err.message : String(err);
		console.error(`[req ${requestId.slice(0, 8)}] ERROR ${req.method} ${req.path}: ${message}`);

		// Don't override a response that already started
		if (res.headersSent) return;

		const status =
			(err as { status?: number; statusCode?: number })?.status ??
			(err as { statusCode?: number })?.statusCode ??
			500;
		res.status(status).json({
			error: message,
			requestId,
		});
	};
}

/**
 * 404 handler that returns JSON for unknown routes (avoiding Express's default
 * "Cannot GET /foo" plain text response).
 */
export function notFoundHandler() {
	return (req: Request, res: Response) => {
		res.status(404).json({
			error: `No route for ${req.method} ${req.path}`,
			requestId: res.locals.requestId,
		});
	};
}
