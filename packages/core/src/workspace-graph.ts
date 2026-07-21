import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";

import { extractMarkdownLinks, extractTags, extractWikilinks, parseWorkspaceDocument } from "./notes";
import {
  KNOWLEDGE_GRAPH_VERSION,
  graphPropertyRecord,
  knowledgeGraphSnapshotId,
  type ConceptNode,
  type GraphFinding,
  type KnowledgeGraphSnapshot,
  type RelationEvidence,
  type RelationEdge,
} from "./knowledge-graph";
import { knowledgeProfile } from "./knowledge-profile";
import {
  WorkspaceOntologyStore,
  absentWorkspaceOntologyCandidateRevision,
  interpretWorkspaceOntology,
  ontologyConceptTypes,
  type WorkspaceOntologyActive,
} from "./workspace-ontology";
import {
  ONTOLOGY_REVIEW_MAX_DIAGNOSTICS,
  ONTOLOGY_REVIEW_MAX_CODE_CHARS,
  ONTOLOGY_REVIEW_MAX_IDENTITY_CHARS,
  ONTOLOGY_REVIEW_MAX_MESSAGE_CHARS,
  boundedOntologyReviewText,
  summarizeOntologyGraphEffects,
  type OntologyKeepResult,
  type OntologyRejectResult,
  type OntologyReviewGuard,
  type OntologyReviewState,
} from "./ontology-review";
import {
  GRAPH_CONCEPT_DETAIL_MAX_BYTES,
  GRAPH_CONCEPT_DETAIL_MAX_EVIDENCE,
  GRAPH_CONCEPT_DETAIL_MAX_FINDINGS,
  GRAPH_CONCEPT_DETAIL_MAX_PROPERTIES,
  GRAPH_CONCEPT_DETAIL_MAX_RELATIONS,
  GRAPH_CONCEPT_SUMMARY_MAX_BYTES,
  GRAPH_CONCEPT_SUMMARY_MAX_ITEMS,
  compileGraphTopology,
  type BoundedGraphConceptDetail,
  type GraphConceptDetailByIndexResult,
  type GraphConceptLookupReference,
  type GraphConceptLookupResult,
  type GraphConceptRelationDetail,
  type GraphConceptSummary,
  type GraphConceptSummaryResult,
  type GraphTopology,
  type GraphTopologyCompilation,
} from "./graph-projection";
import type { WorkspaceModel, NoteDocument } from "./types";
import { listMarkdownFiles, WorkspaceFiles } from "./workspace";

export type NoteId = `note:${string}`;
export type GraphResolution = "resolved" | "unresolved" | "ambiguous" | "external";

export interface WorkspaceGraphNote {
  id: NoteId;
  filePath: string;
  rootId: string;
  relativePath: string;
  title: string;
  tags: readonly string[];
  frontmatter: Record<string, unknown>;
}

export interface WorkspaceGraphLink {
  source: NoteId;
  target: string;
  label: string;
  resolution: GraphResolution;
  note?: WorkspaceGraphNote;
  sourceRange?: { from: number; to: number };
}

export interface WorkspaceGraphNeighborhoodRelation {
  source: NoteId;
  target: NoteId;
  label: string;
  predicate: string;
  origin: "ontology";
  evidence: readonly RelationEvidence[];
}

export interface WorkspaceGraphContext {
  note: WorkspaceGraphNote;
  outgoing: readonly WorkspaceGraphLink[];
  backlinks: readonly WorkspaceGraphLink[];
  unresolved: readonly WorkspaceGraphLink[];
  neighborhood: readonly WorkspaceGraphNote[];
  neighborhoodRelations: readonly WorkspaceGraphNeighborhoodRelation[];
}

export interface WorkspaceGraphStatus {
  state: "ready" | "stale" | "building";
  noteCount: number;
  edgeCount: number;
}

interface GraphEntry {
  note: WorkspaceGraphNote;
  document: NoteDocument;
  sourceRevision: string;
}

interface ResolutionIndex {
  byRelativeStem: ReadonlyMap<string, readonly GraphEntry[]>;
  byBasename: ReadonlyMap<string, readonly GraphEntry[]>;
}

interface ResolvedGraphEpoch {
  graph: Map<string, GraphEntry>;
  outgoingByConcept: ReadonlyMap<NoteId, readonly WorkspaceGraphLink[]>;
  incomingByConcept: ReadonlyMap<NoteId, readonly WorkspaceGraphLink[]>;
}

interface KnowledgeDetailIndex {
  concepts: ReadonlyMap<string, ConceptNode>;
  findings: ReadonlyMap<string, readonly GraphFinding[]>;
  relations: ReadonlyMap<string, readonly GraphConceptRelationDetail[]>;
}

interface StagedOntologyReview {
  guard: OntologyReviewGuard;
  snapshot: KnowledgeGraphSnapshot | null;
  sourceRevision: string;
}

const NON_ACTIONABLE_ONTOLOGY_REVIEW_BASE = "not-pending";

/** The one graph boundary for note relationships. It owns indexing and resolution. */
export class WorkspaceGraph {
  private snapshot: Map<string, GraphEntry> | null = null;
  private state: WorkspaceGraphStatus["state"] = "stale";
  private generation = 0;
  private buildInFlight: { generation: number; promise: Promise<Map<string, GraphEntry>> } | null = null;
  private readonly refreshVersions = new Map<string, number>();
  private readonly knowledgeSnapshotCache = new Map<string, KnowledgeGraphSnapshot>();
  private readonly topologyCache = new Map<string, GraphTopologyCompilation>();
  private readonly knowledgeDetailIndexes = new Map<string, KnowledgeDetailIndex>();
  private resolvedEpoch: ResolvedGraphEpoch | null = null;
  private readonly ontologyStore: WorkspaceOntologyStore | null;
  private activeOntology: WorkspaceOntologyActive | null = null;
  private activeOntologyInFlight: Promise<WorkspaceOntologyActive> | null = null;
  private stagedOntologyReview: StagedOntologyReview | null = null;

  constructor(private readonly model: WorkspaceModel, options: { runtimeRoot?: string } = {}) {
    this.ontologyStore = options.runtimeRoot
      ? new WorkspaceOntologyStore({ workspaceRoot: model.workspaceRoot, runtimeRoot: options.runtimeRoot })
      : null;
  }

  async resolveLink(sourceFilePath: string, target: string): Promise<WorkspaceGraphLink> {
    const graph = await this.build();
    const source = this.findByPath(graph, sourceFilePath);
    const label = target.trim();
    if (/^https?:\/\//i.test(label)) {
      return { source: source?.note.id ?? this.idForPath(sourceFilePath), target: label, label, resolution: "external" };
    }
    const resolved = this.resolveTarget(graph, source?.note, label);
    return {
      source: source?.note.id ?? this.idForPath(sourceFilePath),
      target: label,
      label,
      resolution: resolved.status,
      note: resolved.note,
    };
  }

