import { mkdir, mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import {
  prepareOntologyMaintenanceMessage,
  resolveOntologyMaintenanceSkill,
} from "./ontology-maintenance-skill";

const roots: string[] = [];
afterEach(async () => Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))));

describe("Ontology maintenance Skill", () => {
  it("uses an installed Claude Skill when the selected harness already has one", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "exograph-maintenance-skill-"));
    roots.push(root);
    const installedPath = path.join(root, ".claude", "skills", "find-and-connect-relevant-context", "SKILL.md");
    await mkdir(path.dirname(installedPath), { recursive: true });
    await writeFile(installedPath, "---\nname: find-and-connect-relevant-context\n---\nInstalled instructions.\n");
    const resolved = await resolveOntologyMaintenanceSkill({
      adapter: "claude-code",
      homeDir: root,
      bundledSkillPath: path.join(root, "missing", "SKILL.md"),
    });

    expect(resolved.skill.path).toBe(installedPath);
    expect(resolved.delivery).toEqual({ mode: "installed", path: installedPath });
  });

  it("uses Exograph's bundled Skill without creating anything in the Note Root", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "exograph-maintenance-skill-"));
    roots.push(root);
    const noteRoot = path.join(root, "notes");
    const bundledSkillPath = path.join(root, "application", "skills", "find-and-connect-relevant-context", "SKILL.md");
    await mkdir(noteRoot, { recursive: true });
    await mkdir(path.dirname(bundledSkillPath), { recursive: true });
    await writeFile(bundledSkillPath, "---\nname: find-and-connect-relevant-context\n---\nBundled instructions.\n");
    const before = await readdir(noteRoot);

    const resolved = await resolveOntologyMaintenanceSkill({
      adapter: "generic",
      homeDir: path.join(root, "home"),
      bundledSkillPath,
    });
    const prepared = prepareOntologyMaintenanceMessage({
      documentPath: path.join(noteRoot, "start.md"),
      skill: resolved.skill,
      delivery: resolved.delivery,
      ontologyReview: genericOntologyReview(),
      graphContext: null,
      graphSnapshotId: "graph-snapshot",
    });

    expect(resolved.delivery).toEqual({ mode: "bundled", path: bundledSkillPath });
    expect(prepared.message).toContain(`Read and apply the Exograph-owned Skill at ${bundledSkillPath}`);
    expect(await readdir(noteRoot)).toEqual(before);
  });

  it("faithfully includes the native Skill when no readable path is available", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "exograph-maintenance-skill-"));
    roots.push(root);
    const missingPath = path.join(root, "missing", "SKILL.md");
    const resolved = await resolveOntologyMaintenanceSkill({
      adapter: "codex-cli",
      homeDir: path.join(root, "home"),
      bundledSkillPath: missingPath,
    });
    const prepared = prepareOntologyMaintenanceMessage({
      documentPath: path.join(root, "notes", "start.md"),
      skill: resolved.skill,
      delivery: resolved.delivery,
      ontologyReview: genericOntologyReview(),
      graphContext: null,
      graphSnapshotId: "graph-snapshot",
    });

    expect(resolved.delivery.mode).toBe("inline");
    expect(prepared.message).toContain("<skill>");
    expect(prepared.message).toContain("Propose at most three connections");
  });

  it("parameterizes the native Skill with exact active ontology and graph identities", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "exograph-maintenance-skill-"));
    roots.push(root);
    const bundledSkillPath = path.join(root, "application", "SKILL.md");
    await mkdir(path.dirname(bundledSkillPath), { recursive: true });
    await writeFile(bundledSkillPath, "---\nname: find-and-connect-relevant-context\n---\nBundled instructions.\n");
    const resolved = await resolveOntologyMaintenanceSkill({
      adapter: "generic",
      homeDir: path.join(root, "home"),
      bundledSkillPath,
    });
    const prepared = prepareOntologyMaintenanceMessage({
      documentPath: path.join(root, "notes", "start.md"),
      skill: resolved.skill,
      delivery: resolved.delivery,
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

function genericOntologyReview() {
  return {
    library: [],
    active: { state: "generic" as const },
    candidate: {
      state: "valid" as const,
      sourcePath: "ontology.yaml",
      revision: "candidate",
      pending: false,
      rejected: false,
    },
    guard: {
      candidateSourcePath: "ontology.yaml",
      candidateRevision: "candidate",
      activationRevision: "active",
      baseSnapshotId: "not-pending",
    },
    diagnostics: [],
    omittedDiagnostics: 0,
  };
}
