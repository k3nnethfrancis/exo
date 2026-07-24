import { access, mkdir, readFile } from "node:fs/promises";
import path from "node:path";

import type { IndexReadOptions, IndexSearchOptions, IndexUpdateOptions, SearchProvider, SearchProviderMetadata } from "../search-provider";
import { readFilesystemDocument, searchFilesystem } from "./filesystem-provider";
import { WorkspaceFiles } from "../workspace-files";
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

type QmdStreamFetch = (limit: number) => Promise<unknown[]>;

interface FilteredQmdResults {
  results: IndexSearchResult[];
  rejectedCount: number;
}

interface QmdStreamState {
  fetch: QmdStreamFetch;
  scanLimit: number;
  rawResults: unknown[];
  filtered: FilteredQmdResults;
  exhausted: boolean;
  complete: boolean;
}

class QmdStreamQueryError extends Error {
  constructor(readonly reason: unknown) {
    super(errorMessage(reason));
    this.name = "QmdStreamQueryError";
  }
}

class QmdSearchIncompleteError extends Error {
  constructor() {
    super(`QMD search reached the hard scan limit of ${MAX_QMD_SCAN_RESULTS_PER_STREAM} results in a provider stream before finding enough authorized results or proving exhaustion.`);
    this.name = "QmdSearchIncompleteError";
  }
}

const DEFAULT_SEARCH_LIMIT = 10;
const DEFAULT_CONTENT_LINES = 80;
const MAX_QMD_SCAN_RESULTS_PER_STREAM = 100;
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
  const selectedRoots = selectIndexedRoots(model.indexedRoots, options.rootIds);
  if (selectedRoots.length === 0) {
    return getIndexStatus(model, runtimeRoot);
  }

  let store: QmdStore | null = null;
  try {
    store = await openQmdStore(model, runtimeRoot);
    await store.update({ collections: selectedRoots.map(collectionName) });
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
    const qmdStore = await openQmdStore(model, runtimeRoot);
    store = qmdStore;
    const selectedRoots = selectIndexedRoots(model.indexedRoots, options.rootIds);
    const collections = selectedRoots.map(collectionName);
    const indexedRootFiles = new WorkspaceFiles(selectedRoots.map((root) => root.path));
    const limit = options.limit ?? DEFAULT_SEARCH_LIMIT;
    const offset = Math.max(0, options.offset ?? 0);
    const targetResultCount = offset + limit + 1;
    const warnings: string[] = [];
    const lexicalStreams = (): QmdStreamFetch[] => collections.map(
      (collection) => (scanLimit) => qmdStore.searchLex(trimmedQuery, { limit: scanLimit, collection }),
    );

    const effectiveMode = options.forceMode ?? model.indexing.mode;
    let actualMode = effectiveMode;
    if (effectiveMode !== "lexical") {
      try {
        const qmdStatus = await qmdStore.getStatus();
        const pendingEmbeddings = Number(qmdStatus.needsEmbedding ?? 0);
        if (!Boolean(qmdStatus.hasVectorIndex) || pendingEmbeddings > 0) {
          warnings.push("Embeddings are not ready; Exo will use lexical fallback if semantic/hybrid search is unavailable.");
        }
      } catch {
        // Status warnings are best-effort; the actual query fallback below remains authoritative.
      }
    }

    let filteredResults: FilteredQmdResults;
    if (effectiveMode === "lexical") {
      filteredResults = await refillQmdStreams(
        lexicalStreams(),
        targetResultCount,
        selectedRoots,
        indexedRootFiles,
        options,
      );
    } else if (effectiveMode === "semantic") {
      try {
        filteredResults = await refillQmdStreams(
          [
            ...lexicalStreams(),
            ...collections.map(
              (collection): QmdStreamFetch =>
                (scanLimit) => qmdStore.searchVector(trimmedQuery, { limit: scanLimit, collection }),
            ),
          ],
          targetResultCount,
          selectedRoots,
          indexedRootFiles,
          options,
        );
      } catch (error) {
        if (!(error instanceof QmdStreamQueryError)) {
          throw error;
        }
        // Preserve search as an orientation surface even when embeddings are stale or unavailable.
        // The warning keeps the degraded provider visible instead of silently pretending this was semantic.
        warnings.push(`Semantic search is not ready (${errorMessage(error.reason)}); using lexical search.`);
        filteredResults = await refillQmdStreams(
          lexicalStreams(),
          targetResultCount,
          selectedRoots,
          indexedRootFiles,
          options,
        );
        actualMode = "lexical";
      }
    } else {
      try {
        filteredResults = await refillQmdStreams(
          collections.map(
            (collection): QmdStreamFetch =>
              (scanLimit) => qmdStore.search({
                query: trimmedQuery,
                collections: [collection],
                limit: scanLimit,
                intent: options.intent,
                rerank: true,
              }),
          ),
          targetResultCount,
          selectedRoots,
          indexedRootFiles,
          options,
        );
      } catch (error) {
        if (!(error instanceof QmdStreamQueryError)) {
          throw error;
        }
        // Hybrid depends on the same vector path as semantic search. Fall back to lexical results,
        // but keep a provider warning so index repair remains discoverable.
        warnings.push(`Hybrid search is not ready (${errorMessage(error.reason)}); using lexical search.`);
        filteredResults = await refillQmdStreams(
          lexicalStreams(),
          targetResultCount,
          selectedRoots,
          indexedRootFiles,
          options,
        );
        actualMode = "lexical";
      }
    }

    const pageableResults = filteredResults.results.sort((left, right) => right.score - left.score);
    const results = pageableResults.slice(offset, offset + limit);

    if (filteredResults.rejectedCount > 0) {
      warnings.push(droppedQmdResultWarning(filteredResults.rejectedCount));
    }

    return {
      query: trimmedQuery,
      mode: actualMode,
      source: "qmd",
      warnings,
      results,
      hasMore: pageableResults.length > offset + results.length,
    };
  } catch (error) {
    if (error instanceof QmdSearchIncompleteError) {
      throw error;
    }
    // If QMD cannot open at all, keep basic workspace search usable. This fallback is intentionally
    // degraded and warning-bearing; admin/status paths should still surface the underlying QMD issue.
    return searchFilesystem(model, trimmedQuery, options, qmdFallbackWarning(error));
  } finally {
    await store?.close();
  }
}

