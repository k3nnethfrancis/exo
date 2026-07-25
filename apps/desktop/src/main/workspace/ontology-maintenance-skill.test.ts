import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import {
  ensureOntologyMaintenanceSkill,
  prepareOntologyMaintenanceMessage,
} from "./ontology-maintenance-skill";

const roots: string[] = [];
afterEach(async () => Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))));

describe("Ontology maintenance Skill", () => {
  it("installs one user-owned copy without overwriting later edits", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "exo-maintenance-skill-"));
    roots.push(root);
    const first = await ensureOntologyMaintenanceSkill(root);
    expect(first.path).toBe(path.join(root, "skills", "find-and-connect-relevant-context.md"));
    expect(await readFile(first.path, "utf8")).toContain("at most three connections");

    await writeFile(first.path, "user edited instructions\n");
    const second = await ensureOntologyMaintenanceSkill(root);
    expect(await readFile(second.path, "utf8")).toBe("user edited instructions\n");
    expect(second.revision).not.toBe(first.revision);
  });

  it("refuses a symlinked Skills directory", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "exo-maintenance-skill-"));
    const outside = await mkdtemp(path.join(os.tmpdir(), "exo-maintenance-skill-outside-"));
    roots.push(root, outside);
    const { symlink } = await import("node:fs/promises");
    await symlink(outside, path.join(root, "skills"));
    await expect(ensureOntologyMaintenanceSkill(root)).rejects.toThrow("real directory");
  });

  it("parameterizes the same Skill with exact active ontology and graph identities", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "exo-maintenance-skill-"));
    roots.push(root);
    await mkdir(path.join(root, "notes"));
    const skill = await ensureOntologyMaintenanceSkill(path.join(root, "notes"));
    const prepared = prepareOntologyMaintenanceMessage({
      documentPath: path.join(root, "notes", "start.md"),
      skill,
      ontologyReview: {
        library: [],
        active: {
          state: "active",
          sourcePath: "ontologies/research.yaml",
          id: "research",
          revision: "ontology-revision",
        },
        candidate: {
          state: "valid",
          sourcePath: "ontologies/research.yaml",
          revision: "candidate",
          pending: false,
          rejected: false,
        },
        guard: {
          candidateSourcePath: "ontologies/research.yaml",
          candidateRevision: "candidate",
          activationRevision: "active",
          baseSnapshotId: "not-pending",
        },
        diagnostics: [],
        omittedDiagnostics: 0,
      },
      graphContext: null,
      graphSnapshotId: "graph-snapshot",
    });

    expect(prepared).toMatchObject({
      skill: { id: "find-and-connect-relevant-context" },
      ontology: { state: "active", id: "research", sourcePath: "ontologies/research.yaml" },
      graphSnapshotId: "graph-snapshot",
    });
    expect(prepared.message).toContain("Skill revision:");
    expect(prepared.message).toContain("Do not edit the Skill or any ontology source.");
  });
});
