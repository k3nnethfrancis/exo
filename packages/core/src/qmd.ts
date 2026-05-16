import { mkdir, readFile } from "node:fs/promises";
import path from "node:path";

import { readWorkspaceDocument } from "./notes";
import { searchWorkspace } from "./workspace";
import type {
  IndexedRoot,
  IndexReadResponse,
  IndexSearchResponse,
  IndexSearchResult,
  IndexStatus,
  WorkspaceModel,
} from "./types";

type QmdModule = typeof import("@tobilu/qmd");
type QmdStore = Awaited<ReturnType<QmdModule["createStore"]>>;

export interface IndexSearchOptions {
  limit?: number;
  intent?: string;
  rootIds?: string[];
  includeContent?: boolean;
  maxLinesPerResult?: number;
}

export interface IndexReadOptions {
  fromLine?: number;
  maxLines?: number;
}

export interface IndexRootInput {
  path: string;
  id?: string;
  label?: string;
  kind?: IndexedRoot["kind"];
  pattern?: string;
  ignore?: string[];
}

const DEFAULT_SEARCH_LIMIT = 10;
const DEFAULT_CONTENT_LINES = 80;
const QMD_DIRECTORY_NAME = "qmd";

export function getQmdRuntimePath(runtimeRoot: string): string {
  return path.join(runtimeRoot, QMD_DIRECTORY_NAME);
}

export function getQmdDbPath(runtimeRoot: string): string {
  return path.join(getQmdRuntimePath(runtimeRoot), "index.sqlite");
}

export async function getIndexStatus(model: WorkspaceModel, runtimeRoot: string): Promise<IndexStatus> {
  const base = baseStatus(model, runtimeRoot);
  if (!model.indexing.enabled || model.indexing.mode === "off" || model.indexedRoots.length === 0) {
    return {
      ...base,
      warnings: model.indexing.enabled && model.indexedRoots.length === 0 ? ["No indexed roots are configured."] : [],
    };
  }

  let store: QmdStore | null = null;
  try {
    store = await openQmdStore(model, runtimeRoot);
    const qmdStatus = await store.getStatus();
    const lastUpdated = latestCollectionUpdate(qmdStatus.collections);
    return {
      ...base,
      documentCount: Number(qmdStatus.totalDocuments ?? 0),
      pendingEmbeddings: Number(qmdStatus.needsEmbedding ?? 0),
      hasVectorIndex: Boolean(qmdStatus.hasVectorIndex),
      lastUpdated,
      warnings: modeWarnings(model, Boolean(qmdStatus.hasVectorIndex), Number(qmdStatus.needsEmbedding ?? 0)),
    };
  } catch (error) {
    return {
      ...base,
      errors: [errorMessage(error)],
    };
  } finally {
    await store?.close();
  }
}

export async function updateIndex(model: WorkspaceModel, runtimeRoot: string): Promise<IndexStatus> {
  ensureIndexEnabled(model);
  let store: QmdStore | null = null;
  try {
    store = await openQmdStore(model, runtimeRoot);
    await store.update();
  } finally {
    await store?.close();
  }
  return getIndexStatus(model, runtimeRoot);
}

export async function embedIndex(model: WorkspaceModel, runtimeRoot: string): Promise<IndexStatus> {
  ensureIndexEnabled(model);
  if (model.indexing.mode === "lexical") {
    throw new Error("Embedding is disabled in lexical mode.");
  }

  let store: QmdStore | null = null;
  try {
    store = await openQmdStore(model, runtimeRoot);
    await store.embed();
  } finally {
    await store?.close();
  }
  return getIndexStatus(model, runtimeRoot);
}

