import { writeFileSync } from "node:fs";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { GRAPH_CONCEPT_SUMMARY_MAX_BYTES } from "../graph-projection";
import { WorkspaceGraph, workspaceNoteId } from "../workspace-graph";
import { WorkspaceOntologyStore } from "../workspace-ontology";
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

    expect(snapshot.version).toBe("0.3");
    expect(snapshot.snapshotId).toBe(second.snapshotId);
    expect(metric).toMatchObject({
      conceptTypes: ["Metric", "NorthStar"],
      properties: { unknown: { nested: ["keep", 7] } },
    });
    expect(snapshot.concepts).toContainEqual(expect.objectContaining({ id: "tag:growth", conceptTypes: ["tag"] }));
    expect(snapshot.relations).toEqual(expect.arrayContaining([
      expect.objectContaining({
        family: "link",
        origin: "document",
        resolution: "resolved",
        evidence: [expect.objectContaining({ kind: "source-span", detail: "source" })],
      }),
      expect.objectContaining({ family: "tag-membership", predicate: "has-tag", origin: "document" }),
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

  it("uses only an explicitly kept Ontology and ignores later candidate edits", async () => {
    const workspace = await mkdtemp(path.join(os.tmpdir(), "exo-workspace-ontology-"));
    roots.push(workspace);
    const notes = path.join(workspace, "notes");
    const runtimeRoot = path.join(workspace, ".exo-test");
    await mkdir(notes);
    const sourcePath = path.join(notes, "source.md");
    const sourceBytes = "---\ntype: paper\nsupports: [missing]\n---\n# Source\n";
    await writeFile(sourcePath, sourceBytes);
    await writeFile(path.join(workspace, "ontology.yaml"), [
      "ontology_schema: 1",
      "id: research",
      "version: 1",
      "types:",
      "  paper: {}",
      "properties:",
      "  supports:",
      "    value: reference[]",
      "    predicate: supports",
    ].join("\n"));

    const beforeKeep = await new WorkspaceGraph(model(workspace, notes), { runtimeRoot }).knowledgeSnapshot();
    expect(beforeKeep.activeOntology).toEqual({ state: "generic" });
    expect(beforeKeep.relations.some((relation) => relation.origin === "ontology")).toBe(false);

    const store = new WorkspaceOntologyStore({ workspaceRoot: workspace, runtimeRoot });
    const candidate = await store.inspectCandidate();
    await store.keepCandidate(candidate.sourceRevision ?? "");
    const activeGraph = new WorkspaceGraph(model(workspace, notes), { runtimeRoot });
    const active = await activeGraph.knowledgeSnapshot();
    const activeTopology = await activeGraph.graphTopology();
    expect(active.activeOntology).toMatchObject({ state: "active", id: "research" });
    expect(active.relations).toContainEqual(expect.objectContaining({ origin: "ontology", resolution: "unresolved" }));
    const ids = new Set(active.concepts.map((concept) => concept.id));
    expect(active.relations.every((relation) => ids.has(relation.source) && ids.has(relation.target))).toBe(true);

    await writeFile(path.join(workspace, "ontology.yaml"), "ontology_schema: 1\nid: replacement\nversion: 2\n");
    const candidateGraph = new WorkspaceGraph(model(workspace, notes), { runtimeRoot });
    const candidateOnly = await candidateGraph.knowledgeSnapshot();
    const candidateTopology = await candidateGraph.graphTopology();
    expect(candidateOnly.snapshotId).toBe(active.snapshotId);
    expect(candidateOnly.activeOntology).toEqual(active.activeOntology);
    expect(candidateTopology.topologyHash).toBe(activeTopology.topologyHash);
    expect(candidateTopology.layoutEpochId).toBe(activeTopology.layoutEpochId);
    expect(await readFile(sourcePath, "utf8")).toBe(sourceBytes);
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

  it("rejects bounded concept detail from a stale graph epoch", async () => {
    const workspace = await mkdtemp(path.join(os.tmpdir(), "exo-workspace-graph-"));
    roots.push(workspace);
    const notes = path.join(workspace, "notes");
    await mkdir(notes, { recursive: true });
    const notePath = path.join(notes, "focus.md");
    await writeFile(notePath, "# Focus\n");
    const graph = new WorkspaceGraph(model(workspace, notes));
    const first = await graph.graphTopology();
    await writeFile(notePath, "# Changed\n");
    await graph.refreshFile(notePath);

    await expect(graph.graphConceptDetailByIndex(0, first.sourceSnapshotId)).resolves.toMatchObject({
      status: "stale",
      index: 0,
    });
  });

  it("serves cold summaries and bounded evidenced detail by topology index", async () => {
    const workspace = await mkdtemp(path.join(os.tmpdir(), "exo-workspace-graph-"));
    roots.push(workspace);
    const notes = path.join(workspace, "notes");
    await mkdir(notes, { recursive: true });
    const properties = Array.from({ length: 70 }, (_, index) => `property_${String(index).padStart(2, "0")}: value-${index}`);
    const links = [
      ...Array.from({ length: 140 }, () => "[[target]]"),
      ...Array.from({ length: 70 }, () => "[[missing]]"),
    ].join(" ");
    const focusPath = path.join(notes, "focus.md");
    await writeFile(focusPath, ["---", "title: Focus", "type: Document", ...properties, "---", links].join("\n"));
    await writeFile(path.join(notes, "target.md"), "# Target\n");
    const graph = new WorkspaceGraph(model(workspace, notes));

    const firstTopology = await graph.graphTopology("okf");
    const secondTopology = await graph.graphTopology("okf");
    expect(firstTopology.nodes.identityKeys.byteLength).toBeGreaterThan(0);
    expect(firstTopology.nodes.identityKeys).toBe(secondTopology.nodes.identityKeys);
    expect(firstTopology.transportHash).toBe(secondTopology.transportHash);
    const summaries = await graph.graphConceptSummaries(
      Array.from({ length: firstTopology.nodeCount }, (_, index) => index),
      firstTopology.sourceSnapshotId,
      "okf",
    );
    expect(summaries.status).toBe("ok");
    const focusIndex = summaries.summaries.find((summary) => summary.label === "Focus")?.index;
    expect(focusIndex).toBeTypeOf("number");
    const detail = await graph.graphConceptDetailByIndex(focusIndex ?? -1, firstTopology.sourceSnapshotId, "okf");

    expect(detail.status).toBe("ok");
    expect(detail.payloadBytes).toBeLessThanOrEqual(256 * 1024);
    expect(detail.detail?.profile).toMatchObject({ id: "okf", version: "0.1" });
    expect(detail.detail?.properties).toHaveLength(64);
    expect(detail.detail?.relations).toHaveLength(128);
    expect(detail.detail?.findings).toHaveLength(64);
    expect(detail.detail?.omitted).toMatchObject({ properties: 8, relations: 82, findings: 6, evidence: 88 });
    expect(detail.detail?.relations[0]).toMatchObject({
      direction: "outgoing",
      relation: {
        origin: "document",
        evidence: [expect.objectContaining({ kind: "source-span", noteId: "note:notes:focus.md" })],
      },
    });

    await expect(graph.graphConceptSummaries([999], firstTopology.sourceSnapshotId, "okf")).resolves.toMatchObject({ status: "missing" });
    await expect(graph.graphConceptSummaries(Array.from({ length: 65 }, (_, index) => index), firstTopology.sourceSnapshotId, "okf"))
      .rejects.toThrow("limited to 64 nodes");

    await writeFile(focusPath, "# Changed\n");
    await graph.refreshFile(focusPath);
    await expect(graph.graphConceptDetailByIndex(focusIndex ?? -1, firstTopology.sourceSnapshotId, "okf"))
      .resolves.toMatchObject({ status: "stale" });
    await expect(graph.graphConceptSummaries([focusIndex ?? -1], firstTopology.sourceSnapshotId, "okf"))
      .resolves.toMatchObject({ status: "stale" });
  });

  it("reports an oversized cold summary explicitly without leaking it into topology", async () => {
    const workspace = await mkdtemp(path.join(os.tmpdir(), "exo-workspace-graph-"));
    roots.push(workspace);
    const notes = path.join(workspace, "notes");
    await mkdir(notes, { recursive: true });
    const hugeTitle = `secret-${"x".repeat(70 * 1024)}`;
    await writeFile(path.join(notes, "huge.md"), `---\ntitle: ${hugeTitle}\n---\n`);
    const graph = new WorkspaceGraph(model(workspace, notes));
    const topology = await graph.graphTopology();

    expect(JSON.stringify(topology)).not.toContain("secret-");
    await expect(graph.graphConceptSummaries([0], topology.sourceSnapshotId)).resolves.toMatchObject({
      status: "too-large",
      summaries: [],
    });
  });

  it("looks up cold concept identity by id or normalized file path in one cached topology epoch", async () => {
    const workspace = await mkdtemp(path.join(os.tmpdir(), "exo-workspace-graph-"));
    roots.push(workspace);
    const notes = path.join(workspace, "notes");
    const folder = path.join(notes, "Folder");
    await mkdir(folder, { recursive: true });
    const focusPath = path.join(folder, "Focus.md");
    await writeFile(focusPath, "# Focus\n");
    const graph = new WorkspaceGraph(model(workspace, notes));
    const topology = await graph.graphTopology();
    const conceptId = workspaceNoteId("notes", "folder/focus.md");

    const byId = await graph.graphConceptLookup({ conceptId }, topology.sourceSnapshotId);
    const byPath = await graph.graphConceptLookup(
      { filePath: path.join(folder, "..", "Folder", "Focus.md") },
      topology.sourceSnapshotId,
    );

    expect(byId).toMatchObject({ status: "ok", summary: { index: 0, label: "Focus", filePath: focusPath } });
    expect(byPath).toEqual(byId);
    expect(byId.payloadBytes).toBe(Buffer.byteLength(JSON.stringify(byId), "utf8"));
    await expect(graph.graphConceptLookup({ conceptId: "missing" }, topology.sourceSnapshotId))
      .resolves.toMatchObject({ status: "missing" });
    await expect(graph.graphConceptLookup({ filePath: path.join(notes, "missing.md") }, topology.sourceSnapshotId))
      .resolves.toMatchObject({ status: "missing" });
    await expect(graph.graphConceptLookup({} as never, topology.sourceSnapshotId)).rejects.toThrow("exactly one");
    await expect(graph.graphConceptLookup({ conceptId, filePath: focusPath } as never, topology.sourceSnapshotId)).rejects.toThrow("exactly one");
    await expect(graph.graphConceptLookup({ conceptId: "" }, topology.sourceSnapshotId)).rejects.toThrow("must not be empty");

    await writeFile(focusPath, "# Changed\n");
    await graph.refreshFile(focusPath);
    await expect(graph.graphConceptLookup({ conceptId }, topology.sourceSnapshotId))
      .resolves.toMatchObject({ status: "stale" });
    const refreshedTopology = await graph.graphTopology();
    await expect(graph.graphConceptLookup({ conceptId }, refreshedTopology.sourceSnapshotId))
      .resolves.toMatchObject({ status: "ok", summary: { label: "Changed" } });
  });

  it("enforces the exact cold concept lookup payload byte cap", async () => {
    const workspace = await mkdtemp(path.join(os.tmpdir(), "exo-workspace-graph-"));
    roots.push(workspace);
    const notes = path.join(workspace, "notes");
    await mkdir(notes, { recursive: true });
    const hugePath = path.join(notes, "huge.md");
    await writeFile(hugePath, "---\ntitle: x\n---\n");
    const graph = new WorkspaceGraph(model(workspace, notes));
    let topology = await graph.graphTopology();
    const baseline = await graph.graphConceptLookup({ filePath: hugePath }, topology.sourceSnapshotId);
    expect(baseline.status).toBe("ok");
    let titleLength = GRAPH_CONCEPT_SUMMARY_MAX_BYTES;
    for (let iteration = 0; iteration < 4; iteration += 1) {
      const candidate = { ...baseline, summary: { ...baseline.summary, label: "x".repeat(titleLength) }, payloadBytes: 0 };
      let bytes = Buffer.byteLength(JSON.stringify(candidate), "utf8");
      for (let sizeIteration = 0; sizeIteration < 3; sizeIteration += 1) {
        candidate.payloadBytes = bytes;
        bytes = Buffer.byteLength(JSON.stringify(candidate), "utf8");
      }
      titleLength -= bytes - GRAPH_CONCEPT_SUMMARY_MAX_BYTES;
    }

    await writeFile(hugePath, `---\ntitle: ${"x".repeat(titleLength)}\n---\n`);
    await graph.refreshFile(hugePath);
    topology = await graph.graphTopology();
    const atLimit = await graph.graphConceptLookup({ filePath: hugePath }, topology.sourceSnapshotId);
    expect(atLimit.payloadBytes).toBe(GRAPH_CONCEPT_SUMMARY_MAX_BYTES);

    await writeFile(hugePath, `---\ntitle: ${"x".repeat(titleLength + 1)}\n---\n`);
    await graph.refreshFile(hugePath);
    topology = await graph.graphTopology();
    await expect(graph.graphConceptLookup({ filePath: hugePath }, topology.sourceSnapshotId))
      .rejects.toThrow("65536-byte limit");
  });
});

function model(workspaceRoot: string, notes: string): WorkspaceModel {
  return { workspaceRoot, defaultTerminalCwd: workspaceRoot, noteRoots: [{ id: "notes", label: "Notes", path: notes }], indexedRoots: [], indexing: { enabled: false, mode: "off", backend: "qmd" } };
}