  async contextForNote(filePath: string): Promise<WorkspaceGraphContext | null> {
    const graph = await this.build();
    const epoch = this.resolveEpoch(graph);
    const entry = this.findByPath(graph, filePath);
    if (!entry) return null;
    const outgoing = epoch.outgoingByConcept.get(entry.note.id) ?? [];
    const backlinks = epoch.incomingByConcept.get(entry.note.id) ?? [];
    const ontologyNeighborhood = await this.ontologyNeighborhoodRelations(entry, graph);
    const neighborhoodRelations = ontologyNeighborhood.relations;
    const neighborhood = new Map<string, WorkspaceGraphNote>([[entry.note.id, entry.note]]);
    for (const link of [...outgoing, ...backlinks]) if (link.note) neighborhood.set(link.note.id, link.note);
    for (const note of ontologyNeighborhood.notes) neighborhood.set(note.id, note);
    return {
      note: entry.note,
      outgoing,
      backlinks,
      unresolved: outgoing.filter((link) => link.resolution === "unresolved" || link.resolution === "ambiguous"),
      neighborhood: Array.from(neighborhood.values()).sort(byPath),
      neighborhoodRelations,
    };
  }

  async backlinks(filePath: string): Promise<readonly WorkspaceGraphLink[]> {
    return (await this.contextForNote(filePath))?.backlinks ?? [];
  }

  async linksFrom(filePath: string): Promise<readonly WorkspaceGraphLink[]> {
    const graph = await this.build();
    const entry = this.findByPath(graph, filePath);
    return entry ? this.resolveEpoch(graph).outgoingByConcept.get(entry.note.id) ?? [] : [];
  }

  async unresolved(filePath?: string): Promise<readonly WorkspaceGraphLink[]> {
    if (filePath) return (await this.linksFrom(filePath)).filter((link) => link.resolution === "unresolved" || link.resolution === "ambiguous");
    const graph = await this.build();
    return [...this.resolveEpoch(graph).outgoingByConcept.values()].flatMap((links) =>
      links.filter((link) => link.resolution === "unresolved" || link.resolution === "ambiguous"),
    );
  }

  async neighborhood(filePath: string): Promise<readonly WorkspaceGraphNote[]> {
    return (await this.contextForNote(filePath))?.neighborhood ?? [];
  }

  /**
   * Builds the renderer- and profile-neutral semantic contract from the same
   * entries that power Connections. Markdown remains canonical; callers receive
   * a deterministic derived snapshot and never a mutable graph database.
   */
  async knowledgeSnapshot(profileId?: string | null): Promise<KnowledgeGraphSnapshot> {
    return this.buildKnowledgeSnapshot(await this.loadActiveOntology(), profileId, true);
  }

  private async buildKnowledgeSnapshot(
    ontologyActive: WorkspaceOntologyActive,
    profileId?: string | null,
    cache = false,
  ): Promise<KnowledgeGraphSnapshot> {
    const activeOntology = {
      state: ontologyActive.state,
      ...(ontologyActive.ontology ? {
        id: ontologyActive.ontology.id,
        version: ontologyActive.ontology.version,
        revision: ontologyActive.ontology.revision,
      } : {}),
    };
    const cacheKey = ontologySnapshotCacheKey(profileId, activeOntology);
    const cached = cache ? this.knowledgeSnapshotCache.get(cacheKey) : undefined;
    if (cached) return cached;
    const graph = await this.build();
    const epoch = this.resolveEpoch(graph);
    const profile = knowledgeProfile(profileId);
    const concepts = new Map<string, ConceptNode>();
    const relations: RelationEdge[] = [];
    const findings: GraphFinding[] = [];
    const formatConcepts: ConceptNode[] = [];

    for (const entry of [...graph.values()].sort((left, right) => byPath(left.note, right.note))) {
      const formatTypes = profile.conceptTypes(entry.document.frontmatter);
      const concept: ConceptNode = {
        id: entry.note.id,
        noteId: entry.note.id,
        label: entry.note.title,
        conceptTypes: ontologyConceptTypes(
          ontologyActive.ontology,
          entry.document.frontmatter,
          entry.note.relativePath,
          formatTypes,
        ),
        properties: graphPropertyRecord(entry.document.frontmatter),
        resolution: "resolved",
        filePath: entry.note.filePath,
        rootId: entry.note.rootId,
        relativePath: entry.note.relativePath,
        tags: [...entry.note.tags],
      };
      concepts.set(entry.note.id, concept);
      formatConcepts.push({ ...concept, conceptTypes: formatTypes });

      const relationCounts = new Map<string, number>();
      (epoch.outgoingByConcept.get(entry.note.id) ?? []).forEach((link) => {
        const targetId = link.note?.id ?? conceptIdForLink(entry.note.id, link.target, link.resolution);
        if (!link.note) {
          concepts.set(targetId, {
            id: targetId,
            label: link.label || link.target,
            conceptTypes: [],
            properties: {},
            resolution: link.resolution === "external" ? "external" : "unresolved",
            tags: [],
          });
        }
        const relationKey = `${entry.note.id}\u0000${targetId}\u0000references\u0000${link.label}`;
        const occurrence = relationCounts.get(relationKey) ?? 0;
        relationCounts.set(relationKey, occurrence + 1);
        const relation: RelationEdge = {
          id: `relation:link:${encodeURIComponent(entry.note.id)}:${encodeURIComponent(targetId)}:${occurrence}`,
          source: entry.note.id,
          target: targetId,
          family: "link",
          predicate: "references",
          origin: "document",
          resolution: link.resolution,
          directed: true,
          label: link.label,
          evidence: link.sourceRange
            ? [{ kind: "source-span", noteId: entry.note.id, sourceRange: link.sourceRange, detail: link.target }]
            : [],
        };
        relations.push(relation);
        if (link.resolution === "unresolved" || link.resolution === "ambiguous") {
          findings.push({
            id: `finding:${link.resolution}:${relation.id}`,
            severity: "warning",
            code: `relation.${link.resolution}`,
            message: `${entry.note.title} has an ${link.resolution} link to ${link.target}.`,
            conceptIds: [entry.note.id, targetId],
            relationIds: [relation.id],
            evidence: relation.evidence,
          });
        }
      });

      extractTags(entry.document.body, entry.document.frontmatter).forEach(({ tag, occurrences }) => {
        const tagId = `tag:${tag}`;
        concepts.set(tagId, {
          id: tagId,
          label: `#${tag}`,
          conceptTypes: ["tag"],
          properties: { name: tag },
          resolution: "resolved",
          tags: [],
        });
        const evidence: RelationEvidence[] = occurrences.flatMap((occurrence): RelationEvidence[] => occurrence.source === "frontmatter"
          ? [{ kind: "property", noteId: entry.note.id, property: "tags", detail: tag }]
          : occurrence.sourceRange
            ? [{ kind: "source-span", noteId: entry.note.id, sourceRange: occurrence.sourceRange, detail: `#${tag}` }]
            : []);
        relations.push({
          id: `relation:tag:${encodeURIComponent(entry.note.id)}:${encodeURIComponent(tag)}`,
          source: entry.note.id,
          target: tagId,
          family: "tag-membership",
          predicate: "has-tag",
          origin: "document",
          resolution: "resolved",
          directed: true,
          evidence,
        });
      });
    }

    const ontologyInterpretation = interpretWorkspaceOntology(
      ontologyActive.ontology,
      [...concepts.values()],
      (source, reference) => {
        const sourceEntry = source.filePath ? graph.get(path.resolve(source.filePath)) : undefined;
        const resolved = this.resolveTarget(graph, sourceEntry?.note, reference);
        return {
          targetId: resolved.note?.id ?? conceptIdForLink(source.id, reference, resolved.status),
          resolution: resolved.status,
        };
      },
    );
    for (const concept of ontologyInterpretation.concepts) concepts.set(concept.id, concept);
    relations.push(...ontologyInterpretation.relations);

    const sortedConcepts = [...concepts.values()].sort(byId);
    const sortedRelations = relations.sort(byId);
    const scope = {
      workspaceRoot: this.model.workspaceRoot,
      noteRootIds: this.roots().map((root) => root.id).sort(),
      paths: [...graph.keys()].sort(),
    };
    const activeProfile = profile.status;
    const allFindings = [
      ...findings,
      ...profile.validate(formatConcepts.sort(byId)),
      ...ontologyActiveDiagnostics(ontologyActive),
      ...ontologyInterpretation.findings,
    ].sort(byId);
    const snapshotId = knowledgeGraphSnapshotId(
      scope,
      sortedConcepts,
      sortedRelations,
      allFindings,
      activeProfile,
      activeOntology,
    );
    const snapshot: KnowledgeGraphSnapshot = {
      version: KNOWLEDGE_GRAPH_VERSION,
      snapshotId,
      generatedAt: new Date().toISOString(),
      scope,
      concepts: sortedConcepts,
      relations: sortedRelations,
      findings: allFindings,
      activeProfile,
      activeOntology,
    };
    if (cache) this.knowledgeSnapshotCache.set(cacheKey, snapshot);
    return snapshot;
  }

