import path from "node:path";

import { extractMarkdownLinks, extractTags, extractWikilinks, readWorkspaceDocument } from "./notes";
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

/** The one graph boundary for note relationships. It owns indexing and resolution. */
export class WorkspaceGraph {
  private snapshot: Map<string, GraphEntry> | null = null;
  private state: WorkspaceGraphStatus["state"] = "stale";

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
    const entry = this.findByPath(graph, filePath);
    if (!entry) return null;
    const outgoing = this.linksFromGraph(graph, entry);
    const backlinks = Array.from(graph.values()).flatMap((candidate) =>
      this.linksFromGraph(graph, candidate)
        .filter((link) => link.note?.id === entry.note.id)
        .map((link) => ({ ...link, label: candidate.note.title, target: candidate.note.filePath })),
    );
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
    return entry ? this.linksFromGraph(graph, entry) : [];
  }

  async unresolved(filePath?: string): Promise<readonly WorkspaceGraphLink[]> {
    if (filePath) return (await this.linksFrom(filePath)).filter((link) => link.resolution === "unresolved" || link.resolution === "ambiguous");
    const graph = await this.build();
    return Array.from(graph.values()).flatMap((entry) => this.linksFromGraph(graph, entry).filter((link) => link.resolution === "unresolved" || link.resolution === "ambiguous"));
  }

  async neighborhood(filePath: string): Promise<readonly WorkspaceGraphNote[]> {
    return (await this.contextForNote(filePath))?.neighborhood ?? [];
  }

  async status(): Promise<WorkspaceGraphStatus> {
    if (!this.snapshot) return { state: this.state, noteCount: 0, edgeCount: 0 };
    const edgeCount = Array.from(this.snapshot.values()).reduce((count, entry) => count + extractWikilinks(entry.document.body).length + extractMarkdownLinks(entry.document.body).length, 0);
    return { state: this.state, noteCount: this.snapshot.size, edgeCount };
  }

  async rebuild(): Promise<WorkspaceGraphStatus> {
    this.snapshot = null;
    await this.build();
    return this.status();
  }

  invalidate(): void { this.snapshot = null; this.state = "stale"; }

  private async build(): Promise<Map<string, GraphEntry>> {
    if (this.snapshot) return this.snapshot;
    this.state = "building";
    const roots = this.model.noteRoots.map((root) => ({ ...root, path: path.resolve(root.path) }));
    const files = (await listMarkdownFiles(roots.map((root) => root.path))).map((filePath) => path.resolve(filePath)).sort();
    const authorized = new WorkspaceFiles(roots.map((root) => root.path));
    const graph = new Map<string, GraphEntry>();
    for (const filePath of files) {
      const root = roots.find((candidate) => isWithin(candidate.path, filePath));
      if (!root) continue;
      try { await authorized.existing(filePath); } catch { continue; }
      const document = await readWorkspaceDocument(filePath);
      const relativePath = normalize(path.relative(root.path, filePath));
      const note: WorkspaceGraphNote = { id: `note:${root.id}:${relativePath}` as NoteId, filePath, rootId: root.id, relativePath, title: document.title, tags: extractTags(document.body, document.frontmatter).map((tag) => tag.tag).sort(), frontmatter: document.frontmatter };
      graph.set(filePath, { note, document });
    }
    this.snapshot = graph;
    this.state = "ready";
    return graph;
  }

  private findByPath(graph: Map<string, GraphEntry>, filePath: string): GraphEntry | undefined { return graph.get(path.resolve(filePath)); }

  private linksFromGraph(graph: Map<string, GraphEntry>, entry: GraphEntry): WorkspaceGraphLink[] {
    const links: WorkspaceGraphLink[] = [];
    for (const item of extractWikilinks(entry.document.body)) links.push(this.makeLink(graph, entry, item.target, item.label));
    for (const item of extractMarkdownLinks(entry.document.body)) links.push(this.makeLink(graph, entry, item.target, item.label));
    return links;
  }

  private makeLink(graph: Map<string, GraphEntry>, source: GraphEntry, target: string, label: string): WorkspaceGraphLink {
    const clean = target.split("#")[0]?.split("?")[0]?.trim() ?? target.trim();
    if (/^https?:\/\//i.test(clean)) return { source: source.note.id, target: clean, label, resolution: "external" };
    const resolved = this.resolveTarget(graph, source.note, clean);
    return { source: source.note.id, target: clean, label, resolution: resolved.status, note: resolved.note };
  }

  private resolveTarget(graph: Map<string, GraphEntry>, source: WorkspaceGraphNote | undefined, target: string): { status: GraphResolution; note?: WorkspaceGraphNote } {
    const normalized = normalize(target.replace(/\.md(?:own)?$/i, ""));
    const candidates = Array.from(graph.values());
    if (source && (target.includes("/") || target.endsWith(".md"))) {
      const candidate = path.resolve(path.dirname(source.filePath), target.endsWith(".md") ? target : `${target}.md`);
      const exact = graph.get(candidate);
      if (exact) return { status: "resolved", note: exact.note };
    }
    const relative = candidates.filter((entry) => normalize(entry.note.relativePath.replace(/\.md$/i, "")) === normalized);
    if (relative.length === 1) return { status: "resolved", note: relative[0].note };
    if (relative.length > 1) return { status: "ambiguous" };
    const basename = candidates.filter((entry) => path.basename(entry.note.relativePath, ".md").toLowerCase() === path.basename(normalized).toLowerCase());
    if (basename.length === 1) return { status: "resolved", note: basename[0].note };
    return { status: basename.length > 1 ? "ambiguous" : "unresolved" };
  }

  private idForPath(filePath: string): NoteId { return `note:unknown:${normalize(path.basename(filePath))}` as NoteId; }
}

function normalize(value: string): string { return value.split(path.sep).join("/").replace(/^\.\//, "").toLowerCase(); }
function isWithin(parent: string, candidate: string): boolean { const rel = path.relative(parent, candidate); return rel === "" || (!rel.startsWith("..") && !path.isAbsolute(rel)); }
function byPath(left: WorkspaceGraphNote, right: WorkspaceGraphNote): number { return left.relativePath.localeCompare(right.relativePath); }
