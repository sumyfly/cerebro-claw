import type { Request, Response, NextFunction } from "express";
import { randomUUID } from "node:crypto";

/**
 * Tags every incoming request with a UUID and logs method + path + status + duration.
 * Request ID is exposed as X-Request-Id and on res.locals.requestId for downstream use.
 */
export function requestLogger() {
	return (req: Request, res: Response, next: NextFunction) => {
		const requestId = (req.header("X-Request-Id") as string | undefined) ?? randomUUID();
		res.setHeader("X-Request-Id", requestId);
		res.locals.requestId = requestId;

		const start = Date.now();
		res.on("finish", () => {
			const duration = Date.now() - start;
			// Skip noisy health checks unless they fail
			if (req.path === "/health" && res.statusCode < 400) return;
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

		const status = (err as { status?: number; statusCode?: number })?.status ??
			(err as { statusCode?: number })?.statusCode ?? 500;
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
