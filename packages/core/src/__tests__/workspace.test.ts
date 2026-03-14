import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { listRootTree, resolveWorkspaceModel, searchNotes } from "../workspace";

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
  });
});
