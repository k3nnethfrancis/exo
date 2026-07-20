import { access, mkdir, readFile } from "node:fs/promises";
import path from "node:path";

import type { IndexReadOptions, IndexSearchOptions, IndexUpdateOptions, SearchProvider, SearchProviderMetadata } from "../search-provider";
import { readFilesystemDocument, searchFilesystem } from "./filesystem-provider";
import type {
  IndexedRoot,
  IndexReadResponse,
  IndexSearchResponse,
  IndexSearchResult,
  IndexSyncResult,
  IndexStatus,
  WorkspaceModel,
} from "../types";

type QmdModule = typeof import("@tobilu/qmd");
type QmdStore = Awaited<ReturnType<QmdModule["createStore"]>>;

interface QmdEmbedOptions {
  maxDocuments?: number;
  maxDocsPerBatch?: number;
  maxDurationMs?: number;
}

const DEFAULT_SEARCH_LIMIT = 10;
const DEFAULT_CONTENT_LINES = 80;
const QMD_DIRECTORY_NAME = "qmd";

export const qmdSearchProviderMetadata: SearchProviderMetadata = {
  id: "qmd",
  label: "QMD search",
  description: "Bundled local Markdown search provider.",
  lifecycle: "built-in",
  backend: "qmd",
  capabilities: ["lexical", "semantic", "hybrid", "read", "update", "embed", "sync"],
};

export class QmdSearchProvider implements SearchProvider {
  readonly metadata = qmdSearchProviderMetadata;

  getStatus(model: WorkspaceModel, runtimeRoot: string): Promise<IndexStatus> {
    return getIndexStatus(model, runtimeRoot);
  }

  search(model: WorkspaceModel, runtimeRoot: string, query: string, options: IndexSearchOptions = {}): Promise<IndexSearchResponse> {
    return searchIndex(model, runtimeRoot, query, options);
  }

  read(model: WorkspaceModel, runtimeRoot: string, target: string, options: IndexReadOptions = {}): Promise<IndexReadResponse> {
    return readIndexDocument(model, runtimeRoot, target, options);
  }

  readAuthorized(
    model: WorkspaceModel,
    runtimeRoot: string,
    target: string,
    options: IndexReadOptions,
    authorizeResolvedPath: (filePath: string) => Promise<void>,
  ): Promise<IndexReadResponse> {
    return readIndexDocument(model, runtimeRoot, target, options, authorizeResolvedPath);
  }

  update(model: WorkspaceModel, runtimeRoot: string, options: IndexUpdateOptions = {}): Promise<IndexStatus> {
    return updateIndex(model, runtimeRoot, options);
  }

  embed(model: WorkspaceModel, runtimeRoot: string, options?: QmdEmbedOptions): Promise<IndexStatus> {
    return embedIndex(model, runtimeRoot, options);
  }

  sync(model: WorkspaceModel, runtimeRoot: string): Promise<IndexSyncResult> {
    return syncIndex(model, runtimeRoot);
  }
}

export const qmdSearchProvider = new QmdSearchProvider();

export function getQmdRuntimePath(runtimeRoot: string): string {
  return path.join(runtimeRoot, QMD_DIRECTORY_NAME);
}

export function getQmdDbPath(runtimeRoot: string): string {
  return path.join(getQmdRuntimePath(runtimeRoot), "index.sqlite");
}

