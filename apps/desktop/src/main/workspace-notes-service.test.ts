import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";

import type { WorkspaceModel } from "@exo/core";
import { WorkspaceNotesService } from "./workspace-notes-service";

describe("WorkspaceNotesService", () => {
  it("searches body and frontmatter tags across note roots", async () => {
    const { service, noteRoot } = await workspaceNotesService();
    await writeFile(path.join(noteRoot, "focus.md"), "---\ntags: [research]\n---\n# Focus\n\n#daily\n", "utf8");
    await writeFile(path.join(noteRoot, "other.md"), "# Other\n\nNo match.\n", "utf8");

    await expect(service.searchTag("#research")).resolves.toEqual([
      expect.objectContaining({ title: "Focus", snippet: "#research", kind: "tag" }),
    ]);
    await expect(service.searchTag("daily")).resolves.toEqual([
      expect.objectContaining({ title: "Focus", snippet: "#daily", kind: "tag" }),
    ]);
  });

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
    await expect(readFile(createdPath, "utf8")).resolves.toMatch(/^---\ndate: \d{4}-\d{2}-\d{2}\ntags: \[\]\n---\n\n# new target\n$/);
  });

  it("rejects wiki targets that traverse outside the source note root", async () => {
    const { service, noteRoot } = await workspaceNotesService();
    const sourcePath = path.join(noteRoot, "folder", "source.md");
    const outsidePath = path.join(path.dirname(noteRoot), "outside.md");
    await writeFile(sourcePath, "# Source\n", "utf8");
    await writeFile(outsidePath, "# Outside\n", "utf8");

    await expect(service.resolveTarget(sourcePath, "../../outside")).rejects.toThrow(
      "outside configured note roots",
    );
  });

  it("creates a missing absolute wiki target at its requested in-root path", async () => {
    const { service, noteRoot } = await workspaceNotesService();
    const sourcePath = path.join(noteRoot, "folder", "source.md");
    const targetPath = path.join(noteRoot, "elsewhere", "absolute.md");
    await writeFile(sourcePath, "# Source\n", "utf8");

    const createdPath = await service.ensureTarget(sourcePath, targetPath);

    expect(createdPath).toBe(targetPath);
    await expect(readFile(targetPath, "utf8")).resolves.toMatch(/^---\ndate: \d{4}-\d{2}-\d{2}\ntags: \[\]\n---\n\n# absolute\n$/);
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
    noteRoots: [{ id: "note-root-1", label: "notes", path: noteRoot }],
    indexedRoots: [],
    indexing: { enabled: false, mode: "off", backend: "qmd" },
  };
  return {
    noteRoot,
    service: new WorkspaceNotesService({ getWorkspaceModel: () => model }),
  };
}
