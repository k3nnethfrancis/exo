import { readFile } from "node:fs/promises";
import path from "node:path";

import { readWorkspaceDocument } from "../notes";
import type { IndexReadOptions, IndexSearchOptions, IndexUpdateOptions, SearchProvider, SearchProviderMetadata } from "../search-provider";
import type {
  IndexReadResponse,
  IndexSearchResponse,
  IndexSearchResult,
  IndexStatus,
  IndexSyncResult,
  WorkspaceModel,
} from "../types";
import { searchWorkspace } from "../workspace";

const DEFAULT_SEARCH_LIMIT = 10;
const DEFAULT_CONTENT_LINES = 80;

export const filesystemSearchProviderMetadata: SearchProviderMetadata = {
  id: "filesystem",
  label: "Core filesystem search",
  description: "Built-in filename, path, tag, and text search across attached Exo roots.",
  lifecycle: "built-in",
  backend: "filesystem",
  capabilities: ["lexical", "read"],
};

export class FilesystemSearchProvider implements SearchProvider {
  readonly metadata = filesystemSearchProviderMetadata;

  async getStatus(model: WorkspaceModel, runtimeRoot: string): Promise<IndexStatus> {
    return filesystemStatus(model, runtimeRoot);
  }

  async search(model: WorkspaceModel, _runtimeRoot: string, query: string, options: IndexSearchOptions = {}): Promise<IndexSearchResponse> {
    return searchFilesystem(model, query, options);
  }

  async read(model: WorkspaceModel, _runtimeRoot: string, target: string, options: IndexReadOptions = {}): Promise<IndexReadResponse> {
    return readFilesystemDocument(model, target, options);
  }

  async update(model: WorkspaceModel, runtimeRoot: string, _options: IndexUpdateOptions = {}): Promise<IndexStatus> {
    return filesystemStatus(model, runtimeRoot);
  }

  async embed(model: WorkspaceModel, runtimeRoot: string): Promise<IndexStatus> {
    return {
      ...filesystemStatus(model, runtimeRoot),
      warnings: ["Core filesystem search does not use embeddings."],
    };
  }

  async sync(model: WorkspaceModel, runtimeRoot: string): Promise<IndexSyncResult> {
    const status = filesystemStatus(model, runtimeRoot);
    return {
      status,
      warnings: [],
      phases: [
        {
          name: "update",
          status: "skipped",
          message: "Core filesystem search reads attached roots directly.",
        },
        {
          name: "embed",
          status: "skipped",
          message: "Core filesystem search does not use embeddings.",
        },
      ],
    };
  }
}

export const filesystemSearchProvider = new FilesystemSearchProvider();

export async function searchFilesystem(
  model: WorkspaceModel,
  query: string,
  options: IndexSearchOptions = {},
  warning?: string,
): Promise<IndexSearchResponse> {
  const trimmedQuery = query.trim();
  if (!trimmedQuery) {
    return {
      query,
      mode: "lexical",
      source: "filesystem",
      warnings: ["Search query is empty."],
      results: [],
    };
  }

  const workspaceResults = await searchWorkspace(model, trimmedQuery);
  const limit = options.limit ?? DEFAULT_SEARCH_LIMIT;
  let results = [...workspaceResults.notes, ...workspaceResults.projectFiles, ...workspaceResults.tags]
    .slice(0, limit)
    .map<IndexSearchResult>((result) => ({
      filePath: result.filePath,
      title: result.title,
      snippet: result.snippet,
      score: 0,
      source: "filesystem",
    }));

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
    mode: "lexical",
    source: "filesystem",
    warnings: warning ? [warning] : [],
    results,
  };
}

export async function readFilesystemDocument(
  model: WorkspaceModel,
  target: string,
  options: IndexReadOptions = {},
): Promise<IndexReadResponse> {
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

function filesystemStatus(model: WorkspaceModel, runtimeRoot: string): IndexStatus {
  return {
    enabled: true,
    mode: "lexical",
    backend: "filesystem",
    dbPath: "",
    runtimePath: runtimeRoot,
    indexedRoots: model.indexedRoots,
    documentCount: 0,
    pendingEmbeddings: 0,
    hasVectorIndex: false,
    lastUpdated: null,
    warnings: [],
    errors: [],
  };
}

function isPathAllowed(targetPath: string, model: WorkspaceModel): boolean {
  const roots = [...model.noteRoots, ...model.projectRoots, ...model.indexedRoots].map((root) => root.path);
  return roots.some((root) => isWithin(root, targetPath));
}

function isWithin(root: string, targetPath: string): boolean {
  const relative = path.relative(path.resolve(root), path.resolve(targetPath));
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
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