  async previewOntology(): Promise<OntologyReviewState> {
    const store = this.requireOntologyStore();
    const [candidate, active] = await Promise.all([
      store.inspectCandidate(),
      this.loadActiveOntology(),
    ]);
    const candidateRevision = candidate.sourceRevision ?? null;
    const candidatePending = candidate.state === "absent"
      ? active.state === "active"
      : candidateRevision !== null && candidateRevision !== active.sourceRevision;
    const diagnostics = candidate.diagnostics.slice(0, ONTOLOGY_REVIEW_MAX_DIAGNOSTICS)
      .map(({ severity, code, message }) => ({
        severity,
        code: boundedOntologyReviewText(code, ONTOLOGY_REVIEW_MAX_CODE_CHARS),
        message: boundedOntologyReviewText(message, ONTOLOGY_REVIEW_MAX_MESSAGE_CHARS),
      }));
    const candidateIdentity = {
      state: candidate.state,
      ...(candidate.ontology ? {
        id: boundedOntologyReviewText(candidate.ontology.id, ONTOLOGY_REVIEW_MAX_IDENTITY_CHARS),
        ...(candidate.ontology.label ? { label: boundedOntologyReviewText(candidate.ontology.label, ONTOLOGY_REVIEW_MAX_IDENTITY_CHARS) } : {}),
        version: boundedOntologyReviewText(candidate.ontology.version, ONTOLOGY_REVIEW_MAX_IDENTITY_CHARS),
      } : {}),
      revision: candidateRevision,
      pending: candidatePending,
      rejected: candidateRevision !== null
        ? candidateRevision === active.rejectedCandidateRevision
        : active.sourceRevision !== undefined
          && active.rejectedCandidateRevision === absentWorkspaceOntologyCandidateRevision(active.sourceRevision),
    };
    if (!candidatePending) {
      this.stagedOntologyReview = null;
      return {
        active: ontologyReviewIdentity(active),
        candidate: candidateIdentity,
        guard: {
          candidateRevision,
          activationRevision: active.activationRevision,
          baseSnapshotId: NON_ACTIONABLE_ONTOLOGY_REVIEW_BASE,
        },
        diagnostics,
        omittedDiagnostics: Math.max(0, candidate.diagnostics.length - diagnostics.length),
      };
    }
    const { snapshot: baseSnapshot, sourceRevision } = await this.ontologyReviewBase();
    const guard: OntologyReviewGuard = {
      candidateRevision,
      activationRevision: active.activationRevision,
      baseSnapshotId: baseSnapshot.snapshotId,
    };
    let candidateSnapshot: KnowledgeGraphSnapshot | null = null;
    if (candidatePending && candidate.state === "valid" && candidate.ontology) {
      candidateSnapshot = await this.buildKnowledgeSnapshot({
        state: "active",
        ontology: candidate.ontology,
        activationRevision: active.activationRevision,
        sourceRevision: candidate.sourceRevision,
        diagnostics: [],
      });
    } else if (candidatePending && candidate.state === "absent" && active.state === "active") {
      candidateSnapshot = await this.buildKnowledgeSnapshot(genericOntologyActive());
    }
    this.stagedOntologyReview = candidatePending && (candidateSnapshot || candidateRevision !== null)
      ? { guard, snapshot: candidateSnapshot, sourceRevision }
      : null;
    return {
      active: ontologyReviewIdentity(active),
      candidate: candidateIdentity,
      guard,
      ...(candidateSnapshot ? { effects: summarizeOntologyGraphEffects(baseSnapshot, candidateSnapshot) } : {}),
      diagnostics,
      omittedDiagnostics: Math.max(0, candidate.diagnostics.length - diagnostics.length),
    };
  }