async function refillQmdStreams(
  streams: readonly QmdStreamFetch[],
  targetResultCount: number,
  roots: IndexedRoot[],
  indexedRootFiles: WorkspaceFiles,
  options: IndexSearchOptions,
): Promise<FilteredQmdResults> {
  if (streams.length === 0) {
    return { results: [], rejectedCount: 0 };
  }

  const requiredResultCount = Number.isFinite(targetResultCount)
    ? Math.max(1, Math.ceil(targetResultCount))
    : MAX_QMD_SCAN_RESULTS_PER_STREAM + 1;
  const initialScanLimit = Math.min(requiredResultCount, MAX_QMD_SCAN_RESULTS_PER_STREAM);
  const states: QmdStreamState[] = streams.map((fetch) => ({
    fetch,
    scanLimit: initialScanLimit,
    rawResults: [],
    filtered: { results: [], rejectedCount: 0 },
    exhausted: false,
    complete: false,
  }));

  while (states.some((state) => !state.complete)) {
    const activeStates = states.filter((state) => !state.complete);
    const queryResults = await Promise.allSettled(
      activeStates.map((state) => state.fetch(state.scanLimit)),
    );
    const queryFailure = queryResults.find((result) => result.status === "rejected");
    if (queryFailure?.status === "rejected") {
      throw new QmdStreamQueryError(queryFailure.reason);
    }

    for (let index = 0; index < activeStates.length; index += 1) {
      const queryResult = queryResults[index];
      if (queryResult.status !== "fulfilled") {
        continue;
      }
      const state = activeStates[index];
      state.rawResults = queryResult.value.slice(0, state.scanLimit);
      state.exhausted = queryResult.value.length < state.scanLimit;
    }

    const filteredResults = await Promise.all(
      activeStates.map((state) =>
        filterQmdStreamResults(state.rawResults, roots, indexedRootFiles, options)),
    );
    let reachedIncompleteCap = false;
    for (let index = 0; index < activeStates.length; index += 1) {
      const state = activeStates[index];
      state.filtered = filteredResults[index];
      if (state.filtered.results.length >= requiredResultCount || state.exhausted) {
        state.complete = true;
      } else if (state.scanLimit >= MAX_QMD_SCAN_RESULTS_PER_STREAM) {
        reachedIncompleteCap = true;
      } else {
        state.scanLimit = Math.min(state.scanLimit * 2, MAX_QMD_SCAN_RESULTS_PER_STREAM);
      }
    }
    if (reachedIncompleteCap) {
      throw new QmdSearchIncompleteError();
    }
  }

  return {
    results: states.flatMap((state) => state.filtered.results),
    rejectedCount: states.reduce((total, state) => total + state.filtered.rejectedCount, 0),
  };
}

