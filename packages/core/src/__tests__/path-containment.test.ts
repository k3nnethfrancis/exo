import path from "node:path";

import { describe, expect, it } from "vitest";

import { isPathWithinRoot } from "../path-containment";

describe("isPathWithinRoot", () => {
  it.each([
    ["a nested POSIX path", "/notes", "/notes/research", path.posix, true],
    ["a contained POSIX path beginning with dots", "/notes", "/notes/..drafts", path.posix, true],
    ["a POSIX sibling", "/notes", "/notes-archive", path.posix, false],
    ["a nested Windows path", "C:\\notes", "C:\\notes\\research", path.win32, true],
    ["a Windows path on another volume", "C:\\notes", "D:\\private", path.win32, false],
  ])("accepts only containment for %s", (_case, rootPath, targetPath, pathFlavor, expected) => {
    expect(isPathWithinRoot(rootPath, targetPath, pathFlavor)).toBe(expected);
  });
});