  async keepOntology(guard: OntologyReviewGuard): Promise<OntologyKeepResult> {
    const store = this.requireOntologyStore();
    const staged = this.stagedOntologyReview;
    const sourceRevision = await this.workspaceMarkdownRevision();
    if (!staged || staged.sourceRevision !== sourceRevision) {
      await this.reloadGraphFromDisk();
      return { status: "stale", review: await this.previewOntology() };
    }
    const currentActive = await this.loadActiveOntology();
    const currentBase = await this.knowledgeSnapshot();
    const candidate = await store.inspectCandidate();
    if (!staged?.snapshot
      || !sameOntologyGuard(staged.guard, guard)
      || (candidate.sourceRevision ?? null) !== guard.candidateRevision
      || currentActive.activationRevision !== guard.activationRevision
      || currentBase.snapshotId !== guard.baseSnapshotId) {
      return { status: "stale", review: await this.previewOntology() };
    }
    let state;
    try {
      state = guard.candidateRevision === null
        ? await store.keepReviewedGeneric(guard.activationRevision)
        : await store.keepReviewedCandidate(guard.candidateRevision, guard.activationRevision);
    } catch (error) {
      if (!isOntologyReviewRace(error)) throw error;
      return { status: "stale", review: await this.previewOntology() };
    }
    this.activeOntology = state.active;
    this.activeOntologyInFlight = null;
    this.knowledgeSnapshotCache.clear();
    this.topologyCache.clear();
    this.knowledgeDetailIndexes.clear();
    const cacheKey = ontologySnapshotCacheKey(undefined, staged.snapshot.activeOntology);
    this.knowledgeSnapshotCache.set(cacheKey, staged.snapshot);
    this.stagedOntologyReview = null;
    return { status: "applied", review: await this.previewOntology() };
  }

  async rejectOntology(guard: OntologyReviewGuard): Promise<OntologyRejectResult> {
    const store = this.requireOntologyStore();
    const staged = this.stagedOntologyReview;
    const sourceRevision = await this.workspaceMarkdownRevision();
    if (!staged || staged.sourceRevision !== sourceRevision) {
      await this.reloadGraphFromDisk();
      return { status: "stale", review: await this.previewOntology() };
    }
    const active = await this.loadActiveOntology();
    const base = await this.knowledgeSnapshot();
    const candidate = await store.inspectCandidate();
    if (!staged
      || !sameOntologyGuard(staged.guard, guard)
      || (candidate.sourceRevision ?? null) !== guard.candidateRevision
      || active.activationRevision !== guard.activationRevision
      || base.snapshotId !== guard.baseSnapshotId) {
      return { status: "stale", review: await this.previewOntology() };
    }
    let state;
    try {
      state = guard.candidateRevision === null
        ? await store.rejectReviewedGeneric(guard.activationRevision)
        : await store.rejectReviewedCandidate(guard.candidateRevision, guard.activationRevision);
    } catch (error) {
      if (!isOntologyReviewRace(error)) throw error;
      return { status: "stale", review: await this.previewOntology() };
    }
    this.activeOntology = state.active;
    this.activeOntologyInFlight = null;
    this.stagedOntologyReview = null;
    return { status: "rejected", review: await this.previewOntology() };
  }

  async graphTopology(profileId?: string | null): Promise<GraphTopology> {
    const snapshot = await this.knowledgeSnapshot(profileId);
    return this.topologyForSnapshot(snapshot, profileId).topology;
  }

  async graphConceptSummaries(
    indexes: readonly number[],
    sourceSnapshotId: string,
    profileId?: string | null,
  ): Promise<GraphConceptSummaryResult> {
    if (indexes.length > GRAPH_CONCEPT_SUMMARY_MAX_ITEMS) {
      throw new Error(`Graph concept summary requests are limited to ${GRAPH_CONCEPT_SUMMARY_MAX_ITEMS} nodes.`);
    }
    const normalizedIndexes = [...new Set(indexes)];
    if (normalizedIndexes.some((index) => !Number.isSafeInteger(index) || index < 0)) {
      throw new Error("Graph concept summary indices must be non-negative safe integers.");
    }
    const snapshot = await this.knowledgeSnapshot(profileId);
    if (snapshot.snapshotId !== sourceSnapshotId) {
      return boundedSummaryResult({ status: "stale", sourceSnapshotId: snapshot.snapshotId, summaries: [] });
    }
    const conceptIds = this.conceptIdsForSnapshot(snapshot, profileId);
    if (normalizedIndexes.some((index) => index >= conceptIds.length)) {
      return boundedSummaryResult({ status: "missing", sourceSnapshotId: snapshot.snapshotId, summaries: [] });
    }
    const detailIndex = this.detailIndex(snapshot);
    const summaries = normalizedIndexes.map((index) => {
      const concept = detailIndex.concepts.get(conceptIds[index] ?? "");
      return concept ? graphConceptSummary(index, concept) : null;
    });
    if (summaries.some((summary) => summary === null)) {
      return boundedSummaryResult({ status: "missing", sourceSnapshotId: snapshot.snapshotId, summaries: [] });
    }
    const result = boundedSummaryResult({
      status: "ok",
      sourceSnapshotId: snapshot.snapshotId,
      summaries: summaries.filter((summary): summary is NonNullable<typeof summary> => summary !== null),
    });
    if (result.payloadBytes <= GRAPH_CONCEPT_SUMMARY_MAX_BYTES) return result;
    return boundedSummaryResult({ status: "too-large", sourceSnapshotId: snapshot.snapshotId, summaries: [] });
  }

  async graphConceptLookup(
    reference: GraphConceptLookupReference,
    sourceSnapshotId: string,
    profileId?: string | null,
  ): Promise<GraphConceptLookupResult> {
    const normalizedReference = validateGraphConceptLookupReference(reference);
    const snapshot = await this.knowledgeSnapshot(profileId);
    if (snapshot.snapshotId !== sourceSnapshotId) {
      return boundedLookupResult({ status: "stale", sourceSnapshotId: snapshot.snapshotId });
    }
    const compilation = this.topologyForSnapshot(snapshot, profileId);
    const index = normalizedReference.kind === "concept-id"
      ? compilation.conceptIndexById.get(normalizedReference.value)
      : compilation.conceptIndexByFilePath.get(normalizedReference.value);
    if (index === undefined) {
      return boundedLookupResult({ status: "missing", sourceSnapshotId: snapshot.snapshotId });
    }
    const conceptId = compilation.conceptIds[index];
    const concept = conceptId ? this.detailIndex(snapshot).concepts.get(conceptId) : undefined;
    if (!concept) {
      return boundedLookupResult({ status: "missing", sourceSnapshotId: snapshot.snapshotId });
    }
    const result = boundedLookupResult({
      status: "ok",
      sourceSnapshotId: snapshot.snapshotId,
      summary: graphConceptSummary(index, concept),
    });
    if (result.payloadBytes > GRAPH_CONCEPT_SUMMARY_MAX_BYTES) {
      throw new Error(`Graph concept lookup exceeded the ${GRAPH_CONCEPT_SUMMARY_MAX_BYTES}-byte limit.`);
    }
    return result;
  }

