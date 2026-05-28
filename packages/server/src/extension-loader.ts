import { readdir, stat } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import type { Extension } from "@cerebro-claw/shared";

/**
 * Load extensions from a directory.
 *
 * Each subdirectory or .js/.ts file in the extensions directory should
 * default-export an Extension { id, factory } or a function that returns one.
 *
 * For TypeScript files at runtime, the parent process must be running under
 * tsx or similar — otherwise only .js extensions load.
 */
export async function loadExtensionsFromDir(dir: string): Promise<Extension[]> {
	if (!existsSync(dir)) {
		console.log(`[extensions] Directory not found: ${dir}`);
		return [];
	}

	const absoluteDir = resolve(dir);
	const entries = await readdir(absoluteDir);
	const extensions: Extension[] = [];

	for (const entry of entries) {
		if (entry.startsWith(".") || entry === "node_modules") continue;

		const fullPath = join(absoluteDir, entry);
		const stats = await stat(fullPath);
		let modulePath: string | null = null;

		if (stats.isFile() && (entry.endsWith(".js") || entry.endsWith(".ts") || entry.endsWith(".mjs"))) {
			modulePath = fullPath;
		} else if (stats.isDirectory()) {
			for (const candidate of ["index.ts", "index.js", "index.mjs"]) {
				const path = join(fullPath, candidate);
				if (existsSync(path)) {
					modulePath = path;
					break;
				}
			}
		}

		if (!modulePath) continue;

		try {
			const mod = await import(pathToFileURL(modulePath).href);
			const candidate = mod.default ?? mod.extension ?? mod;
			const ext = typeof candidate === "function" ? await candidate() : candidate;
			if (ext && typeof ext === "object" && typeof ext.id === "string" && typeof ext.factory === "function") {
				extensions.push(ext);
				console.log(`[extensions] Discovered: ${ext.id} (${entry})`);
			} else {
				console.warn(`[extensions] ${entry} does not export a valid Extension`);
			}
		} catch (err) {
			console.error(`[extensions] Failed to load ${entry}:`, err);
		}
	}

	return extensions;
}
