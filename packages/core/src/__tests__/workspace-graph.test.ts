import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { WorkspaceGraph } from "../workspace-graph";
import type { WorkspaceModel } from "../types";

const roots: string[] = [];
afterEach(async () => { await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))); });

describe("WorkspaceGraph", () => {
  it("resolves root-relative links and refuses duplicate basename guessing", async () => {
    const workspace = await mkdtemp(path.join(os.tmpdir(), "exo-workspace-graph-"));
    roots.push(workspace);
    const notes = path.join(workspace, "notes");
    await mkdir(path.join(notes, "one"), { recursive: true });
    await mkdir(path.join(notes, "two"), { recursive: true });
    await writeFile(path.join(notes, "index.md"), "[[one/duplicate]] [[duplicate]] [[missing]]\n[index](one/duplicate.md)");
    await writeFile(path.join(notes, "one", "duplicate.md"), "# One");
    await writeFile(path.join(notes, "two", "duplicate.md"), "# Two");
    const graph = new WorkspaceGraph(model(workspace, notes));
    const context = await graph.contextForNote(path.join(notes, "index.md"));
    expect(context?.note.id).toBe("note:notes:index.md");
    expect(context?.outgoing.map((link) => link.resolution)).toEqual(["resolved", "ambiguous", "unresolved", "resolved"]);
    expect(context?.outgoing[0]?.note?.id).toBe("note:notes:one/duplicate.md");
    expect((await graph.backlinks(path.join(notes, "one", "duplicate.md"))).length).toBe(2);
    expect((await graph.status()).noteCount).toBe(3);
  });

  it("labels backlinks with the linking note title while preserving its target", async () => {
    const workspace = await mkdtemp(path.join(os.tmpdir(), "exo-workspace-graph-"));
    roots.push(workspace);
    const notes = path.join(workspace, "notes");
    await mkdir(notes, { recursive: true });
    await writeFile(path.join(notes, "focus.md"), "# Focus\n");
    await writeFile(path.join(notes, "related.md"), "---\ntitle: Related Note\n---\n[[focus]]\n");
    const context = await new WorkspaceGraph(model(workspace, notes)).contextForNote(path.join(notes, "focus.md"));
    expect(context?.backlinks).toEqual([
      expect.objectContaining({ label: "Related Note", target: path.join(notes, "related.md") }),
    ]);
  });
});

function model(workspaceRoot: string, notes: string): WorkspaceModel {
  return { workspaceRoot, defaultTerminalCwd: workspaceRoot, noteRoots: [{ id: "notes", label: "Notes", path: notes }], indexedRoots: [], indexing: { enabled: false, mode: "off", backend: "qmd" }, attachedWorkcells: [] };
}