  async graphConceptDetailByIndex(
    index: number,
    sourceSnapshotId: string,
    profileId?: string | null,
  ): Promise<GraphConceptDetailByIndexResult> {
    if (!Number.isSafeInteger(index) || index < 0) throw new Error("Graph concept detail index must be a non-negative safe integer.");
    const snapshot = await this.knowledgeSnapshot(profileId);
    if (snapshot.snapshotId !== sourceSnapshotId) {
      return boundedDetailResult({ status: "stale", sourceSnapshotId: snapshot.snapshotId, index });
    }
    const conceptIds = this.conceptIdsForSnapshot(snapshot, profileId);
    const conceptId = conceptIds[index];
    if (!conceptId) return boundedDetailResult({ status: "missing", sourceSnapshotId: snapshot.snapshotId, index });
    const detailIndex = this.detailIndex(snapshot);
    const concept = detailIndex.concepts.get(conceptId);
    if (!concept) return boundedDetailResult({ status: "missing", sourceSnapshotId: snapshot.snapshotId, index });
    return boundedConceptDetailResult(
      snapshot,
      index,
      concept,
      detailIndex.relations.get(conceptId) ?? [],
      detailIndex.findings.get(conceptId) ?? [],
    );
  }

  async status(): Promise<WorkspaceGraphStatus> {
    if (!this.snapshot) return { state: this.state, noteCount: 0, edgeCount: 0 };
    const edgeCount = Array.from(this.snapshot.values()).reduce((count, entry) => count + extractWikilinks(entry.document.body).length + extractMarkdownLinks(entry.document.body).length, 0);
    return { state: this.state, noteCount: this.snapshot.size, edgeCount };
  }

  async rebuild(): Promise<WorkspaceGraphStatus> {
    this.invalidate();
    await this.build();
    return this.status();
  }

  invalidate(): void {
    this.snapshot = null;
    this.resolvedEpoch = null;
    this.knowledgeSnapshotCache.clear();
    this.topologyCache.clear();
    this.knowledgeDetailIndexes.clear();
    this.state = "stale";
    this.generation += 1;
  }

  /** Applies one filesystem event without discarding an already-built graph. */
  async refreshFile(filePath: string): Promise<void> {
    const resolvedPath = path.resolve(filePath);
    if (!/\.md$/i.test(resolvedPath)) return;
    const root = this.roots().find((candidate) => isWithin(candidate.path, resolvedPath));
    if (!root) return;

    const generation = this.generation;
    const refreshVersion = (this.refreshVersions.get(resolvedPath) ?? 0) + 1;
    this.refreshVersions.set(resolvedPath, refreshVersion);

    // A rebuild owns the initial snapshot. Apply this event after it publishes so
    // a file changed mid-build cannot be overwritten by an older bulk read.
    if (!this.snapshot) {
      const inFlight = this.buildInFlight?.generation === generation ? this.buildInFlight.promise : null;
      if (!inFlight) return;
      try { await inFlight; } catch { return; }
    }
    if (generation !== this.generation || this.refreshVersions.get(resolvedPath) !== refreshVersion) return;

    const entry = await this.readEntry(resolvedPath, root).catch(() => null);
    if (generation !== this.generation || this.refreshVersions.get(resolvedPath) !== refreshVersion) return;
    if (!this.snapshot) return;
    const previous = this.snapshot.get(resolvedPath);
    if (entry?.sourceRevision === previous?.sourceRevision || (!entry && !previous)) return;
    if (entry) this.snapshot.set(resolvedPath, entry);
    else this.snapshot.delete(resolvedPath);
    this.resolvedEpoch = null;
    this.knowledgeSnapshotCache.clear();
    this.topologyCache.clear();
    this.knowledgeDetailIndexes.clear();
    this.state = "ready";
  }

  private async build(): Promise<Map<string, GraphEntry>> {
    if (this.snapshot) return this.snapshot;
    const generation = this.generation;
    if (this.buildInFlight?.generation === generation) return this.buildInFlight.promise;
    this.state = "building";
    const promise = this.buildSnapshot(generation)
      .catch((error) => {
        if (generation === this.generation) this.state = "stale";
        throw error;
      })
      .finally(() => {
        if (this.buildInFlight?.generation === generation) this.buildInFlight = null;
      });
    this.buildInFlight = { generation, promise };
    return promise;
  }

  private async buildSnapshot(generation: number): Promise<Map<string, GraphEntry>> {
    const roots = this.roots();
    const files = (await listMarkdownFiles(roots.map((root) => root.path))).map((filePath) => path.resolve(filePath)).sort();
    const authorized = new WorkspaceFiles(roots.map((root) => root.path));
    const graph = new Map<string, GraphEntry>();
    const readConcurrency = 32;
    for (let offset = 0; offset < files.length; offset += readConcurrency) {
      const batch = files.slice(offset, offset + readConcurrency);
      const entries = await Promise.all(batch.map(async (filePath) => {
        const root = roots.find((candidate) => isWithin(candidate.path, filePath));
        return root ? this.readEntry(filePath, root, authorized) : null;
      }));
      entries.forEach((entry, index) => {
        if (entry) graph.set(batch[index], entry);
      });
    }
    if (generation === this.generation) {
      this.snapshot = graph;
      this.state = "ready";
    }
    return graph;
  }

  private roots(): Array<WorkspaceModel["noteRoots"][number] & { path: string }> {
    return this.model.noteRoots.map((root) => ({ ...root, path: path.resolve(root.path) }));
  }

  private async readEntry(
    filePath: string,
    root: WorkspaceModel["noteRoots"][number] & { path: string },
    authorized = new WorkspaceFiles(this.roots().map((candidate) => candidate.path)),
  ): Promise<GraphEntry | null> {
    try { await authorized.existing(filePath); } catch { return null; }
    const raw = await readFile(filePath, "utf8");
    const document = parseWorkspaceDocument(filePath, raw);
    const relativePath = normalize(path.relative(root.path, filePath));
    const note: WorkspaceGraphNote = {
      id: workspaceNoteId(root.id, relativePath),
      filePath,
      rootId: root.id,
      relativePath,
      title: document.title,
      tags: extractTags(document.body, document.frontmatter).map((tag) => tag.tag).sort(),
      frontmatter: document.frontmatter,
    };
    return { note, document, sourceRevision: contentRevision(raw) };
  }

