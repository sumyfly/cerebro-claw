/**
 * Load environment variables from the nearest `.env` file at startup.
 *
 * The app has no dotenv dependency and `pnpm turbo dev` doesn't read `.env`,
 * so without this the server boots with no CSP/Anthropic/Lark credentials and
 * silently falls back to demo behavior. This walks up from cwd to find a `.env`
 * (the monorepo root, regardless of which package directory the process started
 * in) and applies any keys that aren't already set in the real environment.
 *
 * Imported for its side effect — must run before config/createApp read env.
 * Real env vars always win; this only fills the gaps.
 */

import { existsSync, readFileSync } from "node:fs";
import { dirname, join, parse as parsePath } from "node:path";

function findEnvFile(startDir: string): string | null {
	let dir = startDir;
	// Walk up to the filesystem root.
	while (true) {
		const candidate = join(dir, ".env");
		if (existsSync(candidate)) return candidate;
		const parent = dirname(dir);
		if (parent === dir || dir === parsePath(dir).root) return null;
		dir = parent;
	}
}

function parseEnv(content: string): Record<string, string> {
	const out: Record<string, string> = {};
	for (const rawLine of content.split(/\r?\n/)) {
		const line = rawLine.trim();
		if (!line || line.startsWith("#")) continue;
		const eq = line.indexOf("=");
		if (eq === -1) continue;
		const key = line.slice(0, eq).trim();
		if (!key) continue;
		let value = line.slice(eq + 1).trim();
		// Strip a single layer of matching surrounding quotes.
		if (
			(value.startsWith('"') && value.endsWith('"')) ||
			(value.startsWith("'") && value.endsWith("'"))
		) {
			value = value.slice(1, -1);
		}
		out[key] = value;
	}
	return out;
}

const envPath = findEnvFile(process.cwd());
if (envPath) {
	const parsed = parseEnv(readFileSync(envPath, "utf8"));
	let applied = 0;
	for (const [key, value] of Object.entries(parsed)) {
		if (process.env[key] === undefined) {
			process.env[key] = value;
			applied++;
		}
	}
	console.log(`[env] Loaded ${applied} var(s) from ${envPath}`);
} else {
	console.log("[env] No .env file found (using process environment as-is)");
}
