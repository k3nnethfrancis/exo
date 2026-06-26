import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";

import type { WorkspaceModel } from "@exo/core";
import { WorkspaceNotesService } from "./workspace-notes-service";

describe("WorkspaceNotesService", () => {
  it("resolves relative targets before falling back to note basename search", async () => {
    const { service, noteRoot } = await workspaceNotesService();
    const sourcePath = path.join(noteRoot, "folder", "source.md");
    const relativeTarget = path.join(noteRoot, "folder", "target.md");
    const basenameTarget = path.join(noteRoot, "elsewhere.md");
    await writeFile(sourcePath, "# Source\n", "utf8");
    await writeFile(relativeTarget, "# Target\n", "utf8");
    await writeFile(basenameTarget, "# Elsewhere\n", "utf8");

    await expect(service.resolveTarget(sourcePath, "target")).resolves.toBe(relativeTarget);
    await expect(service.resolveTarget(sourcePath, "elsewhere")).resolves.toBe(basenameTarget);
    await expect(service.resolveTarget(sourcePath, "https://example.com")).resolves.toBeNull();
  });

  it("creates missing wiki targets next to the source note by default", async () => {
    const { service, noteRoot } = await workspaceNotesService();
    const sourcePath = path.join(noteRoot, "folder", "source.md");
    await writeFile(sourcePath, "# Source\n", "utf8");

    const createdPath = await service.ensureTarget(sourcePath, "new target");

    expect(createdPath).toBe(path.join(noteRoot, "folder", "new target.md"));
    await expect(readFile(createdPath, "utf8")).resolves.toBe("");
  });

  it("suggests exact target matches before partial matches", async () => {
    const { service, noteRoot } = await workspaceNotesService();
    const sourcePath = path.join(noteRoot, "source.md");
    await writeFile(sourcePath, "# Source\n", "utf8");
    await writeFile(path.join(noteRoot, "agent.md"), "# Agent\n", "utf8");
    await writeFile(path.join(noteRoot, "agent-notes.md"), "# Agent Notes\n", "utf8");

    const suggestions = await service.suggestTargets(sourcePath, "agent");

    expect(suggestions.map((suggestion) => suggestion.target)).toEqual(["agent", "agent-notes"]);
  });
});

async function workspaceNotesService() {
  const workspaceRoot = await mkdtemp(path.join(os.tmpdir(), "exo-notes-service-"));
  const noteRoot = path.join(workspaceRoot, "notes");
  await import("node:fs/promises").then(({ mkdir }) => mkdir(path.join(noteRoot, "folder"), { recursive: true }));
  const model: WorkspaceModel = {
    workspaceRoot,
    defaultTerminalCwd: workspaceRoot,
    noteRoots: [{ id: "note-root-1", label: "notes", path: noteRoot, kind: "notes" }],
    projectRoots: [],
    indexedRoots: [],
    indexing: { enabled: false, mode: "off", backend: "qmd" },
    attachedWorkcells: [],
  };
  return {
    noteRoot,
    service: new WorkspaceNotesService({ getWorkspaceModel: () => model }),
  };
}