  private async ontologyReviewBase(): Promise<{ snapshot: KnowledgeGraphSnapshot; sourceRevision: string }> {
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const graph = await this.build();
      const sourceRevision = graphSourceRevision(graph);
      if (sourceRevision === await this.workspaceMarkdownRevision()) {
        return { snapshot: await this.knowledgeSnapshot(), sourceRevision };
      }
      await this.reloadGraphFromDisk();
    }
    throw new Error("Workspace Notes changed while Ontology review was being prepared.");
  }

  private async reloadGraphFromDisk(): Promise<void> {
    this.invalidate();
    await this.build();
  }

  private async workspaceMarkdownRevision(): Promise<string> {
    const roots = this.roots();
    const files = (await listMarkdownFiles(roots.map((root) => root.path))).map((filePath) => path.resolve(filePath)).sort();
    const authorized = new WorkspaceFiles(roots.map((root) => root.path));
    const hash = createHash("sha256");
    for (let offset = 0; offset < files.length; offset += 32) {
      const batch = files.slice(offset, offset + 32);
      const revisions = await Promise.all(batch.map(async (filePath) => {
        await authorized.existing(filePath);
        return contentRevision(await readFile(filePath));
      }));
      batch.forEach((filePath, index) => hash.update(filePath).update("\0").update(revisions[index] ?? "").update("\0"));
    }
    return hash.digest("hex");
  }

  private findByPath(graph: Map<string, GraphEntry>, filePath: string): GraphEntry | undefined { return graph.get(path.resolve(filePath)); }

  private linksFromGraph(graph: Map<string, GraphEntry>, entry: GraphEntry, index = resolutionIndex(graph)): WorkspaceGraphLink[] {
    const links: WorkspaceGraphLink[] = [];
    for (const item of extractWikilinks(entry.document.body)) links.push(this.makeLink(graph, index, entry, item.target, item.label, item.sourceRange));
    for (const item of extractMarkdownLinks(entry.document.body)) links.push(this.makeLink(graph, index, entry, item.target, item.label, item.sourceRange));
    return links;
  }

  private async ontologyNeighborhoodRelations(
    entry: GraphEntry,
    graph: Map<string, GraphEntry>,
  ): Promise<{ relations: WorkspaceGraphNeighborhoodRelation[]; notes: WorkspaceGraphNote[] }> {
    const active = await this.loadActiveOntology();
    if (active.state !== "active") return { relations: [], notes: [] };
    const snapshot = await this.knowledgeSnapshot();
    const index = this.detailIndex(snapshot);
    const relations: WorkspaceGraphNeighborhoodRelation[] = [];
    const noteById = new Map<NoteId, WorkspaceGraphNote>();
    for (const detail of index.relations.get(entry.note.id) ?? []) {
      const relation = detail.relation;
      if (relation.origin !== "ontology" || relation.resolution !== "resolved") continue;
      const source = index.concepts.get(relation.source);
      const target = index.concepts.get(relation.target);
      const sourceEntry = source?.filePath ? graph.get(path.resolve(source.filePath)) : undefined;
      const targetEntry = target?.filePath ? graph.get(path.resolve(target.filePath)) : undefined;
      if (!sourceEntry || !targetEntry) continue;
      const predicate = relation.predicate ?? relation.family;
      noteById.set(sourceEntry.note.id, sourceEntry.note);
      noteById.set(targetEntry.note.id, targetEntry.note);
      relations.push({
        source: sourceEntry.note.id,
        target: targetEntry.note.id,
        label: relation.label ?? predicate,
        predicate,
        origin: "ontology",
        evidence: relation.evidence.slice(0, 4).map((item) => ({
          ...item,
          ...(item.producer ? {
            producer: {
              id: item.producer.id.slice(0, 128),
              version: item.producer.version.slice(0, 128),
            },
          } : {}),
          ...(item.detail ? { detail: item.detail.slice(0, 256) } : {}),
        })),
      });
    }
    const boundedRelations = relations
      .sort((left, right) => left.source.localeCompare(right.source) || left.target.localeCompare(right.target) || left.predicate.localeCompare(right.predicate))
      .slice(0, 64);
    const noteIds = new Set(boundedRelations.flatMap((relation) => [relation.source, relation.target]));
    return {
      relations: boundedRelations,
      notes: [...noteIds].flatMap((id) => noteById.get(id) ?? []).sort(byPath),
    };
  }

  private resolveEpoch(graph: Map<string, GraphEntry>): ResolvedGraphEpoch {
    if (this.resolvedEpoch?.graph === graph) return this.resolvedEpoch;
    const index = resolutionIndex(graph);
    const outgoingByConcept = new Map<NoteId, readonly WorkspaceGraphLink[]>();
    const incoming = new Map<NoteId, WorkspaceGraphLink[]>();
    for (const entry of graph.values()) {
      const outgoing = this.linksFromGraph(graph, entry, index);
      outgoingByConcept.set(entry.note.id, outgoing);
      for (const link of outgoing) {
        if (!link.note) continue;
        const backlink = {
          ...link,
          label: entry.note.title,
          target: entry.note.filePath,
          note: entry.note,
        };
        const current = incoming.get(link.note.id);
        if (current) current.push(backlink);
        else incoming.set(link.note.id, [backlink]);
      }
    }
    this.resolvedEpoch = { graph, outgoingByConcept, incomingByConcept: incoming };
    return this.resolvedEpoch;
  }

  private makeLink(graph: Map<string, GraphEntry>, index: ResolutionIndex, source: GraphEntry, target: string, label: string, sourceRange?: { from: number; to: number }): WorkspaceGraphLink {
    const clean = target.split("#")[0]?.split("?")[0]?.trim() ?? target.trim();
    if (/^https?:\/\//i.test(clean)) return { source: source.note.id, target: clean, label, resolution: "external", sourceRange };
    const resolved = this.resolveTarget(graph, source.note, clean, index);
    return { source: source.note.id, target: clean, label, resolution: resolved.status, note: resolved.note, sourceRange };
  }

  private resolveTarget(graph: Map<string, GraphEntry>, source: WorkspaceGraphNote | undefined, target: string, index = resolutionIndex(graph)): { status: GraphResolution; note?: WorkspaceGraphNote } {
    const normalized = normalize(target.replace(/\.md(?:own)?$/i, ""));
    if (source && (target.includes("/") || target.endsWith(".md"))) {
      const candidate = path.resolve(path.dirname(source.filePath), target.endsWith(".md") ? target : `${target}.md`);
      const exact = graph.get(candidate);
      if (exact) return { status: "resolved", note: exact.note };
    }
    const relative = index.byRelativeStem.get(normalized) ?? [];
    if (relative.length === 1) return { status: "resolved", note: relative[0].note };
    if (relative.length > 1) return { status: "ambiguous" };
    const basename = index.byBasename.get(path.basename(normalized).toLowerCase()) ?? [];
    if (basename.length === 1) return { status: "resolved", note: basename[0].note };
    return { status: basename.length > 1 ? "ambiguous" : "unresolved" };
  }

  private idForPath(filePath: string): NoteId { return `note:unknown:${canonicalPath(path.basename(filePath))}` as NoteId; }

  private conceptIdsForSnapshot(snapshot: KnowledgeGraphSnapshot, profileId?: string | null): readonly string[] {
    return this.topologyForSnapshot(snapshot, profileId).conceptIds;
  }

  private topologyForSnapshot(snapshot: KnowledgeGraphSnapshot, profileId?: string | null): GraphTopologyCompilation {
    const cacheKey = profileCacheKey(profileId);
    const cached = this.topologyCache.get(cacheKey);
    if (cached?.topology.sourceSnapshotId === snapshot.snapshotId) return cached;
    const compilation = compileGraphTopology(snapshot);
    this.topologyCache.set(cacheKey, compilation);
    return compilation;
  }

  private detailIndex(snapshot: KnowledgeGraphSnapshot): KnowledgeDetailIndex {
    const cached = this.knowledgeDetailIndexes.get(snapshot.snapshotId);
    if (cached) return cached;
    const findings = new Map<string, GraphFinding[]>();
    for (const finding of snapshot.findings) {
      for (const conceptId of finding.conceptIds) {
        const current = findings.get(conceptId);
        if (current) current.push(finding);
        else findings.set(conceptId, [finding]);
      }
    }
    const relations = new Map<string, GraphConceptRelationDetail[]>();
    for (const relation of snapshot.relations) {
      appendRelation(relations, relation.source, { direction: "outgoing", relation });
      if (relation.target !== relation.source) appendRelation(relations, relation.target, { direction: "incoming", relation });
    }
    for (const values of relations.values()) {
      values.sort((left, right) => left.relation.id.localeCompare(right.relation.id) || left.direction.localeCompare(right.direction));
    }
    const index = {
      concepts: new Map(snapshot.concepts.map((concept) => [concept.id, concept])),
      findings,
      relations,
    };
    this.knowledgeDetailIndexes.set(snapshot.snapshotId, index);
    return index;
  }

  private loadActiveOntology(): Promise<WorkspaceOntologyActive> {
    if (this.activeOntology) return Promise.resolve(this.activeOntology);
    if (this.activeOntologyInFlight) return this.activeOntologyInFlight;
    const request = this.ontologyStore
      ? this.ontologyStore.active()
      : Promise.resolve(genericOntologyActive());
    this.activeOntologyInFlight = request.then((active) => {
      this.activeOntology = active;
      return active;
    }).finally(() => {
      this.activeOntologyInFlight = null;
    });
    return this.activeOntologyInFlight;
  }

  private requireOntologyStore(): WorkspaceOntologyStore {
    if (!this.ontologyStore) throw new Error("Workspace Ontology review requires a configured runtime root.");
    return this.ontologyStore;
  }
}

