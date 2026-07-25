import type {
  OntologyReviewState,
  WorkspaceGraphContext,
} from "@exo/core";
import { ensureUserOwnedSkill } from "./user-owned-skill";

const SKILL_ID = "find-and-connect-relevant-context";

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

export async function ensureOntologyMaintenanceSkill(noteRoot: string): Promise<PreparedOntologyMaintenanceSkill["skill"]> {
  const skill = await ensureUserOwnedSkill({
    noteRoot,
    id: SKILL_ID,
    label: "Find and connect relevant context",
    source: FIND_AND_CONNECT_RELEVANT_CONTEXT_SKILL,
  });
  return {
    id: SKILL_ID,
    label: "Find and connect relevant context",
    path: skill.path,
    revision: skill.revision,
  };
}

export function prepareOntologyMaintenanceMessage(input: {
  documentPath: string;
  skill: PreparedOntologyMaintenanceSkill["skill"];
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
    `Use the user-owned Skill at ${input.skill.path}.`,
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

const FIND_AND_CONNECT_RELEVANT_CONTEXT_SKILL = `---
name: find-and-connect-relevant-context
description: Find a small number of useful, evidence-backed connections for one selected note using the active Exo graph and ontology.
---

# Find and connect relevant context

Start from the selected note. Inspect its authored links, backlinks, tags,
properties, ontology relations, graph neighbors, and relevant search results.

Propose at most three connections that materially improve retrieval or
traversal. Prefer an ordinary Markdown link or tag. Use an ontology reference
property only when the active ontology defines that property and the target
matches its constraints.

Edit the relevant Markdown notes directly. Preserve unrelated text, unknown
frontmatter, and existing formatting. Do not edit this Skill, ontology.yaml, or
anything in ontologies/. Do not invent a relationship from semantic similarity
alone; use similarity only to find evidence worth inspecting.

Every connection must be supported by the notes themselves. If no useful
connection is supported, make no change and say so.
`;

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
