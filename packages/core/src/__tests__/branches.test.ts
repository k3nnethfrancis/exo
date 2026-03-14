import { mkdtemp, mkdir, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { branchRelativePath, createBranchFile, getBranchFamily, nextBranchRelativePath, parseBranchRelativePath } from "../branches";
import { readWorkspaceDocument } from "../notes";

const tempRoots: string[] = [];

afterEach(async () => {
  for (const root of tempRoots.splice(0)) {
    await import("node:fs/promises").then(({ rm }) => rm(root, { recursive: true, force: true }));
  }
});

describe("branches", () => {
  it("parses root and nested branch paths", () => {
    expect(parseBranchRelativePath("focus-note.md")).toEqual({ baseName: "focus-note", path: [] });
    expect(parseBranchRelativePath("focus-note-looms/1.2.md")).toEqual({ baseName: "focus-note", path: [1, 2] });
    expect(branchRelativePath("focus-note", [1, 2])).toBe("focus-note-looms/1.2.md");
    expect(nextBranchRelativePath("focus-note.md", ["focus-note.md", "focus-note-looms/1.md"])).toBe("focus-note-looms/2.md");
  });

  it("creates and lists a branch family", async () => {
    const tempRoot = await mkdtemp(path.join(os.tmpdir(), "exo-branches-"));
    tempRoots.push(tempRoot);

    const noteRoot = path.join(tempRoot, "notes");
    await mkdir(noteRoot, { recursive: true });

    const rootFilePath = path.join(noteRoot, "focus-note.md");
    await writeFile(rootFilePath, "---\ntitle: Focus Note\ntags:\n  - research\n---\n\n# Focus Note\n", "utf8");

    const document = await readWorkspaceDocument(rootFilePath);
    const result = await createBranchFile(rootFilePath, document, [noteRoot]);

    expect(result.branchFilePath).toBe(path.join(noteRoot, "focus-note-looms/1.md"));

    const branchDocument = await readWorkspaceDocument(result.branchFilePath);
    expect(branchDocument.frontmatter.branch_parent).toBe("focus-note.md");

    const family = await getBranchFamily(result.branchFilePath, [noteRoot]);
    expect(family.members).toHaveLength(2);
    expect(family.tree).toContain("focus-note.md");
    expect(family.tree).toContain("1.md");

    const raw = await readFile(result.branchFilePath, "utf8");
    expect(raw).toContain("branch_parent: focus-note.md");
  });
});
