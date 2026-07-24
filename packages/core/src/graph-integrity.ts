import type { GraphFinding, KnowledgeGraphSnapshot } from "./knowledge-graph";

export interface GraphIntegrityDimension {
  id: "identity" | "resolution" | "evidence" | "profile-conformance";
  label: string;
  measured: number;
  total: number;
  ratio: number | null;
  findings: readonly GraphFinding[];
}

export interface GraphIntegrityReport {
  version: "0.1";
  snapshotId: string;
  profileId: string;
  dimensions: readonly GraphIntegrityDimension[];
}

/** Reports independent mechanical graph-integrity dimensions without an aggregate score. */
export function evaluateGraphIntegrity(snapshot: KnowledgeGraphSnapshot): GraphIntegrityReport {
  const duplicateIds = duplicates(snapshot.concepts.map((concept) => concept.id));
  const identityFindings = duplicateIds.map((id) => finding("identity.duplicate", `Duplicate concept identity: ${id}`, [id], []));
  const unresolvedRelations = snapshot.relations.filter((relation) => relation.resolution === "unresolved" || relation.resolution === "ambiguous");
  const resolutionFindings = unresolvedRelations.map((relation) => finding(
    `relation.${relation.resolution}`,
    `${relation.label ?? relation.predicate ?? relation.family} is ${relation.resolution}.`,
    [relation.source, relation.target],
    [relation.id],
  ));
  const relationsWithoutEvidence = snapshot.relations.filter((relation) => !relation.evidence.some(isInspectableEvidence));
  const evidenceFindings = relationsWithoutEvidence.map((relation) => finding(
    "relation.missing-evidence",
    `${relation.label ?? relation.predicate ?? relation.family} has no inspectable evidence.`,
    [relation.source, relation.target],
    [relation.id],
  ));
  const profileFindings = snapshot.findings.filter((item) => item.code.startsWith(`${snapshot.activeProfile.id}.`));
  return {
    version: "0.1",
    snapshotId: snapshot.snapshotId,
    profileId: snapshot.activeProfile.id,
    dimensions: [
      dimension("identity", "Stable identity", snapshot.concepts.length - duplicateIds.length, snapshot.concepts.length, identityFindings),
      dimension("resolution", "Resolved relations", snapshot.relations.length - unresolvedRelations.length, snapshot.relations.length, resolutionFindings),
      dimension("evidence", "Evidence coverage", snapshot.relations.length - relationsWithoutEvidence.length, snapshot.relations.length, evidenceFindings),
      dimension("profile-conformance", "Profile conformance", Math.max(0, snapshot.concepts.length - profileFindings.length), snapshot.concepts.length, profileFindings),
    ],
  };
}

function isInspectableEvidence(evidence: KnowledgeGraphSnapshot["relations"][number]["evidence"][number]): boolean {
  switch (evidence.kind) {
    case "source-span":
      return Boolean(evidence.noteId)
        && Number.isInteger(evidence.sourceRange?.from)
        && Number.isInteger(evidence.sourceRange?.to)
        && (evidence.sourceRange?.to ?? 0) > (evidence.sourceRange?.from ?? 0);
    case "property":
      return Boolean(evidence.noteId && evidence.property);
    case "path":
      return Boolean(evidence.detail);
    case "ontology-rule":
    case "model":
      return Boolean(evidence.producer?.id && evidence.producer.version);
  }
}

function dimension(
  id: GraphIntegrityDimension["id"],
  label: string,
  measured: number,
  total: number,
  findings: readonly GraphFinding[],
): GraphIntegrityDimension {
  return { id, label, measured, total, ratio: total > 0 ? measured / total : null, findings };
}

function duplicates(values: readonly string[]): string[] {
  const seen = new Set<string>();
  const duplicate = new Set<string>();
  for (const value of values) {
    if (seen.has(value)) duplicate.add(value);
    seen.add(value);
  }
  return [...duplicate].sort();
}

function finding(code: string, message: string, conceptIds: string[], relationIds: string[]): GraphFinding {
  return { id: `integrity:${code}:${[...conceptIds, ...relationIds].join(":")}`, severity: "warning", code, message, conceptIds, relationIds, evidence: [] };
}
