import path from "node:path";

import { extractMarkdownLinks, extractTags, extractWikilinks, readWorkspaceDocument } from "./notes";
import type { GraphEdge, GraphEdgeKind, GraphEdgeResolution, GraphNode, GraphSnapshot } from "./graph";
import type { WorkspaceModel } from "./types";
import { listMarkdownFiles } from "./workspace";

export interface GraphSnapshotBuildOptions {
  generatedAt?: string | Date;
}

interface NoteIndexEntry {
  id: string;
  filePath: string;
  rootId: string;
  rootPath: string;
  title: string;
}

interface ResolvedTarget {
  targetId: string;
  resolution: GraphEdgeResolution;
  node?: GraphNode;
  warning?: string;
}

const MARKDOWN_EXTENSION_PATTERN = /\.md(?:own)?$/i;
const HTTP_URL_PATTERN = /^https?:\/\//i;

export async function buildGraphSnapshot(
  model: WorkspaceModel,
  options: GraphSnapshotBuildOptions = {},
): Promise<GraphSnapshot> {
  const noteRoots = model.noteRoots.map((root) => ({ ...root, path: path.resolve(root.path) }));
  const fileRootPairs = await Promise.all(
    noteRoots.map(async (root) =>
      (await listMarkdownFiles([root.path])).map((filePath) => ({
        filePath: path.resolve(filePath),
        rootId: root.id,
        rootPath: root.path,
      })),
    ),
  );
  const files = fileRootPairs.flat().sort((left, right) => left.filePath.localeCompare(right.filePath));

  const documents = await Promise.all(
    files.map(async (file) => ({
      ...file,
      document: await readWorkspaceDocument(file.filePath),
    })),
  );

  const noteEntries: NoteIndexEntry[] = documents.map((entry) => ({
    id: noteNodeId(entry.filePath),
    filePath: entry.filePath,
    rootId: entry.rootId,
    rootPath: entry.rootPath,
    title: entry.document.title,
  }));
  const noteIndex = createNoteIndex(noteEntries);

  const nodesById = new Map<string, GraphNode>();
  const edges: GraphEdge[] = [];
  const warnings: string[] = [];

  for (const entry of documents) {
    const tags = extractTags(entry.document.body, entry.document.frontmatter).map((tag) => tag.tag);
    const sourceId = noteNodeId(entry.filePath);
    nodesById.set(sourceId, {
      id: sourceId,
      kind: "note",
      label: entry.document.title,
      filePath: entry.filePath,
      rootId: entry.rootId,
      metadata: {
        title: entry.document.title,
        tags,
        frontmatter: entry.document.frontmatter,
      },
    });

    extractWikilinks(entry.document.body).forEach((link, index) => {
      const targetText = normalizeWikilinkTarget(link.target);
      const resolved = resolveWikilink(targetText, noteIndex);
      addResolvedNode(nodesById, resolved);
      if (resolved.warning) {
        warnings.push(resolved.warning);
      }
      edges.push(createEdge("wikilink", sourceId, resolved.targetId, resolved.resolution, index, {
        targetText: link.target,
        sourceFilePath: entry.filePath,
      }));
    });

    extractMarkdownLinks(entry.document.body).forEach((link, index) => {
      const resolved = resolveMarkdownLink(link.target, entry.filePath, noteIndex);
      addResolvedNode(nodesById, resolved);
      edges.push(createEdge("markdownLink", sourceId, resolved.targetId, resolved.resolution, index, {
        label: link.label,
        targetText: link.target,
        sourceFilePath: entry.filePath,
      }));
    });

    tags.forEach((tag, index) => {
      const tagId = tagNodeId(tag);
      nodesById.set(tagId, {
        id: tagId,
        kind: "tag",
        label: `#${tag}`,
        metadata: { title: tag },
      });
      edges.push(createEdge("hasTag", sourceId, tagId, "resolved", index, {
        targetText: tag,
        sourceFilePath: entry.filePath,
      }));
    });
  }

  return {
    version: "0.1",
    generatedAt: generatedAt(options.generatedAt),
    scope: {
      workspaceRoot: model.workspaceRoot,
      noteRootIds: noteRoots.map((root) => root.id).sort(),
      projectRootIds: model.projectRoots.map((root) => root.id).sort(),
      paths: files.map((file) => file.filePath),
    },
    nodes: Array.from(nodesById.values()).sort(compareById),
    edges: edges.sort(compareById),
    warnings: Array.from(new Set(warnings)).sort(),
  };
}

function createNoteIndex(entries: NoteIndexEntry[]) {
  const byAbsolutePath = new Map<string, NoteIndexEntry>();
  const byRootRelativePath = new Map<string, NoteIndexEntry>();
  const byBasename = new Map<string, NoteIndexEntry[]>();

  for (const entry of entries) {
    for (const key of pathKeys(entry.filePath)) {
      byAbsolutePath.set(key, entry);
    }

    for (const key of pathKeys(path.relative(entry.rootPath, entry.filePath))) {
      byRootRelativePath.set(key, entry);
    }

    const basename = path.basename(entry.filePath, path.extname(entry.filePath)).toLowerCase();
    byBasename.set(basename, [...(byBasename.get(basename) ?? []), entry]);
  }

  return { byAbsolutePath, byRootRelativePath, byBasename };
}