async function getIndexStatus(model: WorkspaceModel, runtimeRoot: string): Promise<IndexStatus> {
  const base = baseStatus(model, runtimeRoot);
  const runtimeWarnings = await runtimeStateWarnings(runtimeRoot);
  if (!model.indexing.enabled || model.indexing.mode === "off" || model.indexedRoots.length === 0) {
    return {
      ...base,
      warnings: [
        ...(model.indexing.enabled && model.indexedRoots.length === 0 ? ["No indexed roots are configured."] : []),
        ...runtimeWarnings,
      ],
    };
  }

  let store: QmdStore | null = null;
  try {
    store = await openQmdStore(model, runtimeRoot);
    const qmdStatus = await store.getStatus();
    const lastUpdated = latestCollectionUpdate(qmdStatus.collections);
    const documentCount = Number(qmdStatus.totalDocuments ?? 0);
    const pendingEmbeddings = Number(qmdStatus.needsEmbedding ?? 0);
    const hasVectorIndex = Boolean(qmdStatus.hasVectorIndex);
    const readinessWarnings = model.indexing.mode !== "lexical"
      && documentCount > 0
      && pendingEmbeddings === 0
      && !hasVectorIndex
      ? ["Semantic vector index is unavailable even though no embeddings are pending. Build embeddings to repair it."]
      : [];
    return {
      ...base,
      documentCount,
      pendingEmbeddings,
      hasVectorIndex,
      lastUpdated,
      // Readiness is structured state. The caller that owns automatic/manual
      // policy decides how to present pending embeddings; provider warnings
      // remain reserved for degradation and repair facts.
      warnings: [...readinessWarnings, ...runtimeWarnings],
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

async function runtimeStateWarnings(runtimeRoot: string): Promise<string[]> {
  // The packaged app intentionally puts derived state at <workspace>/.exo. Do
  // not silently write a user's repository configuration, but make a tracked
  // runtime directory visible before indexes/invocation records surprise them.
  if (path.basename(runtimeRoot) !== ".exo") {
    return [];
  }
  const workspaceRoot = path.dirname(runtimeRoot);
  if (!(await pathExists(path.join(workspaceRoot, ".git")))) {
    return [];
  }
  try {
    const gitignore = await readFile(path.join(workspaceRoot, ".gitignore"), "utf8");
    if (gitignore.split(/\r?\n/).some(ignoresExoRuntimePath)) {
      return [];
    }
  } catch {
    // A missing or unreadable .gitignore leaves the warning intentionally visible.
  }
  return ["This Workspace is a Git repository and .exo/ is not ignored. Add .exo/ to .gitignore; Exo will not modify repository files automatically."];
}

function ignoresExoRuntimePath(line: string): boolean {
  const rule = line.trim();
  return rule === ".exo" || rule === ".exo/" || rule === "/.exo" || rule === "/.exo/" || rule === "**/.exo" || rule === "**/.exo/";
}

async function pathExists(target: string): Promise<boolean> {
  return access(target).then(
    () => true,
    () => false,
  );
}

async function updateIndex(model: WorkspaceModel, runtimeRoot: string, options: IndexUpdateOptions = {}): Promise<IndexStatus> {
  ensureIndexEnabled(model);
  let store: QmdStore | null = null;
  try {
    store = await openQmdStore(model, runtimeRoot);
    const collections = selectedCollectionNames(model.indexedRoots, options.rootIds);
    await store.update(collections.length > 0 ? { collections } : undefined);
  } finally {
    await store?.close();
  }
  return getIndexStatus(model, runtimeRoot);
}

async function embedIndex(model: WorkspaceModel, runtimeRoot: string, options?: QmdEmbedOptions): Promise<IndexStatus> {
  ensureIndexEnabled(model);
  if (model.indexing.mode === "lexical") {
    throw new Error("Embedding is disabled in lexical mode.");
  }

  let store: QmdStore | null = null;
  try {
    store = await openQmdStore(model, runtimeRoot);
    await store.embed(options);
  } finally {
    await store?.close();
  }
  return getIndexStatus(model, runtimeRoot);
}

async function syncIndex(model: WorkspaceModel, runtimeRoot: string): Promise<IndexSyncResult> {
  const phases: IndexSyncResult["phases"] = [];
  const warnings: string[] = [];

  let status = await updateIndex(model, runtimeRoot);
  phases.push({
    name: "update",
    status: "completed",
    message: "Indexed documents refreshed.",
  });

  if (model.indexing.mode === "lexical") {
    phases.push({
      name: "embed",
      status: "skipped",
      message: "Embeddings are not needed in lexical mode.",
    });
    return { status, phases, warnings };
  }

  try {
    status = await embedIndex(model, runtimeRoot);
    phases.push({
      name: "embed",
      status: "completed",
      message: "Embeddings built.",
    });
  } catch (error) {
    const warning = `Embedding failed (${errorMessage(error)}); lexical search remains available.`;
    warnings.push(warning);
    status = await getIndexStatus(model, runtimeRoot);
    status = {
      ...status,
      warnings: [...status.warnings, warning],
    };
    phases.push({
      name: "embed",
      status: "failed",
      message: warning,
    });
  }

  return { status, phases, warnings };
}

async function searchIndex(
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
    return searchFilesystem(model, trimmedQuery, options, "QMD is unavailable; showing Simple search results.");
  }

  let store: QmdStore | null = null;
  try {
    store = await openQmdStore(model, runtimeRoot);
    const collections = selectedCollectionNames(model.indexedRoots, options.rootIds);
    const limit = options.limit ?? DEFAULT_SEARCH_LIMIT;
    const offset = Math.max(0, options.offset ?? 0);
    const providerLimit = offset + limit + 1;
    let rawResults: unknown[];
    const warnings: string[] = [];

    const effectiveMode = options.forceMode ?? model.indexing.mode;
    if (effectiveMode !== "lexical") {
      try {
        const qmdStatus = await store.getStatus();
        const pendingEmbeddings = Number(qmdStatus.needsEmbedding ?? 0);
        if (!Boolean(qmdStatus.hasVectorIndex) || pendingEmbeddings > 0) {
          warnings.push("Embeddings are not ready; Exo will use lexical fallback if semantic/hybrid search is unavailable.");
        }
      } catch {
        // Status warnings are best-effort; the actual query fallback below remains authoritative.
      }
    }

    if (effectiveMode === "lexical") {
      const lexical = await Promise.all(collections.map((collection) => store!.searchLex(trimmedQuery, { limit: providerLimit, collection })));
      rawResults = lexical.flat();
    } else if (effectiveMode === "semantic") {
      try {
        const [lexical, vector] = await Promise.all([
          Promise.all(collections.map((collection) => store!.searchLex(trimmedQuery, { limit: providerLimit, collection }))),
          Promise.all(collections.map((collection) => store!.searchVector(trimmedQuery, { limit: providerLimit, collection }))),
        ]);
        rawResults = [...lexical.flat(), ...vector.flat()];
      } catch (error) {
        // Preserve search as an orientation surface even when embeddings are stale or unavailable.
        // The warning keeps the degraded provider visible instead of silently pretending this was semantic.
        warnings.push(`Semantic search is not ready (${errorMessage(error)}); using lexical search.`);
        const lexical = await Promise.all(collections.map((collection) => store!.searchLex(trimmedQuery, { limit: providerLimit, collection })));
        rawResults = lexical.flat();
      }
    } else {
      try {
        const hybrid = await Promise.all(
          collections.map((collection) =>
            store!.search({
              query: trimmedQuery,
              collections: [collection],
              limit: providerLimit,
              intent: options.intent,
              rerank: true,
            }),
          ),
        );
        rawResults = hybrid.flat();
      } catch (error) {
        // Hybrid depends on the same vector path as semantic search. Fall back to lexical results,
        // but keep a provider warning so index repair remains discoverable.
        warnings.push(`Hybrid search is not ready (${errorMessage(error)}); using lexical search.`);
        const lexical = await Promise.all(collections.map((collection) => store!.searchLex(trimmedQuery, { limit: providerLimit, collection })));
        rawResults = lexical.flat();
      }
    }

    const candidates = rawResults
      .map((result) => mapQmdResult(result, model.indexedRoots))
      .filter((result): result is IndexSearchResult => result !== null)
      .sort((left, right) => right.score - left.score)
    let results = candidates.slice(offset, offset + limit);

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
      mode: effectiveMode,
      source: "qmd",
      warnings,
      results,
      hasMore: candidates.length > offset + results.length,
    };
  } catch (error) {
    // If QMD cannot open at all, keep basic workspace search usable. This fallback is intentionally
    // degraded and warning-bearing; admin/status paths should still surface the underlying QMD issue.
    return searchFilesystem(model, trimmedQuery, options, qmdFallbackWarning(error));
  } finally {
    await store?.close();
  }
}

async function readIndexDocument(
  model: WorkspaceModel,
  runtimeRoot: string,
  target: string,
  options: IndexReadOptions = {},
  authorizeResolvedPath?: (filePath: string) => Promise<void>,
): Promise<IndexReadResponse> {
  if (isDocid(target) && shouldUseQmd(model)) {
    let store: QmdStore | null = null;
    try {
      store = await openQmdStore(model, runtimeRoot);
      const doc = await store.get(target, { includeBody: false });
      if ("error" in doc) {
        throw new Error(`Document not found: ${target}`);
      }
      const filePath = resolveQmdPath(doc.filepath, model.indexedRoots);
      if (!filePath || !isPathAllowedByIndexedRoot(filePath, model)) {
        throw new Error("Refusing to read a QMD document outside configured indexed roots.");
      }
      await authorizeResolvedPath?.(filePath);
      const body = await store.getDocumentBody(target, {
        fromLine: options.fromLine,
        maxLines: options.maxLines,
      });
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

  return readFilesystemDocument(model, target, options, authorizeResolvedPath);
}

async function openQmdStore(model: WorkspaceModel, runtimeRoot: string): Promise<QmdStore> {
  await mkdir(getQmdRuntimePath(runtimeRoot), { recursive: true });
  const qmd = await import("@tobilu/qmd");
  return qmd.createStore({
    dbPath: getQmdDbPath(runtimeRoot),
    config: {
      global_context: "Exo-managed QMD search provider. Indexed roots are explicitly selected by the user.",
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

function latestCollectionUpdate(collections: Array<{ lastUpdated?: unknown; lastUpdatedAt?: unknown; last_updated?: unknown }>): string | null {
  const values = collections
    .map((collection) => stringValue(collection.lastUpdated) ?? stringValue(collection.lastUpdatedAt) ?? stringValue(collection.last_updated))
    .filter((value): value is string => Boolean(value))
    .sort();
  return values.at(-1) ?? null;
}

function isPathAllowedByIndexedRoot(targetPath: string, model: WorkspaceModel): boolean {
  return model.indexedRoots.some((root) => isWithin(root.path, targetPath));
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

function qmdFallbackWarning(error: unknown): string {
  const message = errorMessage(error);
  const lowerMessage = message.toLowerCase();
  if (
    lowerMessage.includes("node_module_version") ||
    lowerMessage.includes("was compiled against") ||
    lowerMessage.includes("abi") ||
    lowerMessage.includes("dlopen")
  ) {
    return `QMD native ABI mismatch (${message}); using degraded filesystem search.`;
  }
  if (
    lowerMessage.includes("vec0") ||
    lowerMessage.includes("sqlite-vec") ||
    lowerMessage.includes("no such module")
  ) {
    return `QMD vec0 extension is unavailable (${message}); using degraded filesystem search.`;
  }
  return `QMD search failed (${message}); using degraded filesystem search.`;
}
