import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { listRootTree, resolveWorkspaceModel, searchNotes, searchProjectFiles, searchWorkspace } from "../workspace";

const fixtureLabRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../../fixtures/workspace/lab");

describe("workspace", () => {
  it("resolves the default workspace model from env", () => {
    const model = resolveWorkspaceModel({
      EXO_WORKSPACE_ROOT: fixtureLabRoot,
      EXO_NOTE_ROOTS: path.join(fixtureLabRoot, "notes/vault"),
      EXO_PROJECT_ROOTS: path.join(fixtureLabRoot, "projects/exo-demo"),
    });

    expect(model.workspaceRoot).toBe(fixtureLabRoot);
    expect(model.defaultTerminalCwd).toBe(fixtureLabRoot);
    expect(model.noteRoots).toHaveLength(1);
  });

  it("attaches Exo as the default project root when project roots are not configured", () => {
    const model = resolveWorkspaceModel({
      EXO_WORKSPACE_ROOT: fixtureLabRoot,
      EXO_NOTE_ROOTS: path.join(fixtureLabRoot, "notes/vault"),
    });

    expect(model.projectRoots).toEqual([
      {
        id: "project-root-1",
        label: "exo",
        path: path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../.."),
        kind: "projects",
      },
    ]);
  });

  it("allows project roots to be explicitly empty", () => {
    const model = resolveWorkspaceModel({
      EXO_WORKSPACE_ROOT: fixtureLabRoot,
      EXO_NOTE_ROOTS: path.join(fixtureLabRoot, "notes/vault"),
      EXO_PROJECT_ROOTS: "",
    });

    expect(model.projectRoots).toEqual([]);
  });

  it("uses portable workspace defaults when env is absent", () => {
    const model = resolveWorkspaceModel({});

    expect(model.workspaceRoot).toBe(process.cwd());
    expect(model.defaultTerminalCwd).toBe(process.cwd());
    expect(model.noteRoots).toEqual([
      {
        id: "note-root-1",
        label: "notes",
        path: path.join(process.cwd(), "notes"),
        kind: "notes",
      },
    ]);
    expect(model.projectRoots[0]?.path).toBe(path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../.."));
  });

  it("lists markdown tree nodes", async () => {
    const nodes = await listRootTree(path.join(fixtureLabRoot, "notes/vault"), { markdownOnly: true });
    expect(nodes.some((node) => node.name === "focus-note.md")).toBe(true);
  });

  it("searches notes by title and path", async () => {
    const model = resolveWorkspaceModel({
      EXO_WORKSPACE_ROOT: fixtureLabRoot,
      EXO_NOTE_ROOTS: path.join(fixtureLabRoot, "notes/vault"),
      EXO_PROJECT_ROOTS: path.join(fixtureLabRoot, "projects/exo-demo"),
    });

    const results = await searchNotes(model, "focus-note");
    expect(results.some((result) => result.title === "focus-note")).toBe(true);
    expect(results.every((result) => result.kind === "note")).toBe(true);
  });

  it("searches project files by path and content", async () => {
    const model = resolveWorkspaceModel({
      EXO_WORKSPACE_ROOT: fixtureLabRoot,
      EXO_NOTE_ROOTS: path.join(fixtureLabRoot, "notes/vault"),
      EXO_PROJECT_ROOTS: path.join(fixtureLabRoot, "projects/exo-demo"),
    });

    const results = await searchProjectFiles(model, "demo");
    expect(results.some((result) => result.title === "demo.ts")).toBe(true);
    expect(results.every((result) => result.kind === "project-file")).toBe(true);
  });

  it("returns note-only workspace search results", async () => {
    const model = resolveWorkspaceModel({
      EXO_WORKSPACE_ROOT: fixtureLabRoot,
      EXO_NOTE_ROOTS: path.join(fixtureLabRoot, "notes/vault"),
      EXO_PROJECT_ROOTS: path.join(fixtureLabRoot, "projects/exo-demo"),
    });

    const results = await searchWorkspace(model, "focus-note");
    expect(results.notes.length).toBeGreaterThan(0);
    expect(results.projectFiles).toEqual([]);
    expect(results.tags).toEqual([]);
  });
});