function genericOntologyActive(): WorkspaceOntologyActive {
  return { state: "generic", ontology: null, activationRevision: null, diagnostics: [] };
}

function ontologySnapshotCacheKey(
  profileId: string | null | undefined,
  active: KnowledgeGraphSnapshot["activeOntology"],
): string {
  return `${profileId?.trim() || "generic-markdown"}:${active.state}:${active.revision ?? "none"}`;
}

function ontologyReviewIdentity(active: WorkspaceOntologyActive): OntologyReviewState["active"] {
  return {
    state: active.state,
    ...(active.ontology ? {
      id: boundedOntologyReviewText(active.ontology.id, ONTOLOGY_REVIEW_MAX_IDENTITY_CHARS),
      ...(active.ontology.label ? { label: boundedOntologyReviewText(active.ontology.label, ONTOLOGY_REVIEW_MAX_IDENTITY_CHARS) } : {}),
      version: boundedOntologyReviewText(active.ontology.version, ONTOLOGY_REVIEW_MAX_IDENTITY_CHARS),
      revision: active.ontology.revision,
    } : {}),
  };
}

function sameOntologyGuard(left: OntologyReviewGuard, right: OntologyReviewGuard): boolean {
  return left.candidateRevision === right.candidateRevision
    && left.activationRevision === right.activationRevision
    && left.baseSnapshotId === right.baseSnapshotId;
}

function isOntologyReviewRace(error: unknown): boolean {
  return error instanceof Error && (error.message.includes("changed; review") || error.message.includes("changed; inspect"));
}

