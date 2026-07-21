import { createHash } from "node:crypto";
import { cp, mkdir, mkdtemp, readFile, readdir, rm, unlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { readWorkspaceDocument } from "../notes";
import type { RelationEdge } from "../knowledge-graph";
import type { WorkspaceModel } from "../types";
import { WorkspaceGraph } from "../workspace-graph";
import { WorkspaceOntologyStore } from "../workspace-ontology";

const fixtureRoot = path.join(import.meta.dirname, "fixtures", "interoperability");
const temporaryRoots: string[] = [];

interface FixtureManifestFile {
  destination: string;
  sha256: string;
}

interface FixtureManifest {
  schema: number;
  sources: Array<{
    id: string;
    repository: string;
    revision: string;
    license: string;
    files: FixtureManifestFile[];
    licenseDestination?: string;
    licenseSha256?: string;
  }>;
  localCases: Array<{
    directory: string;
    files: Record<string, string>;
  }>;
}

afterEach(async () => {
  await Promise.all(temporaryRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("public graph interoperability fixtures", () => {
  it("pins every public and local fixture byte to a source manifest", async () => {
    const manifest = JSON.parse(await readFile(path.join(fixtureRoot, "manifest.json"), "utf8")) as FixtureManifest;

    expect(manifest).toMatchObject({
      schema: 1,
      sources: [
        {
          id: "google-knowledge-catalog-okf-crypto-bitcoin",
          repository: "https://github.com/GoogleCloudPlatform/knowledge-catalog",
          revision: "d44368c15e38e7c92481c5992e4f9b5b421a801d",
          license: "Apache-2.0",
        },
        {
          id: "langchain-openwiki-deterministic-index-output",
          repository: "https://github.com/langchain-ai/openwiki",
          revision: "264ee8465f3c9874b822bcbb7ca68de471143798",
          license: "MIT",
        },
      ],
    });
    for (const source of manifest.sources) {
      for (const file of source.files) {
        await expect(fileSha256(path.join(fixtureRoot, file.destination))).resolves.toBe(file.sha256);
      }
      if (source.licenseDestination && source.licenseSha256) {
        await expect(fileSha256(path.join(fixtureRoot, source.licenseDestination))).resolves.toBe(source.licenseSha256);
      }
    }
    const publicFiles = (await collectFiles(fixtureRoot))
      .map((filePath) => path.relative(fixtureRoot, filePath))
      .filter((relativePath) => relativePath.startsWith("google-knowledge-catalog/")
        || relativePath.startsWith("langchain-openwiki/"))
      .sort();
    const manifestedPublicFiles = manifest.sources.flatMap((source) => [
      ...source.files.map(({ destination }) => destination),
      ...(source.licenseDestination ? [source.licenseDestination] : []),
    ]).sort();
    expect(publicFiles).toEqual(manifestedPublicFiles);
    for (const localCase of manifest.localCases) {
      for (const [relativePath, expected] of Object.entries(localCase.files)) {
        await expect(fileSha256(path.join(fixtureRoot, localCase.directory, relativePath))).resolves.toBe(expected);
      }
    }
  });

  it("projects the pinned Google slice as two open OKF Concepts with evidenced Relations", async () => {
    const bundle = path.join(fixtureRoot, "google-knowledge-catalog", "bundle");
    const before = await treeSha256(bundle);
    const graph = new WorkspaceGraph(workspaceModel(bundle, [{ id: "google", path: bundle }]));
    const first = await graph.knowledgeSnapshot("okf");
    const second = await graph.knowledgeSnapshot("okf");
    const noteConcepts = first.concepts.filter((concept) => concept.noteId);

    expect(first.snapshotId).toBe(second.snapshotId);
    expect(noteConcepts.map(({ relativePath }) => relativePath)).toEqual([
      "datasets/crypto_bitcoin.md",
      "tables/blocks.md",
    ]);
    expect(noteConcepts.map(({ conceptTypes }) => conceptTypes)).toEqual([
      ["BigQuery Dataset"],
      ["BigQuery Table"],
    ]);
    expect(first.findings.some(({ code }) => code === "okf.missing-type")).toBe(false);

    const dataset = noteConcepts.find(({ relativePath }) => relativePath === "datasets/crypto_bitcoin.md");
    expect(dataset?.label).toBe("Cryptocurrency Bitcoin");
    expect(dataset?.properties).toMatchObject({
      description: "This BigQuery public dataset contains a complete history of the Bitcoin blockchain and updates every 10 minutes.",
      resource: "https://bigquery.googleapis.com/v2/projects/bigquery-public-data/datasets/crypto_bitcoin",
      timestamp: "2026-05-28T22:44:47+00:00",
    });
    const tagRelations = first.relations.filter(({ family }) => family === "tag-membership");
    expect(tagRelations).toHaveLength(10);
    expect(new Set(tagRelations.map(({ target }) => target)).size).toBe(8);

    const datasetLinks = first.relations.filter((relation) => relation.family === "link" && relation.source === dataset?.id);
    expect(countByResolution(datasetLinks)).toEqual({ resolved: 2, unresolved: 6, external: 2 });
    expect(datasetLinks.filter(({ resolution }) => resolution === "resolved").map(({ target }) => target))
      .toEqual(["note:google:tables/blocks.md", "note:google:tables/blocks.md"]);
    const datasetDocument = await readWorkspaceDocument(path.join(bundle, "datasets", "crypto_bitcoin.md"));
    for (const relation of datasetLinks) {
      expect(relation).toMatchObject({ origin: "document", predicate: "references" });
      expect(relation.evidence).toHaveLength(1);
      const evidence = relation.evidence[0];
      expect(evidence).toMatchObject({
        kind: "source-span",
        noteId: dataset?.id,
        detail: expect.any(String),
        sourceRange: { from: expect.any(Number), to: expect.any(Number) },
      });
      expect(datasetDocument.body.slice(evidence?.sourceRange?.from, evidence?.sourceRange?.to))
        .toContain(`](${evidence?.detail})`);
    }
    expectRelationEndpoints(first.concepts.map(({ id }) => id), first.relations);
    expect(await treeSha256(bundle)).toBe(before);
  });

  it("keeps OpenWiki reserved files as Notes but excludes them only from the OKF Concept graph", async () => {
    const wiki = path.join(fixtureRoot, "langchain-openwiki", "wiki");
    const before = await treeSha256(wiki);
    const graph = new WorkspaceGraph(workspaceModel(wiki, [{ id: "openwiki", path: wiki }]));
    const generic = await graph.knowledgeSnapshot();
    const okf = await graph.knowledgeSnapshot("okf");

    expect(generic.concepts.filter(({ noteId }) => noteId).map(({ relativePath }) => relativePath)).toEqual([
      "architecture/index.md",
      "architecture/overview.md",
      "index.md",
      "log.md",
      "quickstart.md",
    ]);
    expect(okf.concepts.filter(({ noteId }) => noteId).map(({ relativePath }) => relativePath)).toEqual([
      "architecture/overview.md",
      "quickstart.md",
    ]);
    expect(okf.concepts.filter(({ noteId }) => noteId).map(({ conceptTypes }) => conceptTypes)).toEqual([
      ["Reference"],
      ["Reference"],
    ]);
    expect(okf.concepts.find(({ relativePath }) => relativePath === "quickstart.md")).toMatchObject({
      label: "Quickstart",
      properties: { description: "Start here." },
    });
    expect(okf.findings.some(({ code }) => code === "okf.missing-type")).toBe(false);
    expect(okf.relations.some(({ source, target }) => /(?:index|log)\.md/u.test(source) || /(?:index|log)\.md/u.test(target))).toBe(false);
    expectRelationEndpoints(okf.concepts.map(({ id }) => id), okf.relations);
    expect(await readFile(path.join(wiki, "index.md"), "utf8")).toMatch(/^---\nokf_version: "0\.1"\n---/u);
    expect(await treeSha256(wiki)).toBe(before);
  });

  it("preserves Format facts until a kept Workspace Ontology adds separate meaning", async () => {
    const fixture = path.join(fixtureRoot, "format-ontology-boundary");
    const temporary = await mkdtemp(path.join(os.tmpdir(), "exo-interop-boundary-"));
    temporaryRoots.push(temporary);
    const workspace = path.join(temporary, "workspace");
    await cp(fixture, workspace, { recursive: true });
    const notes = path.join(workspace, "notes");
    const runtimeRoot = path.join(temporary, ".exo");
    const before = await treeSha256(notes);

    const formatOnly = await new WorkspaceGraph(
      workspaceModel(workspace, [{ id: "notes", path: notes }]),
      { runtimeRoot },
    ).knowledgeSnapshot("okf");
    const source = formatOnly.concepts.find(({ relativePath }) => relativePath === "source.md");
    expect(source).toMatchObject({
      conceptTypes: ["Custom Claim"],
      properties: { producer_extension: { nested: { enabled: true, ranks: [2, 5, 8] } } },
    });
    expect(formatOnly.concepts.filter(({ noteId }) => noteId).map(({ relativePath }) => relativePath))
      .toEqual(["source.md", "target.md"]);
    expect(formatOnly.relations.some(({ origin }) => origin === "ontology")).toBe(false);
    expect(countByResolution(formatOnly.relations.filter(({ family }) => family === "link")))
      .toEqual({ external: 1, resolved: 1, unresolved: 1 });
    expectRelationEndpoints(formatOnly.concepts.map(({ id }) => id), formatOnly.relations);

    const store = new WorkspaceOntologyStore({ workspaceRoot: workspace, runtimeRoot });
    const candidate = await store.inspectCandidate();
    await store.keepCandidate(candidate.sourceRevision ?? "");
    const interpreted = await new WorkspaceGraph(
      workspaceModel(workspace, [{ id: "notes", path: notes }]),
      { runtimeRoot },
    ).knowledgeSnapshot("okf");
    expect(interpreted.activeOntology).toMatchObject({ state: "active", id: "fixture-meaning" });
    expect(interpreted.concepts.find(({ relativePath }) => relativePath === "source.md")?.conceptTypes)
      .toEqual(["Custom Claim"]);
    const keptRevision = interpreted.activeOntology.revision;
    expect(interpreted.concepts.find(({ relativePath }) => relativePath === "source.md")?.properties.supports)
      .toBe("/target.md");
    expect(interpreted.relations).toContainEqual(expect.objectContaining({
      source: "note:notes:source.md",
      target: "note:notes:target.md",
      family: "property-reference",
      predicate: "supports",
      origin: "ontology",
      resolution: "resolved",
      evidence: [
        expect.objectContaining({ kind: "property", property: "supports" }),
        expect.objectContaining({ kind: "ontology-rule", producer: { id: "fixture-meaning", version: keptRevision } }),
      ],
    }));
    expectRelationEndpoints(interpreted.concepts.map(({ id }) => id), interpreted.relations);
    expect(await treeSha256(notes)).toBe(before);
  });

  it("contains root-absolute document and Ontology references inside the source Note Root", async () => {
    const temporary = await mkdtemp(path.join(os.tmpdir(), "exo-okf-root-links-"));
    temporaryRoots.push(temporary);
    const workspace = path.join(temporary, "workspace");
    const rootA = path.join(workspace, "a");
    const rootB = path.join(workspace, "b");
    const runtimeRoot = path.join(temporary, ".exo");
    await mkdir(rootA, { recursive: true });
    await mkdir(rootB, { recursive: true });
    await writeFile(path.join(rootA, "source.md"), [
      "---",
      "type: Claim",
      "supports: /target.md",
      "escapes: /../b/target.md",
      "---",
      "",
      "# Source",
      "",
      "[Target](/target.md)",
      "[Escape](/../b/target.md)",
    ].join("\n"));
    await writeFile(path.join(rootA, "target.md"), "---\ntype: Evidence\n---\n# A\n");
    await writeFile(path.join(rootB, "target.md"), "---\ntype: Evidence\n---\n# B\n");
    await writeFile(path.join(workspace, "ontology.yaml"), [
      "ontology_schema: 1",
      "id: containment",
      "version: 1",
      "properties:",
      "  supports: { value: reference, predicate: supports }",
      "  escapes: { value: reference, predicate: escapes }",
    ].join("\n"));
    const store = new WorkspaceOntologyStore({ workspaceRoot: workspace, runtimeRoot });
    const candidate = await store.inspectCandidate();
    await store.keepCandidate(candidate.sourceRevision ?? "");
    const model = workspaceModel(workspace, [{ id: "a", path: rootA }, { id: "b", path: rootB }]);

    const withLocalTarget = await new WorkspaceGraph(model, { runtimeRoot }).knowledgeSnapshot("okf");
    expect(relationFor(withLocalTarget.relations, "note:a:source.md", "references", "Target"))
      .toMatchObject({ target: "note:a:target.md", resolution: "resolved" });
    expect(relationFor(withLocalTarget.relations, "note:a:source.md", "supports"))
      .toMatchObject({ target: "note:a:target.md", resolution: "resolved", origin: "ontology" });
    expect(relationFor(withLocalTarget.relations, "note:a:source.md", "references", "Escape"))
      .toMatchObject({ resolution: "unresolved" });
    expect(relationFor(withLocalTarget.relations, "note:a:source.md", "escapes"))
      .toMatchObject({ resolution: "unresolved", origin: "ontology" });

    await unlink(path.join(rootA, "target.md"));
    const withoutLocalTarget = await new WorkspaceGraph(model, { runtimeRoot }).knowledgeSnapshot("okf");
    const documentTarget = relationFor(withoutLocalTarget.relations, "note:a:source.md", "references", "Target");
    const ontologyTarget = relationFor(withoutLocalTarget.relations, "note:a:source.md", "supports");
    expect(documentTarget).toMatchObject({ resolution: "unresolved" });
    expect(ontologyTarget).toMatchObject({ resolution: "unresolved", origin: "ontology" });
    expect(documentTarget?.target).not.toBe("note:b:target.md");
    expect(ontologyTarget?.target).not.toBe("note:b:target.md");
    expectRelationEndpoints(withoutLocalTarget.concepts.map(({ id }) => id), withoutLocalTarget.relations);
  });

  it("does not create document or Ontology endpoints for reserved OKF targets", async () => {
    const temporary = await mkdtemp(path.join(os.tmpdir(), "exo-okf-reserved-targets-"));
    temporaryRoots.push(temporary);
    const workspace = path.join(temporary, "workspace");
    const notes = path.join(workspace, "notes");
    const runtimeRoot = path.join(temporary, ".exo");
    await mkdir(notes, { recursive: true });
    await writeFile(path.join(notes, "source.md"), [
      "---",
      "type: Claim",
      "reserved: /index.md",
      "missing_reserved: nested/log.md",
      "reserved_extensionless: /index",
      "missing_reserved_extensionless: nested/log",
      "reserved_fragment: /index.md#section",
      "---",
      "",
      "[Existing index](/index.md)",
      "[Missing log](nested/log.md)",
      "[Existing extensionless index](/index)",
      "[Missing extensionless log](nested/log)",
      "[Existing index fragment](/index.md#section)",
      "[External index](https://example.com/index.md)",
    ].join("\n"));
    await writeFile(path.join(notes, "index.md"), "---\nokf_version: \"0.1\"\n---\n# Files\n");
    await writeFile(path.join(workspace, "ontology.yaml"), [
      "ontology_schema: 1",
      "id: reserved-targets",
      "version: 1",
      "properties:",
      "  reserved: { value: reference, predicate: reserved }",
      "  missing_reserved: { value: reference, predicate: missing-reserved }",
      "  reserved_extensionless: { value: reference, predicate: reserved-extensionless }",
      "  missing_reserved_extensionless: { value: reference, predicate: missing-reserved-extensionless }",
      "  reserved_fragment: { value: reference, predicate: reserved-fragment }",
    ].join("\n"));
    const store = new WorkspaceOntologyStore({ workspaceRoot: workspace, runtimeRoot });
    const candidate = await store.inspectCandidate();
    await store.keepCandidate(candidate.sourceRevision ?? "");

    const snapshot = await new WorkspaceGraph(
      workspaceModel(workspace, [{ id: "notes", path: notes }]),
      { runtimeRoot },
    ).knowledgeSnapshot("okf");
    expect(snapshot.concepts.filter(({ noteId }) => noteId).map(({ relativePath }) => relativePath)).toEqual(["source.md"]);
    expect(snapshot.relations).toEqual([
      expect.objectContaining({ label: "External index", resolution: "external", origin: "document" }),
    ]);
    expect(snapshot.findings.some(({ code }) => code === "okf.missing-type")).toBe(false);
    expectRelationEndpoints(snapshot.concepts.map(({ id }) => id), snapshot.relations);
  });
});

function workspaceModel(
  workspaceRoot: string,
  roots: Array<{ id: string; path: string }>,
): WorkspaceModel {
  return {
    workspaceRoot,
    defaultTerminalCwd: workspaceRoot,
    noteRoots: roots.map(({ id, path: rootPath }) => ({ id, label: id, path: rootPath })),
    indexedRoots: [],
    indexing: { enabled: false, mode: "off", backend: "qmd" },
  };
}

function countByResolution(relations: readonly RelationEdge[]): Record<string, number> {
  return Object.fromEntries(
    [...new Set(relations.map(({ resolution }) => resolution))].sort().map((resolution) => [
      resolution,
      relations.filter((relation) => relation.resolution === resolution).length,
    ]),
  );
}

function relationFor(
  relations: readonly RelationEdge[],
  source: string,
  predicate: string,
  label?: string,
): RelationEdge | undefined {
  return relations.find((relation) => relation.source === source
    && relation.predicate === predicate
    && (label === undefined || relation.label === label));
}

function expectRelationEndpoints(conceptIds: readonly string[], relations: readonly RelationEdge[]): void {
  const ids = new Set(conceptIds);
  expect(relations.every(({ source, target }) => ids.has(source) && ids.has(target))).toBe(true);
}

async function fileSha256(filePath: string): Promise<string> {
  return createHash("sha256").update(await readFile(filePath)).digest("hex");
}

async function treeSha256(directory: string): Promise<string> {
  const files = await collectFiles(directory);
  const hash = createHash("sha256");
  for (const filePath of files) {
    hash.update(path.relative(directory, filePath)).update("\0").update(await readFile(filePath)).update("\0");
  }
  return hash.digest("hex");
}

async function collectFiles(directory: string): Promise<string[]> {
  const files: string[] = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const entryPath = path.join(directory, entry.name);
    if (entry.isDirectory()) files.push(...await collectFiles(entryPath));
    else if (entry.isFile()) files.push(entryPath);
  }
  return files.sort();
}
