import { readFile, readdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { Scenario } from "./types.js";

// Fixtures live alongside this source module (src/eval/scenarios/*.json) and are
// resolved relative to it via import.meta.url, so the loader works the same whether
// run from source (vitest, the TS runner in Task 10) or a future compiled dist.
const SCENARIOS_DIR = join(dirname(fileURLToPath(import.meta.url)), "scenarios");
const VALID_BANDS = ["act", "notify-then-act", "escalate", "prep", "none"];

export async function loadScenarios(dir = SCENARIOS_DIR): Promise<Scenario[]> {
	const files = (await readdir(dir)).filter((f) => f.endsWith(".json"));
	const out: Scenario[] = [];
	for (const f of files) {
		const raw = await readFile(join(dir, f), "utf8");
		const s = JSON.parse(raw) as Scenario;
		if (!s.id) throw new Error(`Scenario ${f} missing id`);
		if (!VALID_BANDS.includes(s.expect?.band)) {
			throw new Error(`Scenario ${f} has invalid expect.band: ${s.expect?.band}`);
		}
		out.push(s);
	}
	return out;
}