function resolveWikilink(
  target: string,
  noteIndex: ReturnType<typeof createNoteIndex>,
): ResolvedTarget {
  const normalizedTarget = normalizePathKey(target);
  if (path.isAbsolute(target)) {
    const exact = noteIndex.byAbsolutePath.get(normalizedTarget);
    if (exact) {
      return { targetId: exact.id, resolution: "resolved" };
    }
  }

  if (isPathLikeWikilinkTarget(target)) {
    const rootRelative = noteIndex.byRootRelativePath.get(normalizedTarget);
    if (rootRelative) {
      return { targetId: rootRelative.id, resolution: "resolved" };
    }
  }

  const basename = path.basename(target, path.extname(target)).toLowerCase();
  const basenameMatches = noteIndex.byBasename.get(basename) ?? [];
  if (basenameMatches.length === 1) {
    return { targetId: basenameMatches[0].id, resolution: "resolved" };
  }
  if (basenameMatches.length > 1) {
    const node = unresolvedNode(target, `wikilink:${target}`);
    return {
      targetId: node.id,
      resolution: "unresolved",
      node,
      warning: `Ambiguous wikilink "${target}" matched duplicate basenames: ${basenameMatches
        .map((entry) => entry.filePath)
        .sort()
        .join(", ")}`,
    };
  }

  const node = unresolvedNode(target, `wikilink:${target}`);
  return { targetId: node.id, resolution: "unresolved", node };
}

function isPathLikeWikilinkTarget(target: string): boolean {
  return target.includes("/") || target.includes("\\") || MARKDOWN_EXTENSION_PATTERN.test(target);
}

function resolveMarkdownLink(
  target: string,
  sourceFilePath: string,
  noteIndex: ReturnType<typeof createNoteIndex>,
): ResolvedTarget {
  if (HTTP_URL_PATTERN.test(target)) {
    const node = externalNode(target);
    return { targetId: node.id, resolution: "external", node };
  }

  const pathOnly = stripFragmentAndQuery(target);
  if (!pathOnly || !MARKDOWN_EXTENSION_PATTERN.test(pathOnly)) {
    const node = unresolvedNode(target, `markdown:${target}`);
    return { targetId: node.id, resolution: "unresolved", node };
  }

  const candidate = path.resolve(path.dirname(sourceFilePath), decodeURIComponent(pathOnly));
  const resolved = noteIndex.byAbsolutePath.get(normalizePathKey(candidate));
  if (resolved) {
    return { targetId: resolved.id, resolution: "resolved" };
  }

  const node = unresolvedNode(target, `markdown:${path.resolve(path.dirname(sourceFilePath), pathOnly)}`);
  return { targetId: node.id, resolution: "unresolved", node };
}

function addResolvedNode(nodesById: Map<string, GraphNode>, resolved: ResolvedTarget): void {
  if (resolved.node) {
    nodesById.set(resolved.node.id, resolved.node);
  }
}

function createEdge(
  kind: GraphEdgeKind,
  source: string,
  target: string,
  resolution: GraphEdgeResolution,
  index: number,
  metadata: GraphEdge["metadata"],
): GraphEdge {
  return {
    id: `${source}->${target}#${kind}:${index}`,
    kind,
    source,
    target,
    directed: true,
    resolution,
    metadata,
  };
}

function noteNodeId(filePath: string): string {
  return `note:${path.resolve(filePath)}`;
}

function tagNodeId(tag: string): string {
  return `tag:${tag}`;
}

function externalNode(target: string): GraphNode {
  return {
    id: `external:${target}`,
    kind: "external",
    label: target,
    metadata: { title: target },
  };
}

function unresolvedNode(label: string, stableTarget: string): GraphNode {
  return {
    id: `unresolved:${encodeURIComponent(stableTarget)}`,
    kind: "unresolved",
    label,
    metadata: { title: label },
  };
}

function normalizeWikilinkTarget(target: string): string {
  return stripFragmentAndQuery(target.split("|")[0]?.trim() ?? target.trim());
}

function stripFragmentAndQuery(target: string): string {
  return target.split("#")[0]?.split("?")[0]?.trim() ?? "";
}

function pathKeys(filePath: string): string[] {
  const normalized = normalizePathKey(filePath);
  const withoutExtension = normalized.replace(MARKDOWN_EXTENSION_PATTERN, "");
  return normalized === withoutExtension ? [normalized] : [normalized, withoutExtension];
}

function normalizePathKey(filePath: string): string {
  return filePath.split(path.sep).join("/");
}

function generatedAt(value: string | Date | undefined): string {
  if (value instanceof Date) {
    return value.toISOString();
  }
  return value ?? new Date().toISOString();
}

function compareById(left: { id: string }, right: { id: string }): number {
  return left.id.localeCompare(right.id);
}
