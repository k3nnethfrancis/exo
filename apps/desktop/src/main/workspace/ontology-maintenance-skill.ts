import type {
  AgentCommandAdapter,
  OntologyReviewState,
  WorkspaceGraphContext,
} from "@exograph/core";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";

import nativeSkillSource from "../../../../../skills/find-and-connect-relevant-context/SKILL.md?raw";

const SKILL_ID = "find-and-connect-relevant-context";
const MAX_NATIVE_SKILL_BYTES = 128 * 1024;

export type OntologyMaintenanceSkillDelivery =
  | { mode: "installed"; path: string }
  | { mode: "bundled"; path: string }
  | { mode: "inline"; source: string };

export interface ResolvedOntologyMaintenanceSkill {
  skill: PreparedOntologyMaintenanceSkill["skill"];
  delivery: OntologyMaintenanceSkillDelivery;
}

export interface PreparedOntologyMaintenanceSkill {
  skill: {
    id: typeof SKILL_ID;
    label: "Find and connect relevant context";
    path: string;
    revision: string;
  };
  ontology: {
    state: "generic" | "active";
    sourcePath?: string;
    id?: string;
    revision?: string;
  };
  graphSnapshotId: string;
  message: string;
}

export async function resolveOntologyMaintenanceSkill(input: {
  adapter: AgentCommandAdapter;
  homeDir: string;
  codexHome?: string;
  bundledSkillPath: string;
}): Promise<ResolvedOntologyMaintenanceSkill> {
  for (const installedPath of installedSkillCandidates(input)) {
    const source = await readableSkillSource(installedPath);
    if (!source) continue;
    return resolvedSkill(installedPath, source, { mode: "installed", path: installedPath });
  }

  const bundledPath = path.resolve(input.bundledSkillPath);
  const bundledSource = await readableSkillSource(bundledPath);
  if (bundledSource) {
    return resolvedSkill(bundledPath, bundledSource, { mode: "bundled", path: bundledPath });
  }

  return resolvedSkill(bundledPath, nativeSkillSource, { mode: "inline", source: nativeSkillSource });
}

export function prepareOntologyMaintenanceMessage(input: {
  documentPath: string;
  skill: PreparedOntologyMaintenanceSkill["skill"];
  delivery: OntologyMaintenanceSkillDelivery;
  ontologyReview: OntologyReviewState;
  graphContext: WorkspaceGraphContext | null;
  graphSnapshotId: string;
}): PreparedOntologyMaintenanceSkill {
  const active = input.ontologyReview.active;
  if (active.state === "invalid-state") {
    throw new Error("The active Ontology is unavailable. Repair it before running an Ontology maintenance Skill.");
  }
  const ontology = active.state === "active"
    ? {
        state: "active" as const,
        ...(active.sourcePath ? { sourcePath: active.sourcePath } : {}),
        ...(active.id ? { id: active.id } : {}),
        ...(active.revision ? { revision: active.revision } : {}),
      }
    : { state: "generic" as const };
  const lines = [
    ...skillInstructionLines(input.delivery),
    `Skill revision: ${input.skill.revision}.`,
    `Start note: ${input.documentPath}.`,
    ontology.state === "active"
      ? `Active ontology: ${ontology.id ?? "unnamed"} at ${ontology.sourcePath ?? "ontology.yaml"}; revision ${ontology.revision ?? "unknown"}.`
      : "Active ontology: Generic Markdown (no ontology).",
    `Graph snapshot: ${input.graphSnapshotId}.`,
    "",
    "Current graph evidence:",
    ...graphEvidenceLines(input.graphContext),
    "",
    "Follow the Skill exactly. Make only a small number of evidence-backed Markdown connections. " +
      "Do not edit the Skill or any ontology source. Preserve unrelated content and unknown frontmatter.",
  ];
  return {
    skill: input.skill,
    ontology,
    graphSnapshotId: input.graphSnapshotId,
    message: lines.join("\n"),
  };
}

function installedSkillCandidates(input: {
  adapter: AgentCommandAdapter;
  homeDir: string;
  codexHome?: string;
}): string[] {
  if (input.adapter === "claude-code") {
    return [path.join(input.homeDir, ".claude", "skills", SKILL_ID, "SKILL.md")];
  }
  if (input.adapter === "codex-cli") {
    return [path.join(input.codexHome ?? path.join(input.homeDir, ".codex"), "skills", SKILL_ID, "SKILL.md")];
  }
  return [];
}

async function readableSkillSource(skillPath: string): Promise<string | null> {
  try {
    const source = await readFile(skillPath, "utf8");
    if (Buffer.byteLength(source, "utf8") > MAX_NATIVE_SKILL_BYTES) return null;
    return source.includes(`name: ${SKILL_ID}`) ? source : null;
  } catch {
    return null;
  }
}

function resolvedSkill(
  skillPath: string,
  source: string,
  delivery: OntologyMaintenanceSkillDelivery,
): ResolvedOntologyMaintenanceSkill {
  return {
    skill: {
      id: SKILL_ID,
      label: "Find and connect relevant context",
      path: path.resolve(skillPath),
      revision: createHash("sha256").update(source).digest("hex"),
    },
    delivery,
  };
}

function skillInstructionLines(delivery: OntologyMaintenanceSkillDelivery): string[] {
  if (delivery.mode === "installed") {
    return [
      `Use the installed native Skill \`${SKILL_ID}\`.`,
      `Read and apply it from ${delivery.path} before acting.`,
    ];
  }
  if (delivery.mode === "bundled") {
    return [`Read and apply the Exograph-owned Skill at ${delivery.path} before acting.`];
  }
  return [
    "No readable installed Skill is available. Apply this exact Exograph-owned Skill before acting:",
    "<skill>",
    delivery.source.trimEnd(),
    "</skill>",
  ];
}

function graphEvidenceLines(context: WorkspaceGraphContext | null): string[] {
  if (!context) return ["- No bounded graph context is available for this note."];
  const lines: string[] = [];
  for (const link of context.outgoing.slice(0, 8)) {
    lines.push(`- outgoing: ${link.label} (${link.resolution})`);
  }
  for (const link of context.backlinks.slice(0, 8)) {
    lines.push(`- backlink: ${link.note?.relativePath ?? link.label}`);
  }
  for (const relation of context.neighborhoodRelations.slice(0, 8)) {
    lines.push(`- ontology relation: ${relation.predicate} (${relation.source} -> ${relation.target})`);
  }
  return lines.length > 0 ? lines : ["- No authored or ontology relations are currently recorded."];
}