function normalize(value: string): string { return value.split(path.sep).join("/").replace(/^\.\//, "").toLowerCase(); }
function canonicalPath(value: string): string { return value.split(path.sep).join("/").replace(/^\.\//, ""); }
export function workspaceNoteId(rootId: string, relativePath: string): NoteId {
  return `note:${rootId}:${canonicalPath(relativePath)}` as NoteId;
}
function isWithin(parent: string, candidate: string): boolean { const rel = path.relative(parent, candidate); return rel === "" || (!rel.startsWith("..") && !path.isAbsolute(rel)); }
function byPath(left: WorkspaceGraphNote, right: WorkspaceGraphNote): number { return left.relativePath.localeCompare(right.relativePath); }
function byId(left: { id: string }, right: { id: string }): number { return left.id.localeCompare(right.id); }

function ontologyActiveDiagnostics(active: WorkspaceOntologyActive): readonly GraphFinding[] {
  return active.diagnostics.map((diagnostic, index) => ({
    id: `finding:${diagnostic.code}:${encodeURIComponent(diagnostic.path)}:${index}`,
    severity: diagnostic.severity,
    code: diagnostic.code,
    message: diagnostic.message,
    conceptIds: [],
    relationIds: [],
    evidence: [{
      kind: "ontology-rule" as const,
      producer: {
        id: active.ontology?.id ?? "workspace-ontology",
        version: active.ontology?.revision ?? active.sourceRevision ?? "unavailable",
      },
      detail: diagnostic.path,
    }],
  }));
}
function profileCacheKey(profileId?: string | null): string { return profileId?.trim() || "generic-markdown"; }

function boundedSummaryResult(input: Omit<GraphConceptSummaryResult, "payloadBytes">): GraphConceptSummaryResult {
  const result = { ...input, payloadBytes: 0 };
  result.payloadBytes = stableJsonBytes(result);
  return result;
}

function boundedLookupResult(input: Omit<GraphConceptLookupResult, "payloadBytes">): GraphConceptLookupResult {
  const result = { ...input, payloadBytes: 0 };
  result.payloadBytes = stableJsonBytes(result);
  return result;
}

function graphConceptSummary(index: number, concept: ConceptNode): GraphConceptSummary {
  return {
    index,
    label: concept.label,
    ...(concept.filePath ? { filePath: concept.filePath } : {}),
    ...(concept.relativePath ? { relativePath: concept.relativePath } : {}),
  };
}

type NormalizedGraphConceptLookupReference =
  | { kind: "concept-id"; value: string }
  | { kind: "file-path"; value: string };

function validateGraphConceptLookupReference(reference: GraphConceptLookupReference): NormalizedGraphConceptLookupReference {
  if (!reference || typeof reference !== "object") {
    throw new Error("Graph concept lookup requires exactly one of conceptId or filePath.");
  }
  const hasConceptId = reference.conceptId !== undefined;
  const hasFilePath = reference.filePath !== undefined;
  if (hasConceptId === hasFilePath) {
    throw new Error("Graph concept lookup requires exactly one of conceptId or filePath.");
  }
  if (hasConceptId) {
    const conceptId = reference.conceptId?.trim();
    if (!conceptId) throw new Error("Graph concept lookup conceptId must not be empty.");
    return { kind: "concept-id", value: conceptId };
  }
  const filePath = reference.filePath;
  if (!filePath?.trim()) throw new Error("Graph concept lookup filePath must not be empty.");
  return { kind: "file-path", value: path.normalize(path.resolve(filePath)) };
}

function boundedConceptDetailResult(
  snapshot: KnowledgeGraphSnapshot,
  index: number,
  concept: ConceptNode,
  incidentRelations: readonly GraphConceptRelationDetail[],
  conceptFindings: readonly GraphFinding[],
): GraphConceptDetailByIndexResult {
  const { properties: propertyRecord, ...conceptMetadata } = concept;
  const allProperties = Object.entries(propertyRecord)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, value]) => ({ key, value }));
  const properties = allProperties.slice(0, GRAPH_CONCEPT_DETAIL_MAX_PROPERTIES);
  const relations: GraphConceptRelationDetail[] = [];
  const findings: GraphFinding[] = [];
  let evidenceCount = 0;
  let omittedEvidence = incidentRelations
    .slice(GRAPH_CONCEPT_DETAIL_MAX_RELATIONS)
    .reduce((total, item) => total + item.relation.evidence.length, 0)
    + conceptFindings
      .slice(GRAPH_CONCEPT_DETAIL_MAX_FINDINGS)
      .reduce((total, item) => total + item.evidence.length, 0);

  for (const relation of incidentRelations.slice(0, GRAPH_CONCEPT_DETAIL_MAX_RELATIONS)) {
    const evidence = relation.relation.evidence.length;
    if (evidenceCount + evidence > GRAPH_CONCEPT_DETAIL_MAX_EVIDENCE) {
      omittedEvidence += evidence;
      continue;
    }
    relations.push(relation);
    evidenceCount += evidence;
  }
  for (const finding of conceptFindings.slice(0, GRAPH_CONCEPT_DETAIL_MAX_FINDINGS)) {
    const evidence = finding.evidence.length;
    if (evidenceCount + evidence > GRAPH_CONCEPT_DETAIL_MAX_EVIDENCE) {
      omittedEvidence += evidence;
      continue;
    }
    findings.push(finding);
    evidenceCount += evidence;
  }

  const detail: BoundedGraphConceptDetail = {
    concept: conceptMetadata,
    properties,
    relations,
    findings,
    profile: snapshot.activeProfile,
    ontology: snapshot.activeOntology,
    omitted: {
      properties: allProperties.length - properties.length,
      relations: incidentRelations.length - relations.length,
      findings: conceptFindings.length - findings.length,
      evidence: omittedEvidence,
    },
  };
  let result = boundedDetailResult({ status: "ok", sourceSnapshotId: snapshot.snapshotId, index, detail });
  while (result.payloadBytes > GRAPH_CONCEPT_DETAIL_MAX_BYTES) {
    const finding = findings.pop();
    if (finding) {
      detail.omitted.findings += 1;
      detail.omitted.evidence += finding.evidence.length;
    } else {
      const relation = relations.pop();
      if (relation) {
        detail.omitted.relations += 1;
        detail.omitted.evidence += relation.relation.evidence.length;
      } else if (properties.pop()) {
        detail.omitted.properties += 1;
      } else {
        return boundedDetailResult({ status: "too-large", sourceSnapshotId: snapshot.snapshotId, index });
      }
    }
    result = boundedDetailResult({ status: "ok", sourceSnapshotId: snapshot.snapshotId, index, detail });
  }
  return result;
}

function boundedDetailResult(input: Omit<GraphConceptDetailByIndexResult, "payloadBytes">): GraphConceptDetailByIndexResult {
  const result = { ...input, payloadBytes: 0 };
  result.payloadBytes = stableJsonBytes(result);
  return result;
}

function stableJsonBytes(value: { payloadBytes: number }): number {
  let bytes = Buffer.byteLength(JSON.stringify(value), "utf8");
  for (let iteration = 0; iteration < 3; iteration += 1) {
    value.payloadBytes = bytes;
    const next = Buffer.byteLength(JSON.stringify(value), "utf8");
    if (next === bytes) break;
    bytes = next;
  }
  return bytes;
}

function appendRelation(
  relations: Map<string, GraphConceptRelationDetail[]>,
  conceptId: string,
  relation: GraphConceptRelationDetail,
): void {
  const current = relations.get(conceptId);
  if (current) current.push(relation);
  else relations.set(conceptId, [relation]);
}

function contentRevision(content: string | Buffer): string {
  return createHash("sha256").update(content).digest("hex");
}

function graphSourceRevision(graph: ReadonlyMap<string, GraphEntry>): string {
  const hash = createHash("sha256");
  for (const [filePath, entry] of [...graph.entries()].sort(([left], [right]) => left.localeCompare(right))) {
    hash.update(filePath).update("\0").update(entry.sourceRevision).update("\0");
  }
  return hash.digest("hex");
}

function conceptIdForLink(sourceId: string, target: string, resolution: GraphResolution): string {
  if (resolution === "external") return `external:${target}`;
  return `unresolved:${encodeURIComponent(`${sourceId}:${target}`)}`;
}

function resolutionIndex(graph: ReadonlyMap<string, GraphEntry>): ResolutionIndex {
  const byRelativeStem = new Map<string, GraphEntry[]>();
  const byBasename = new Map<string, GraphEntry[]>();
  for (const entry of graph.values()) {
    append(byRelativeStem, normalize(entry.note.relativePath.replace(/\.md$/i, "")), entry);
    append(byBasename, path.basename(entry.note.relativePath, ".md").toLowerCase(), entry);
  }
  return { byRelativeStem, byBasename };
}

function append(map: Map<string, GraphEntry[]>, key: string, entry: GraphEntry): void {
  const values = map.get(key);
  if (values) values.push(entry);
  else map.set(key, [entry]);
}