export async function searchIndex(
  model: WorkspaceModel,
  runtimeRoot: string,
  query: string,
  options: IndexSearchOptions = {},
): Promise<IndexSearchResponse> {
  const trimmedQuery = query.trim();
  if (!trimmedQuery) {
    return {
      query,
      mode: model.indexing.mode,
      source: "filesystem",
      warnings: ["Search query is empty."],
      results: [],
    };
  }

  if (!shouldUseQmd(model)) {
    return searchFilesystem(model, trimmedQuery, options, "Index is off or has no indexed roots; using lightweight workspace search.");
  }

  let store: QmdStore | null = null;
  try {
    store = await openQmdStore(model, runtimeRoot);
    const collections = selectedCollectionNames(model.indexedRoots, options.rootIds);
    const limit = options.limit ?? DEFAULT_SEARCH_LIMIT;
    let rawResults: unknown[];
    const warnings: string[] = [];

    if (model.indexing.mode === "lexical") {
      const lexical = await Promise.all(collections.map((collection) => store!.searchLex(trimmedQuery, { limit, collection })));
      rawResults = lexical.flat();
    } else if (model.indexing.mode === "semantic") {
      try {
        const [lexical, vector] = await Promise.all([
          Promise.all(collections.map((collection) => store!.searchLex(trimmedQuery, { limit, collection }))),
          Promise.all(collections.map((collection) => store!.searchVector(trimmedQuery, { limit, collection }))),
        ]);
        rawResults = [...lexical.flat(), ...vector.flat()];
      } catch (error) {
        warnings.push(`Semantic search is not ready (${errorMessage(error)}); using lexical search.`);
        const lexical = await Promise.all(collections.map((collection) => store!.searchLex(trimmedQuery, { limit, collection })));
        rawResults = lexical.flat();
      }
    } else {
      try {
        rawResults = await store.search({
          query: trimmedQuery,
          collections,
          limit,
          intent: options.intent,
          rerank: true,
        });
      } catch (error) {
        warnings.push(`Hybrid search is not ready (${errorMessage(error)}); using lexical search.`);
        const lexical = await Promise.all(collections.map((collection) => store!.searchLex(trimmedQuery, { limit, collection })));
        rawResults = lexical.flat();
      }
    }

    let results = rawResults
      .map((result) => mapQmdResult(result, model.indexedRoots))
      .filter((result): result is IndexSearchResult => result !== null)
      .sort((left, right) => right.score - left.score)
      .slice(0, limit);

    if (options.includeContent) {
      results = await Promise.all(
        results.map(async (result) => ({
          ...result,
          content: await readBoundedContent(result.filePath, options.maxLinesPerResult ?? DEFAULT_CONTENT_LINES),
        })),
      );
    }

    return {
      query: trimmedQuery,
      mode: model.indexing.mode,
      source: "qmd",
      warnings,
      results,
    };
  } catch (error) {
    return searchFilesystem(model, trimmedQuery, options, `QMD search failed (${errorMessage(error)}); using lightweight workspace search.`);
  } finally {
    await store?.close();
  }
}

export async function readIndexDocument(
  model: WorkspaceModel,
  runtimeRoot: string,
  target: string,
  options: IndexReadOptions = {},
): Promise<IndexReadResponse> {
  if (isDocid(target) && shouldUseQmd(model)) {
    let store: QmdStore | null = null;
    try {
      store = await openQmdStore(model, runtimeRoot);
      const doc = await store.get(target, { includeBody: false });
      if ("error" in doc) {
        throw new Error(`Document not found: ${target}`);
      }
      const body = await store.getDocumentBody(target, {
        fromLine: options.fromLine,
        maxLines: options.maxLines,
      });
      const filePath = resolveQmdPath(doc.filepath, model.indexedRoots) ?? doc.filepath;
      return {
        target,
        filePath,
        title: doc.title,
        body: body ?? "",
        fromLine: options.fromLine,
        maxLines: options.maxLines,
        source: "qmd",
      };
    } finally {
      await store?.close();
    }
  }

  const resolvedPath = path.resolve(target);
  if (!isPathAllowed(resolvedPath, model)) {
    throw new Error("Refusing to read a path outside attached or indexed roots.");
  }

  const document = await readWorkspaceDocument(resolvedPath);
  return {
    target,
    filePath: resolvedPath,
    title: document.title,
    body: sliceLines(document.body, options.fromLine, options.maxLines),
    fromLine: options.fromLine,
    maxLines: options.maxLines,
    source: "filesystem",
  };
}

async function openQmdStore(model: WorkspaceModel, runtimeRoot: string): Promise<QmdStore> {
  await mkdir(getQmdRuntimePath(runtimeRoot), { recursive: true });
  const qmd = await import("@tobilu/qmd");
  return qmd.createStore({
    dbPath: getQmdDbPath(runtimeRoot),
    config: {
      global_context: "Exo-managed local knowledge index. Indexed roots are explicitly selected by the user.",
      collections: Object.fromEntries(
        model.indexedRoots.map((root) => [
          collectionName(root),
          {
            path: root.path,
            pattern: root.pattern,
            ignore: root.ignore,
            context: {
              "/": `${root.kind} root: ${root.label}`,
            },
          },
        ]),
      ),
    },
  });
}

function baseStatus(model: WorkspaceModel, runtimeRoot: string): IndexStatus {
  return {
    enabled: model.indexing.enabled && model.indexing.mode !== "off",
    mode: model.indexing.mode,
    backend: "qmd",
    dbPath: getQmdDbPath(runtimeRoot),
    runtimePath: getQmdRuntimePath(runtimeRoot),
    indexedRoots: model.indexedRoots,
    documentCount: 0,
    pendingEmbeddings: 0,
    hasVectorIndex: false,
    lastUpdated: null,
    warnings: [],
    errors: [],
  };
}

function ensureIndexEnabled(model: WorkspaceModel): void {
  if (!shouldUseQmd(model)) {
    throw new Error("The Exo index is off or has no indexed roots.");
  }
}

