import path from "node:path";

import { extractMarkdownLinks, extractTags, extractWikilinks, readWorkspaceDocument } from "./notes";
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
import { compileGraphView, type GraphConceptDetail, type GraphViewBundle } from "./graph-projection";
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

export interface WorkspaceGraphContext {
  note: WorkspaceGraphNote;
  outgoing: readonly WorkspaceGraphLink[];
  backlinks: readonly WorkspaceGraphLink[];
  unresolved: readonly WorkspaceGraphLink[];
  neighborhood: readonly WorkspaceGraphNote[];
}

export interface WorkspaceGraphStatus {
  state: "ready" | "stale" | "building";
  noteCount: number;
  edgeCount: number;
}

interface GraphEntry {
  note: WorkspaceGraphNote;
  document: NoteDocument;
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

/** The one graph boundary for note relationships. It owns indexing and resolution. */
export class WorkspaceGraph {
  private snapshot: Map<string, GraphEntry> | null = null;
  private state: WorkspaceGraphStatus["state"] = "stale";
  private generation = 0;
  private buildInFlight: { generation: number; promise: Promise<Map<string, GraphEntry>> } | null = null;
  private readonly refreshVersions = new Map<string, number>();
  private readonly knowledgeSnapshotCache = new Map<string, KnowledgeGraphSnapshot>();
  private resolvedEpoch: ResolvedGraphEpoch | null = null;

  constructor(private readonly model: WorkspaceModel) {}

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
    const neighborhood = new Map<string, WorkspaceGraphNote>([[entry.note.id, entry.note]]);
    for (const link of [...outgoing, ...backlinks]) if (link.note) neighborhood.set(link.note.id, link.note);
    return { note: entry.note, outgoing, backlinks, unresolved: outgoing.filter((link) => link.resolution === "unresolved" || link.resolution === "ambiguous"), neighborhood: Array.from(neighborhood.values()).sort(byPath) };
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
    const cacheKey = profileId?.trim() || "generic-markdown";
    const cached = this.knowledgeSnapshotCache.get(cacheKey);
    if (cached) return cached;
    const graph = await this.build();
    const epoch = this.resolveEpoch(graph);
    const profile = knowledgeProfile(profileId);
    const concepts = new Map<string, ConceptNode>();
    const relations: RelationEdge[] = [];
    const findings: GraphFinding[] = [];

    for (const entry of [...graph.values()].sort((left, right) => byPath(left.note, right.note))) {
      concepts.set(entry.note.id, {
        id: entry.note.id,
        noteId: entry.note.id,
        label: entry.note.title,
        conceptTypes: profile.conceptTypes(entry.document.frontmatter),
        properties: graphPropertyRecord(entry.document.frontmatter),
        resolution: "resolved",
        filePath: entry.note.filePath,
        rootId: entry.note.rootId,
        relativePath: entry.note.relativePath,
        tags: [...entry.note.tags],
      });

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
          authority: "authored",
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
          authority: "authored",
          resolution: "resolved",
          directed: true,
          evidence,
        });
      });
    }

    const sortedConcepts = [...concepts.values()].sort(byId);
    const sortedRelations = relations.sort(byId);
    const scope = {
      workspaceRoot: this.model.workspaceRoot,
      noteRootIds: this.roots().map((root) => root.id).sort(),
      paths: [...graph.keys()].sort(),
    };
    const activeProfile = profile.status;
    const snapshotId = knowledgeGraphSnapshotId(scope, sortedConcepts, sortedRelations, activeProfile);
    const snapshot: KnowledgeGraphSnapshot = {
      version: KNOWLEDGE_GRAPH_VERSION,
      snapshotId,
      generatedAt: new Date().toISOString(),
      scope,
      concepts: sortedConcepts,
      relations: sortedRelations,
      findings: [...findings, ...profile.validate(sortedConcepts)].sort(byId),
      activeProfile,
    };
    this.knowledgeSnapshotCache.set(cacheKey, snapshot);
    return snapshot;
  }

  async graphView(profileId?: string | null): Promise<GraphViewBundle> {
    const snapshot = await this.knowledgeSnapshot(profileId);
    return { projection: compileGraphView(snapshot) };
  }

  async graphConceptDetail(conceptId: string, sourceSnapshotId: string, profileId?: string | null): Promise<GraphConceptDetail | null> {
    const snapshot = await this.knowledgeSnapshot(profileId);
    if (snapshot.snapshotId !== sourceSnapshotId) return null;
    const concept = snapshot.concepts.find((candidate) => candidate.id === conceptId);
    if (!concept) return null;
    return {
      concept,
      findings: snapshot.findings.filter((finding) => finding.conceptIds.includes(conceptId)),
    };
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
    if (entry) this.snapshot.set(resolvedPath, entry);
    else this.snapshot.delete(resolvedPath);
    this.resolvedEpoch = null;
    this.knowledgeSnapshotCache.clear();
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
    const document = await readWorkspaceDocument(filePath);
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
    return { note, document };
  }

  private findByPath(graph: Map<string, GraphEntry>, filePath: string): GraphEntry | undefined { return graph.get(path.resolve(filePath)); }

  private linksFromGraph(graph: Map<string, GraphEntry>, entry: GraphEntry, index = resolutionIndex(graph)): WorkspaceGraphLink[] {
    const links: WorkspaceGraphLink[] = [];
    for (const item of extractWikilinks(entry.document.body)) links.push(this.makeLink(graph, index, entry, item.target, item.label, item.sourceRange));
    for (const item of extractMarkdownLinks(entry.document.body)) links.push(this.makeLink(graph, index, entry, item.target, item.label, item.sourceRange));
    return links;
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
}

function normalize(value: string): string { return value.split(path.sep).join("/").replace(/^\.\//, "").toLowerCase(); }
function canonicalPath(value: string): string { return value.split(path.sep).join("/").replace(/^\.\//, ""); }
export function workspaceNoteId(rootId: string, relativePath: string): NoteId {
  return `note:${rootId}:${canonicalPath(relativePath)}` as NoteId;
}
function isWithin(parent: string, candidate: string): boolean { const rel = path.relative(parent, candidate); return rel === "" || (!rel.startsWith("..") && !path.isAbsolute(rel)); }
function byPath(left: WorkspaceGraphNote, right: WorkspaceGraphNote): number { return left.relativePath.localeCompare(right.relativePath); }
function byId(left: { id: string }, right: { id: string }): number { return left.id.localeCompare(right.id); }
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
