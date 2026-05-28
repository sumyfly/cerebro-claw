import type { Request, Response, NextFunction } from "express";

/**
 * Basic bearer-token auth for the admin API.
 * If ADMIN_TOKEN is not configured, auth is disabled (suitable for local dev only).
 *
 * Webhook routes bypass this — they have their own verification (see lark webhook).
 */
export function createAdminAuth(token: string) {
	if (!token) {
		console.warn("[auth] ADMIN_TOKEN not set — admin API is OPEN. Set ADMIN_TOKEN for production.");
		return (_req: Request, _res: Response, next: NextFunction) => next();
	}

	const expected = `Bearer ${token}`;

	return (req: Request, res: Response, next: NextFunction) => {
		// Webhooks bypass admin auth — they have their own verification
		if (req.path.startsWith("/webhook/")) return next();
		// Health and diagnostics are public (used by load balancers)
		if (req.path === "/health" || req.path === "/healthz") return next();

		const provided = req.headers.authorization;
		if (provided !== expected) {
			res.status(401).json({ error: "Unauthorized" });
			return;
		}
		next();
	};
}
