import { writeFileSync } from "node:fs";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { WorkspaceGraph, workspaceNoteId } from "../workspace-graph";
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
      expect.objectContaining({
        label: "Related Note",
        target: path.join(notes, "related.md"),
        note: expect.objectContaining({ filePath: path.join(notes, "related.md") }),
      }),
    ]);
    expect(context?.neighborhood.map((note) => note.filePath)).toEqual([
      path.join(notes, "focus.md"),
      path.join(notes, "related.md"),
    ]);
  });

  it("includes a backlink-only source in the target note neighborhood", async () => {
    const workspace = await mkdtemp(path.join(os.tmpdir(), "exo-workspace-graph-"));
    roots.push(workspace);
    const notes = path.join(workspace, "notes");
    await mkdir(notes, { recursive: true });
    const targetPath = path.join(notes, "target.md");
    const sourcePath = path.join(notes, "source.md");
    await writeFile(targetPath, "# Target\n");
    await writeFile(sourcePath, "# Source\n\n[[target]]\n");

    const context = await new WorkspaceGraph(model(workspace, notes)).contextForNote(targetPath);

    expect(context?.outgoing).toEqual([]);
    expect(context?.backlinks).toHaveLength(1);
    expect(context?.backlinks[0]).toMatchObject({
      source: "note:notes:source.md",
      target: sourcePath,
      note: { id: "note:notes:source.md", filePath: sourcePath },
    });
    expect(context?.neighborhood.map((note) => note.id)).toEqual([
      "note:notes:source.md",
      "note:notes:target.md",
    ]);
  });

  it("refreshes only the changed note in an existing snapshot", async () => {
    const workspace = await mkdtemp(path.join(os.tmpdir(), "exo-workspace-graph-"));
    roots.push(workspace);
    const notes = path.join(workspace, "notes");
    await mkdir(notes, { recursive: true });
    const focusPath = path.join(notes, "focus.md");
    const firstTargetPath = path.join(notes, "first.md");
    const secondTargetPath = path.join(notes, "second.md");
    const unrelatedPath = path.join(notes, "unrelated.md");
    await writeFile(focusPath, "# Focus\n\n[[first]]\n");
    await writeFile(firstTargetPath, "# First\n");
    await writeFile(secondTargetPath, "# Second\n");
    await writeFile(unrelatedPath, "# Unrelated\n");
    const graph = new WorkspaceGraph(model(workspace, notes));

    expect((await graph.contextForNote(focusPath))?.outgoing[0]?.note?.filePath).toBe(firstTargetPath);
    await rm(unrelatedPath);
    await writeFile(focusPath, "# Focus\n\n[[second]]\n");

    await graph.refreshFile(focusPath);

    expect((await graph.contextForNote(focusPath))?.outgoing[0]?.note?.filePath).toBe(secondTargetPath);
    expect(await graph.contextForNote(unrelatedPath)).not.toBeNull();
    await expect(graph.status()).resolves.toMatchObject({ state: "ready", noteCount: 4 });
  });

  it("applies a file refresh that arrives while a rebuild is in flight", async () => {
    const workspace = await mkdtemp(path.join(os.tmpdir(), "exo-workspace-graph-"));
    roots.push(workspace);
    const notes = path.join(workspace, "notes");
    await mkdir(notes, { recursive: true });
    const focusPath = path.join(notes, "focus.md");
    const targetPath = path.join(notes, "target.md");
    await writeFile(focusPath, "# Focus\n");
    await writeFile(targetPath, "# Target\n");
    const graph = new WorkspaceGraph(model(workspace, notes));
    await graph.contextForNote(focusPath);

    const rebuild = graph.rebuild();
    await expect(graph.status()).resolves.toMatchObject({ state: "building" });
    writeFileSync(focusPath, "# Focus\n\n[[target]]\n", "utf8");
    const refresh = graph.refreshFile(focusPath);
    await Promise.all([rebuild, refresh]);

    expect((await graph.contextForNote(focusPath))?.outgoing[0]?.note?.filePath).toBe(targetPath);
    await expect(graph.status()).resolves.toMatchObject({ state: "ready", noteCount: 2 });
  });

  it("projects open concepts, lossless properties, authored evidence, and deterministic identity", async () => {
    const workspace = await mkdtemp(path.join(os.tmpdir(), "exo-workspace-graph-"));
    roots.push(workspace);
    const notes = path.join(workspace, "notes");
    await mkdir(notes, { recursive: true });
    await writeFile(
      path.join(notes, "metric.md"),
      [
        "---",
        "title: Activation",
        "type: [Metric, NorthStar]",
        "unknown:",
        "  nested:",
        "    - keep",
        "    - 7",
        "tags: [growth]",
        "---",
        "",
        "[[source]] [[missing]]",
      ].join("\n"),
    );
    await writeFile(path.join(notes, "source.md"), "---\ntype: Evidence\n---\n# Source\n");
    const graph = new WorkspaceGraph(model(workspace, notes));

    const snapshot = await graph.knowledgeSnapshot();
    const second = await graph.knowledgeSnapshot();
    const metric = snapshot.concepts.find((concept) => concept.label === "Activation");

    expect(snapshot.version).toBe("0.2");
    expect(snapshot.snapshotId).toBe(second.snapshotId);
    expect(metric).toMatchObject({
      conceptTypes: ["Metric", "NorthStar"],
      properties: { unknown: { nested: ["keep", 7] } },
    });
    expect(snapshot.concepts).toContainEqual(expect.objectContaining({ id: "tag:growth", conceptTypes: ["tag"] }));
    expect(snapshot.relations).toEqual(expect.arrayContaining([
      expect.objectContaining({
        family: "link",
        authority: "authored",
        resolution: "resolved",
        evidence: [expect.objectContaining({ kind: "source-span", detail: "source" })],
      }),
      expect.objectContaining({ family: "tag-membership", predicate: "has-tag", authority: "authored" }),
    ]));
    expect(snapshot.findings).toContainEqual(expect.objectContaining({ code: "relation.unresolved" }));
  });

  it("interprets OKF permissively while reporting its missing type requirement", async () => {
    const workspace = await mkdtemp(path.join(os.tmpdir(), "exo-workspace-graph-"));
    roots.push(workspace);
    const notes = path.join(workspace, "notes");
    await mkdir(notes, { recursive: true });
    await writeFile(path.join(notes, "typed.md"), "---\ntype: CustomThing\nproducer_field: keep\n---\n# Typed\n");
    await writeFile(path.join(notes, "untyped.md"), "---\nunknown: survives\n---\n# Untyped\n");

    const snapshot = await new WorkspaceGraph(model(workspace, notes)).knowledgeSnapshot("okf");

    expect(snapshot.activeProfile).toMatchObject({ id: "okf", version: "0.1" });
    expect(snapshot.concepts.find((concept) => concept.label === "Typed")?.properties).toMatchObject({ producer_field: "keep" });
    expect(snapshot.findings).toContainEqual(expect.objectContaining({ code: "okf.missing-type", conceptIds: ["note:notes:untyped.md"] }));
  });

  it("preserves stable relation identity when a different link is inserted earlier", async () => {
    const workspace = await mkdtemp(path.join(os.tmpdir(), "exo-workspace-graph-"));
    roots.push(workspace);
    const notes = path.join(workspace, "notes");
    await mkdir(notes, { recursive: true });
    const sourcePath = path.join(notes, "source.md");
    await writeFile(path.join(notes, "other.md"), "# Other\n");
    await writeFile(path.join(notes, "target.md"), "# Target\n");
    await writeFile(sourcePath, "[[target]]\n");
    const graph = new WorkspaceGraph(model(workspace, notes));
    const before = await graph.knowledgeSnapshot();
    const relationBefore = before.relations.find((relation) => relation.target.endsWith(":target.md"));

    await writeFile(sourcePath, "[[other]]\n[[target]]\n");
    await graph.refreshFile(sourcePath);
    const after = await graph.knowledgeSnapshot();
    const relationAfter = after.relations.find((relation) => relation.target.endsWith(":target.md"));

    expect(relationAfter?.id).toBe(relationBefore?.id);
  });

  it("preserves path case in concept identity", () => {
    expect(workspaceNoteId("notes", "Folder/Foo.md")).not.toBe(workspaceNoteId("notes", "folder/foo.md"));
  });

  it("rejects concept detail from a stale graph epoch", async () => {
    const workspace = await mkdtemp(path.join(os.tmpdir(), "exo-workspace-graph-"));
    roots.push(workspace);
    const notes = path.join(workspace, "notes");
    await mkdir(notes, { recursive: true });
    const notePath = path.join(notes, "focus.md");
    await writeFile(notePath, "# Focus\n");
    const graph = new WorkspaceGraph(model(workspace, notes));
    const first = await graph.graphView();
    const conceptId = first.projection.nodes[0]?.id ?? "";
    await writeFile(notePath, "# Changed\n");
    await graph.refreshFile(notePath);

    await expect(graph.graphConceptDetail(conceptId, first.projection.sourceSnapshotId)).resolves.toBeNull();
  });
});

function model(workspaceRoot: string, notes: string): WorkspaceModel {
  return { workspaceRoot, defaultTerminalCwd: workspaceRoot, noteRoots: [{ id: "notes", label: "Notes", path: notes }], indexedRoots: [], indexing: { enabled: false, mode: "off", backend: "qmd" } };
}
