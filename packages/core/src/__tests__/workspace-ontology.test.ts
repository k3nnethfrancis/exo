import { cp, mkdir, mkdtemp, readFile, rm, symlink, unlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import type { ConceptNode } from "../knowledge-graph";
import {
  WorkspaceOntologyStore,
  interpretWorkspaceOntology,
  ontologyConceptTypes,
  parseWorkspaceOntology,
} from "../workspace-ontology";

const fixtureRoot = path.join(import.meta.dirname, "fixtures", "ontology-v1");
const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("Workspace ontology", () => {
  it("parses the v1 contract deterministically while retaining unknown source data", async () => {
    const source = await readFile(path.join(fixtureRoot, "ontology.yaml"), "utf8");
    const first = parseWorkspaceOntology(source);
    const second = parseWorkspaceOntology(source);

    expect(first.diagnostics).toEqual([]);
    expect(first.ontology).toEqual(second.ontology);
    expect(first.ontology).toMatchObject({
      ontologySchema: 1,
      id: "research",
      version: "3",
      typeProperty: "kind",
      source: { future_extension: { preserved: true }, visual: { color: "orange" } },
      properties: {
        supports: {
          value: "reference[]",
          predicate: "supports",
          direction: "outgoing",
          targets: ["claim"],
        },
      },
    });
    expect(first.ontology).not.toHaveProperty("visual");
    expect(first.ontology?.revision).toMatch(/^[a-f0-9]{64}$/);
  });

  it("rejects invalid shapes and unknown schema versions atomically", () => {
    const parsed = parseWorkspaceOntology([
      "ontology_schema: 7",
      "id: example",
      "version: 1",
      "properties:",
      "  related:",
      "    value: object",
      "    predicate: related",
    ].join("\n"));

    expect(parsed.ontology).toBeNull();
    expect(parsed.diagnostics.map((finding) => [finding.code, finding.path])).toEqual([
      ["ontology.unsupported-schema", "ontology_schema"],
      ["ontology.invalid-value-shape", "properties.related.value"],
    ]);
  });

  it("keeps candidate and active state separate and persists an explicitly kept revision", async () => {
    const { workspace, runtime, store } = await ontologyStore();
    const source = await readFile(path.join(fixtureRoot, "ontology.yaml"), "utf8");
    await writeFile(path.join(workspace, "ontology.yaml"), source);

    const candidate = await store.inspectCandidate();
    expect(candidate).toMatchObject({ state: "valid", ontology: { id: "research" } });
    await expect(store.active()).resolves.toMatchObject({ state: "generic", ontology: null });

    const kept = await store.keepCandidate(candidate.sourceRevision ?? "");
    expect(kept.active).toMatchObject({
      state: "active",
      sourceRevision: candidate.sourceRevision,
      ontology: { id: "research", revision: candidate.ontology?.revision },
    });
    const checkpoint = JSON.parse(await readFile(store.activationPath, "utf8")) as { active: { source: string } };
    expect(checkpoint.active.source).toBe(source);

    const restarted = new WorkspaceOntologyStore({ workspaceRoot: workspace, runtimeRoot: runtime });
    await expect(restarted.active()).resolves.toMatchObject({
      state: "active",
      sourceRevision: candidate.sourceRevision,
      ontology: { id: "research" },
    });
  });

  it("does not activate edits, and Keep/Reject compare the current candidate revision", async () => {
    const { workspace, store } = await ontologyStore();
    await cp(path.join(fixtureRoot, "ontology.yaml"), path.join(workspace, "ontology.yaml"));
    const first = await store.inspectCandidate();
    await store.keepCandidate(first.sourceRevision ?? "");

    await writeFile(path.join(workspace, "ontology.yaml"), "ontology_schema: 1\nid: replacement\nversion: 1\n");
    const replacement = await store.inspectCandidate();
    expect(replacement).toMatchObject({ state: "valid", ontology: { id: "replacement" } });
    await expect(store.active()).resolves.toMatchObject({ state: "active", ontology: { id: "research" } });
    await expect(store.keepCandidate(first.sourceRevision ?? "")).rejects.toThrow("candidate changed");

    const rejected = await store.rejectCandidate(replacement.sourceRevision ?? "");
    expect(rejected.active).toMatchObject({
      state: "active",
      ontology: { id: "research" },
      rejectedCandidateRevision: replacement.sourceRevision,
    });
    expect(rejected.candidate).toMatchObject({ state: "valid", ontology: { id: "replacement" } });
  });

  it("can explicitly keep Generic Markdown after the active candidate is removed", async () => {
    const { workspace, runtime, store } = await ontologyStore();
    await cp(path.join(fixtureRoot, "ontology.yaml"), path.join(workspace, "ontology.yaml"));
    const candidate = await store.inspectCandidate();
    const kept = await store.keepCandidate(candidate.sourceRevision ?? "");
    await unlink(path.join(workspace, "ontology.yaml"));

    await expect(store.keepGeneric(kept.active.sourceRevision ?? "")).resolves.toMatchObject({
      candidate: { state: "absent" },
      active: { state: "generic", ontology: null },
    });
    await expect(new WorkspaceOntologyStore({ workspaceRoot: workspace, runtimeRoot: runtime }).active())
      .resolves.toMatchObject({ state: "generic", ontology: null });
  });

  it("falls back to Generic Markdown for invalid candidates or corrupted kept state", async () => {
    const { workspace, runtime, store } = await ontologyStore();
    await cp(path.join(fixtureRoot, "invalid-schema.yaml"), path.join(workspace, "ontology.yaml"));

    await expect(store.state()).resolves.toMatchObject({
      candidate: { state: "invalid", diagnostics: [expect.objectContaining({ code: "ontology.unsupported-schema" })] },
      active: { state: "generic", ontology: null },
    });

    await mkdir(path.join(runtime, "ontology"), { recursive: true });
    await writeFile(path.join(runtime, "ontology", "activation.json"), "{\"schema\":1,\"active\":{}}\n");
    await expect(store.active()).resolves.toMatchObject({
      state: "invalid-state",
      ontology: null,
      diagnostics: [expect.objectContaining({ code: "ontology.invalid-activation-state" })],
    });
  });

  it("fails visibly on hash mismatch, truncated, unknown-schema, and oversized activation state", async () => {
    const { workspace, runtime, store } = await ontologyStore();
    await cp(path.join(fixtureRoot, "ontology.yaml"), path.join(workspace, "ontology.yaml"));
    const candidate = await store.inspectCandidate();
    await store.keepCandidate(candidate.sourceRevision ?? "");
    const valid = JSON.parse(await readFile(store.activationPath, "utf8")) as Record<string, unknown>;

    await writeFile(store.activationPath, `${JSON.stringify({ ...valid, recordHash: "0".repeat(64) })}\n`);
    await expect(store.active()).resolves.toMatchObject({ state: "invalid-state", ontology: null });

    await writeFile(store.activationPath, "{\"schema\":1");
    await expect(store.active()).resolves.toMatchObject({ state: "invalid-state", ontology: null });

    await writeFile(store.activationPath, `${JSON.stringify({ ...valid, schema: 2 })}\n`);
    await expect(store.active()).resolves.toMatchObject({ state: "invalid-state", ontology: null });

    await writeFile(store.activationPath, "x".repeat(1024 * 1024 + 64 * 1024 + 1));
    await expect(store.active()).resolves.toMatchObject({
      state: "invalid-state",
      ontology: null,
      diagnostics: [expect.objectContaining({ message: expect.stringContaining("size limit") })],
    });
    expect(path.dirname(store.activationPath)).toBe(path.join(runtime, "ontology"));
  });

  it("rejects activation-state symlinks instead of following them outside the runtime root", async () => {
    const { workspace, runtime, store } = await ontologyStore();
    const outside = await mkdtemp(path.join(os.tmpdir(), "exo-ontology-outside-"));
    roots.push(outside);
    await cp(path.join(fixtureRoot, "ontology.yaml"), path.join(workspace, "ontology.yaml"));
    await mkdir(runtime, { recursive: true });
    await symlink(outside, path.join(runtime, "ontology"));
    const candidate = await store.inspectCandidate();

    await expect(store.keepCandidate(candidate.sourceRevision ?? "")).rejects.toThrow("must not be a symlink");
    await expect(store.active()).resolves.toMatchObject({ state: "invalid-state", ontology: null });
  });

  it("requires stable unique validation rule ids", () => {
    const missing = parseWorkspaceOntology("ontology_schema: 1\nid: sample\nversion: 1\nrules:\n  - type: note\n");
    const duplicate = parseWorkspaceOntology("ontology_schema: 1\nid: sample\nversion: 1\nrules:\n  - { id: same, type: note }\n  - { id: same, type: note }\n");

    expect(missing.ontology).toBeNull();
    expect(missing.diagnostics).toContainEqual(expect.objectContaining({ path: "rules[0].id" }));
    expect(duplicate.ontology).toBeNull();
    expect(duplicate.diagnostics).toContainEqual(expect.objectContaining({ code: "ontology.duplicate-rule-id" }));
  });

  it("interprets references without dangling endpoints or mutating input Concepts", async () => {
    const ontology = parseWorkspaceOntology(await readFile(path.join(fixtureRoot, "ontology.yaml"), "utf8")).ontology;
    const concepts: ConceptNode[] = [
      concept("paper", ["paper"], { title: "Paper", status: "invalid", supports: ["claim", "paper-target", "missing"] }),
      concept("claim", ["claim"], { title: "Claim" }),
      concept("paper-target", ["paper"], { title: "Other paper" }),
      concept("untitled", ["paper"], {}),
    ];
    const before = structuredClone(concepts);

    const interpreted = interpretWorkspaceOntology(ontology, concepts, (_source, reference) => reference === "missing"
      ? { targetId: "unresolved:missing", resolution: "unresolved" }
      : { targetId: reference, resolution: "resolved" });
    const endpointIds = new Set([...concepts, ...interpreted.concepts].map((item) => item.id));

    expect(interpreted.relations).toEqual(expect.arrayContaining([
      expect.objectContaining({
        source: "paper",
        target: "claim",
        predicate: "supports",
        origin: "ontology",
        evidence: [
          expect.objectContaining({ kind: "property", property: "supports" }),
          expect.objectContaining({ kind: "ontology-rule", producer: { id: "research", version: ontology?.revision } }),
        ],
      }),
      expect.objectContaining({ target: "unresolved:missing", resolution: "unresolved" }),
    ]));
    expect(interpreted.relations.every((relation) => endpointIds.has(relation.source) && endpointIds.has(relation.target))).toBe(true);
    expect(interpreted.concepts).toContainEqual(expect.objectContaining({ id: "unresolved:missing", resolution: "unresolved" }));
    expect(interpreted.findings.map((finding) => finding.code)).toEqual(expect.arrayContaining([
      "ontology.property-allowed",
      "ontology.reference-target-type",
      "ontology.reference-unresolved",
      "ontology.required-property",
      "ontology.recommended-property",
    ]));
    expect(concepts).toEqual(before);
  });

  it("uses explicit open types before bounded declarative path defaults", async () => {
    const parsed = parseWorkspaceOntology(await readFile(path.join(fixtureRoot, "ontology.yaml"), "utf8"));
    expect(ontologyConceptTypes(parsed.ontology, { kind: "custom" }, "papers/a.md", ["legacy"])).toEqual(["custom"]);
    expect(ontologyConceptTypes(parsed.ontology, {}, "papers/a.md", [])).toEqual(["paper"]);
    expect(ontologyConceptTypes(parsed.ontology, {}, "claims/a.md", ["legacy"])).toEqual([]);
  });
});

async function ontologyStore(): Promise<{ workspace: string; runtime: string; store: WorkspaceOntologyStore }> {
  const root = await mkdtemp(path.join(os.tmpdir(), "exo-ontology-store-"));
  roots.push(root);
  const workspace = path.join(root, "workspace");
  const runtime = path.join(root, ".exo");
  await mkdir(workspace);
  return { workspace, runtime, store: new WorkspaceOntologyStore({ workspaceRoot: workspace, runtimeRoot: runtime }) };
}

function concept(
  id: string,
  conceptTypes: readonly string[],
  properties: ConceptNode["properties"],
): ConceptNode {
  return { id, noteId: id, label: id, conceptTypes, properties, resolution: "resolved", tags: [] };
}