async function filterQmdStreamResults(
  rawResults: unknown[],
  roots: IndexedRoot[],
  indexedRootFiles: WorkspaceFiles,
  options: IndexSearchOptions,
): Promise<FilteredQmdResults> {
  const mappedResults = rawResults
    .map((result) => mapQmdResult(result, roots))
    .filter((result): result is IndexSearchResult => result !== null);
  const authorizedResults = await Promise.all(
    mappedResults.map(async (result) =>
      (await isAuthorizedIndexedRootPath(indexedRootFiles, result.filePath)) ? result : null),
  );
  let rejectedCount = rawResults.length
    - mappedResults.length
    + authorizedResults.filter((result) => result === null).length;
  let results = authorizedResults.filter((result): result is IndexSearchResult => result !== null);

  if (options.includeContent) {
    const hydratedResults = await Promise.all(
      results.map(async (result) => ({
        result,
        content: await readAuthorizedBoundedContent(
          result.filePath,
          indexedRootFiles,
          options.maxLinesPerResult ?? DEFAULT_CONTENT_LINES,
        ),
      })),
    );
    rejectedCount += hydratedResults.filter(({ content }) => content === null).length;
    results = hydratedResults
      .filter((entry): entry is { result: IndexSearchResult; content: string } => entry.content !== null)
      .map(({ result, content }) => ({ ...result, content }));
  }

  return { results, rejectedCount };
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
      const indexedRootFiles = new WorkspaceFiles(model.indexedRoots.map((root) => root.path));
      const doc = await store.get(target, { includeBody: false });
      if ("error" in doc) {
        throw new Error(`Document not found: ${target}`);
      }
      const filePath = resolveQmdPath(doc.filepath, model.indexedRoots);
      if (!filePath || !(await isAuthorizedIndexedRootPath(indexedRootFiles, filePath))) {
        throw new Error("Refusing to read a QMD document outside configured indexed roots.");
      }
      await authorizeResolvedPath?.(filePath);
      if (!(await isAuthorizedIndexedRootPath(indexedRootFiles, filePath))) {
        throw new Error("Refusing to read a QMD document outside configured indexed roots.");
      }
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

function selectIndexedRoots(roots: IndexedRoot[], rootIds: string[] | undefined): IndexedRoot[] {
  if (rootIds === undefined) {
    return roots;
  }
  const selectedIds = new Set(rootIds);
  return roots.filter((root) => selectedIds.has(root.id));
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
  if (segments.includes("..")) {
    return null;
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

async function isAuthorizedIndexedRootPath(indexedRootFiles: WorkspaceFiles, targetPath: string): Promise<boolean> {
  try {
    await indexedRootFiles.existing(targetPath);
    return true;
  } catch {
    // A stale, unreadable, or escaping QMD path is not an authorized result.
    return false;
  }
}

function isDocid(value: string): boolean {
  return /^#[a-zA-Z0-9]+$/.test(value.trim());
}

async function readAuthorizedBoundedContent(filePath: string, indexedRootFiles: WorkspaceFiles, maxLines: number): Promise<string | null> {
  if (!(await isAuthorizedIndexedRootPath(indexedRootFiles, filePath))) {
    return null;
  }
  return sliceLines(await readFile(filePath, "utf8"), undefined, maxLines);
}

function droppedQmdResultWarning(count: number): string {
  return `Dropped ${count} invalid or stale QMD ${count === 1 ? "result" : "results"}.`;
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
