import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { listRootTree, resolveWorkspaceModel, searchNotes, searchProjectFiles, searchWorkspace } from "../workspace";

const fixtureLabRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../../fixtures/workspace/lab");

describe("workspace", () => {
  it("resolves the default workspace model from env", () => {
    const model = resolveWorkspaceModel({
      EXO_WORKSPACE_ROOT: fixtureLabRoot,
      EXO_NOTE_ROOTS: path.join(fixtureLabRoot, "notes/shoshin-codex"),
      EXO_PROJECT_ROOTS: path.join(fixtureLabRoot, "projects"),
    });

    expect(model.workspaceRoot).toBe(fixtureLabRoot);
    expect(model.defaultTerminalCwd).toBe(fixtureLabRoot);
    expect(model.noteRoots).toHaveLength(1);
  });

  it("lists markdown tree nodes", async () => {
    const nodes = await listRootTree(path.join(fixtureLabRoot, "notes/shoshin-codex"), { markdownOnly: true });
    expect(nodes.some((node) => node.name === "focus-note.md")).toBe(true);
  });

  it("searches notes by content and title", async () => {
    const model = resolveWorkspaceModel({
      EXO_WORKSPACE_ROOT: fixtureLabRoot,
      EXO_NOTE_ROOTS: path.join(fixtureLabRoot, "notes/shoshin-codex"),
      EXO_PROJECT_ROOTS: path.join(fixtureLabRoot, "projects"),
    });

    const results = await searchNotes(model, "agent memory");
    expect(results.some((result) => result.title === "Focus Note")).toBe(true);
    expect(results.every((result) => result.kind === "note")).toBe(true);
  });

  it("searches project files by path and content", async () => {
    const model = resolveWorkspaceModel({
      EXO_WORKSPACE_ROOT: fixtureLabRoot,
      EXO_NOTE_ROOTS: path.join(fixtureLabRoot, "notes/shoshin-codex"),
      EXO_PROJECT_ROOTS: path.join(fixtureLabRoot, "projects"),
    });

    const results = await searchProjectFiles(model, "demo");
    expect(results.some((result) => result.title === "demo.ts")).toBe(true);
    expect(results.every((result) => result.kind === "project-file")).toBe(true);
  });

  it("returns sectioned workspace search results", async () => {
    const model = resolveWorkspaceModel({
      EXO_WORKSPACE_ROOT: fixtureLabRoot,
      EXO_NOTE_ROOTS: path.join(fixtureLabRoot, "notes/shoshin-codex"),
      EXO_PROJECT_ROOTS: path.join(fixtureLabRoot, "projects"),
    });

    const results = await searchWorkspace(model, "research");
    expect(results.notes.length).toBeGreaterThan(0);
    expect(results.tags.length).toBeGreaterThan(0);
  });
});
