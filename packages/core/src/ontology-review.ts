import type { GraphFinding, KnowledgeGraphSnapshot, RelationEdge } from "./knowledge-graph";

export const ONTOLOGY_REVIEW_MAX_DIAGNOSTICS = 8;
export const ONTOLOGY_REVIEW_MAX_CODE_CHARS = 128;
export const ONTOLOGY_REVIEW_MAX_MESSAGE_CHARS = 512;
export const ONTOLOGY_REVIEW_MAX_IDENTITY_CHARS = 160;

export interface OntologyEffectCounts {
  typedConcepts: number;
  ontologyRelations: number;
  findings: { info: number; warning: number; error: number };
}

export interface OntologyGraphEffectSummary {
  baseSnapshotId: string;
  candidateSnapshotId: string;
  affectedConcepts: number;
  before: OntologyEffectCounts;
  after: OntologyEffectCounts;
}

export interface OntologyReviewGuard {
  candidateRevision: string | null;
  activationRevision: string | null;
  baseSnapshotId: string;
}

export interface OntologyReviewDiagnostic {
  severity: "error";
  code: string;
  message: string;
}

export interface OntologyReviewState {
  active: {
    state: "generic" | "active" | "invalid-state";
    id?: string;
    label?: string;
    version?: string;
    revision?: string;
  };
  candidate: {
    state: "absent" | "valid" | "invalid";
    id?: string;
    label?: string;
    version?: string;
    revision: string | null;
    pending: boolean;
    rejected: boolean;
  };
  guard: OntologyReviewGuard;
  effects?: OntologyGraphEffectSummary;
  diagnostics: readonly OntologyReviewDiagnostic[];
  omittedDiagnostics: number;
}

export type OntologyKeepResult =
  | { status: "applied"; review: OntologyReviewState }
  | { status: "stale"; review: OntologyReviewState };

export type OntologyRejectResult =
  | { status: "rejected"; review: OntologyReviewState }
  | { status: "stale"; review: OntologyReviewState };

export function assertOntologyReviewGuard(value: unknown): OntologyReviewGuard {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Ontology review requires a valid review guard.");
  }
  const candidate = value as Partial<OntologyReviewGuard>;
  if (!Object.keys(candidate).every((key) => ["candidateRevision", "activationRevision", "baseSnapshotId"].includes(key))) {
    throw new Error("Ontology review guard contains unsupported fields.");
  }
  return {
    candidateRevision: boundedNullableRevision(candidate.candidateRevision, "candidate"),
    activationRevision: boundedNullableRevision(candidate.activationRevision, "activation"),
    baseSnapshotId: boundedString(candidate.baseSnapshotId, "base snapshot", 256),
  };
}

export function boundedOntologyReviewText(value: string, maxLength: number): string {
  return value.slice(0, maxLength);
}

/** Pure, deterministic review summary. Snapshot content never crosses IPC. */
export function summarizeOntologyGraphEffects(
  before: KnowledgeGraphSnapshot,
  after: KnowledgeGraphSnapshot,
): OntologyGraphEffectSummary {
  const beforeSignatures = ontologyEffectSignatures(before);
  const afterSignatures = ontologyEffectSignatures(after);
  const ids = new Set([...beforeSignatures.keys(), ...afterSignatures.keys()]);
  let affectedConcepts = 0;
  for (const id of ids) {
    if ((beforeSignatures.get(id) ?? "") !== (afterSignatures.get(id) ?? "")) affectedConcepts += 1;
  }
  return {
    baseSnapshotId: before.snapshotId,
    candidateSnapshotId: after.snapshotId,
    affectedConcepts,
    before: ontologyEffectCounts(before),
    after: ontologyEffectCounts(after),
  };
}

export function ontologyEffectCounts(snapshot: KnowledgeGraphSnapshot): OntologyEffectCounts {
  const findings = { info: 0, warning: 0, error: 0 };
  for (const finding of snapshot.findings) {
    if (isOntologyFinding(finding)) findings[finding.severity] += 1;
  }
  return {
    typedConcepts: snapshot.concepts.filter((concept) => Boolean(concept.noteId) && concept.conceptTypes.length > 0).length,
    ontologyRelations: snapshot.relations.filter((relation) => relation.origin === "ontology").length,
    findings,
  };
}

function ontologyEffectSignatures(snapshot: KnowledgeGraphSnapshot): Map<string, string> {
  const values = new Map<string, { types: readonly string[]; relations: string[]; findings: string[] }>();
  for (const concept of snapshot.concepts) {
    if (!concept.noteId) continue;
    values.set(concept.id, { types: [...concept.conceptTypes].sort(), relations: [], findings: [] });
  }
  for (const relation of snapshot.relations) {
    if (relation.origin !== "ontology") continue;
    appendRelationSignature(values, relation.source, relation, "out");
    appendRelationSignature(values, relation.target, relation, "in");
  }
  for (const finding of snapshot.findings) {
    if (!isOntologyFinding(finding)) continue;
    for (const conceptId of finding.conceptIds) {
      const value = values.get(conceptId);
      if (value) value.findings.push(`${finding.id}:${finding.severity}`);
    }
  }
  return new Map([...values].map(([id, value]) => [id, JSON.stringify({
    types: value.types,
    relations: value.relations.sort(),
    findings: value.findings.sort(),
  })]));
}

function appendRelationSignature(
  values: Map<string, { types: readonly string[]; relations: string[]; findings: string[] }>,
  conceptId: string,
  relation: RelationEdge,
  direction: "in" | "out",
): void {
  const value = values.get(conceptId);
  if (!value) return;
  value.relations.push(`${direction}:${relation.id}:${relation.source}:${relation.target}:${relation.resolution}`);
}

function isOntologyFinding(finding: GraphFinding): boolean {
  return finding.code.startsWith("ontology.")
    || finding.evidence.some((evidence) => evidence.kind === "ontology-rule");
}

function boundedNullableRevision(value: unknown, label: string): string | null {
  if (value === null) return null;
  return boundedString(value, `${label} revision`, 128);
}

function boundedString(value: unknown, label: string, maxLength: number): string {
  if (typeof value !== "string" || value.length === 0 || value.length > maxLength) {
    throw new Error(`Ontology review ${label} must be a nonempty bounded string.`);
  }
  return value;
}