function shouldUseQmd(model: WorkspaceModel): boolean {
  return model.indexing.enabled && model.indexing.mode !== "off" && model.indexedRoots.length > 0;
}

function selectedCollectionNames(roots: IndexedRoot[], rootIds?: string[]): string[] {
  const selected = rootIds && rootIds.length > 0 ? roots.filter((root) => rootIds.includes(root.id)) : roots;
  return selected.map(collectionName);
}

function collectionName(root: IndexedRoot): string {
  return root.id.replace(/^index-/, "") || root.label;
}

function mapQmdResult(rawResult: unknown, roots: IndexedRoot[]): IndexSearchResult | null {
  if (!rawResult || typeof rawResult !== "object") {
    return null;
  }
  const result = rawResult as Record<string, unknown>;
  const displayPath = stringValue(result.displayPath) ?? stringValue(result.file) ?? stringValue(result.filepath);
  const filePath = resolveQmdPath(displayPath, roots) ?? stringValue(result.filepath);
  if (!filePath) {
    return null;
  }

  const title = stringValue(result.title) ?? path.basename(filePath, path.extname(filePath));
  const snippet = stringValue(result.snippet) ?? stringValue(result.bestChunk) ?? "";
  return {
    filePath,
    title,
    snippet: snippet.slice(0, 800),
    score: numberValue(result.score) ?? 0,
    docid: stringValue(result.docid) ? `#${String(result.docid).replace(/^#/, "")}` : undefined,
    source: "qmd",
  };
}

function resolveQmdPath(displayPath: string | null, roots: IndexedRoot[]): string | null {
  if (!displayPath) {
    return null;
  }
  const withoutScheme = displayPath.replace(/^qmd:\/\//, "");
  const [collection, ...segments] = withoutScheme.split("/");
  if (!collection || segments.length === 0) {
    return path.isAbsolute(withoutScheme) ? withoutScheme : null;
  }
  const root = roots.find((candidate) => collectionName(candidate) === collection || candidate.label === collection);
  return root ? path.join(root.path, ...segments) : null;
}

async function searchFilesystem(
  model: WorkspaceModel,
  query: string,
  options: IndexSearchOptions,
  warning: string,
): Promise<IndexSearchResponse> {
  const workspaceResults = await searchWorkspace(model, query);
  const limit = options.limit ?? DEFAULT_SEARCH_LIMIT;
  const results = [...workspaceResults.notes, ...workspaceResults.projectFiles, ...workspaceResults.tags]
    .slice(0, limit)
    .map<IndexSearchResult>((result) => ({
      filePath: result.filePath,
      title: result.title,
      snippet: result.snippet,
      score: 0,
      source: "filesystem",
    }));
  return {
    query,
    mode: model.indexing.mode,
    source: "filesystem",
    warnings: [warning],
    results,
  };
}

function modeWarnings(model: WorkspaceModel, hasVectorIndex: boolean, pendingEmbeddings: number): string[] {
  if (model.indexing.mode === "lexical") {
    return [];
  }
  if (!hasVectorIndex) {
    return ["Semantic/hybrid search needs embeddings. Run `exo index embed` after `exo index update`."];
  }
  if (pendingEmbeddings > 0) {
    return [`${pendingEmbeddings} document hashes need embeddings. Run \`exo index embed\`.`];
  }
  return [];
}

function latestCollectionUpdate(collections: Array<{ lastUpdated?: unknown; lastUpdatedAt?: unknown; last_updated?: unknown }>): string | null {
  const values = collections
    .map((collection) => stringValue(collection.lastUpdated) ?? stringValue(collection.lastUpdatedAt) ?? stringValue(collection.last_updated))
    .filter((value): value is string => Boolean(value))
    .sort();
  return values.at(-1) ?? null;
}

function isPathAllowed(targetPath: string, model: WorkspaceModel): boolean {
  const roots = [...model.noteRoots, ...model.projectRoots, ...model.indexedRoots].map((root) => root.path);
  return roots.some((root) => isWithin(root, targetPath));
}

function isWithin(root: string, targetPath: string): boolean {
  const relative = path.relative(path.resolve(root), path.resolve(targetPath));
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

function isDocid(value: string): boolean {
  return /^#[a-zA-Z0-9]+$/.test(value.trim());
}

async function readBoundedContent(filePath: string, maxLines: number): Promise<string> {
  return sliceLines(await readFile(filePath, "utf8"), undefined, maxLines);
}

function sliceLines(text: string, fromLine?: number, maxLines?: number): string {
  const lines = text.split("\n");
  const startIndex = Math.max((fromLine ?? 1) - 1, 0);
  const endIndex = maxLines ? startIndex + maxLines : undefined;
  return lines.slice(startIndex, endIndex).join("\n");
}

function stringValue(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function numberValue(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
