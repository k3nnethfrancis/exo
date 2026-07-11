import { access, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { createFolderWithIndex, ensureFolderIndex, inspectFolderIndexes } from "../folder-index";

describe("folder indexes", () => {
  const roots: string[] = [];

  afterEach(async () => {
    await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
  });

  it("creates a new folder with a minimal index", async () => {
    const root = await temporaryRoot();
    const directoryPath = path.join(root, "cantrip-pattern");

    const result = await createFolderWithIndex(directoryPath);

    expect(result).toEqual({
      directoryPath,
      indexPath: path.join(directoryPath, "index.md"),
      created: true,
    });
    expect(await readFile(result.indexPath, "utf8")).toBe("# cantrip-pattern\n");
  });

  it("refuses to reuse or mutate an existing folder", async () => {
    const root = await temporaryRoot();
    const directoryPath = path.join(root, "existing");
    await mkdir(directoryPath);
    await writeFile(path.join(directoryPath, "note.md"), "keep me", "utf8");

    await expect(createFolderWithIndex(directoryPath)).rejects.toMatchObject({ code: "EEXIST" });
    expect(await readFile(path.join(directoryPath, "note.md"), "utf8")).toBe("keep me");
    await expect(access(path.join(directoryPath, "index.md"))).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("ensures an index without overwriting an existing one", async () => {
    const root = await temporaryRoot();
    const directoryPath = path.join(root, "concepts");
    const indexPath = path.join(directoryPath, "index.md");
    await mkdir(directoryPath);

    await expect(ensureFolderIndex(directoryPath)).resolves.toEqual({ directoryPath, indexPath, created: true });
    await writeFile(indexPath, "# My authored title\n", "utf8");
    await expect(ensureFolderIndex(directoryPath)).resolves.toEqual({ directoryPath, indexPath, created: false });
    expect(await readFile(indexPath, "utf8")).toBe("# My authored title\n");
  });

  it("reports nested missing indexes without writing files", async () => {
    const root = await temporaryRoot();
    const noteRoot = path.join(root, "notes");
    const indexed = path.join(noteRoot, "indexed");
    const missing = path.join(noteRoot, "missing");
    const nestedMissing = path.join(missing, "nested");
    await mkdir(indexed, { recursive: true });
    await mkdir(nestedMissing, { recursive: true });
    await writeFile(path.join(indexed, "index.md"), "# Indexed\n", "utf8");

    const before = await snapshotFiles(noteRoot);
    const status = await inspectFolderIndexes([noteRoot]);
    const after = await snapshotFiles(noteRoot);

    expect(status).toEqual({
      folderCount: 3,
      indexedCount: 1,
      missingIndexPaths: [path.join(missing, "index.md"), path.join(nestedMissing, "index.md")],
    });
    expect(after).toEqual(before);
  });

  async function temporaryRoot(): Promise<string> {
    const root = await mkdtemp(path.join(os.tmpdir(), "exo-folder-index-"));
    roots.push(root);
    return root;
  }
});

async function snapshotFiles(directoryPath: string): Promise<string[]> {
  const files: string[] = [];
  async function visit(currentPath: string) {
    for (const entry of await readdir(currentPath, { withFileTypes: true })) {
      const entryPath = path.join(currentPath, entry.name);
      if (entry.isDirectory()) await visit(entryPath);
      else files.push(path.relative(directoryPath, entryPath));
    }
  }
  await visit(directoryPath);
  return files.sort();
}
