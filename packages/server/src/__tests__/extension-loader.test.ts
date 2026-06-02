import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { loadExtensionsFromDir } from "../extension-loader.js";

describe("loadExtensionsFromDir", () => {
	let tmpDir: string;

	beforeEach(() => {
		tmpDir = mkdtempSync(join(tmpdir(), "ext-test-"));
	});

	afterEach(() => {
		rmSync(tmpDir, { recursive: true, force: true });
	});

	it("returns empty array when directory does not exist", async () => {
		const exts = await loadExtensionsFromDir(join(tmpDir, "missing"));
		expect(exts).toEqual([]);
	});

	it("returns empty array when directory is empty", async () => {
		const exts = await loadExtensionsFromDir(tmpDir);
		expect(exts).toEqual([]);
	});

	it("loads an extension from a .mjs file with default export", async () => {
		const code = `export default { id: "file-ext", factory: () => {} };`;
		writeFileSync(join(tmpDir, "myext.mjs"), code);
		const exts = await loadExtensionsFromDir(tmpDir);
		expect(exts).toHaveLength(1);
		expect(exts[0].id).toBe("file-ext");
	});

	it("loads an extension from a directory with index.mjs", async () => {
		const subdir = join(tmpDir, "myext");
		mkdirSync(subdir);
		writeFileSync(
			join(subdir, "index.mjs"),
			`export default { id: "dir-ext", factory: () => {} };`,
		);
		const exts = await loadExtensionsFromDir(tmpDir);
		expect(exts).toHaveLength(1);
		expect(exts[0].id).toBe("dir-ext");
	});

	it("supports factory-function exports", async () => {
		writeFileSync(
			join(tmpDir, "factory.mjs"),
			`export default () => ({ id: "from-factory", factory: () => {} });`,
		);
		const exts = await loadExtensionsFromDir(tmpDir);
		expect(exts).toHaveLength(1);
		expect(exts[0].id).toBe("from-factory");
	});

	it("skips files that don't export a valid Extension", async () => {
		writeFileSync(join(tmpDir, "bad.mjs"), `export default { wrong: "shape" };`);
		const exts = await loadExtensionsFromDir(tmpDir);
		expect(exts).toEqual([]);
	});

	it("isolates extension load errors", async () => {
		writeFileSync(join(tmpDir, "broken.mjs"), `throw new Error("boom");`);
		writeFileSync(join(tmpDir, "good.mjs"), `export default { id: "good", factory: () => {} };`);
		const exts = await loadExtensionsFromDir(tmpDir);
		expect(exts).toHaveLength(1);
		expect(exts[0].id).toBe("good");
	});

	it("ignores dotfiles and node_modules", async () => {
		writeFileSync(join(tmpDir, ".hidden.mjs"), "export default {};");
		mkdirSync(join(tmpDir, "node_modules"));
		const exts = await loadExtensionsFromDir(tmpDir);
		expect(exts).toEqual([]);
	});
});
