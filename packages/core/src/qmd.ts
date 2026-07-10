import { defaultSearchProvider } from "./search-provider-registry";
import { filesystemSearchProvider } from "./search-providers/filesystem-provider";
import { qmdSearchProvider, getQmdDbPath, getQmdRuntimePath } from "./search-providers/qmd-provider";
import type { IndexReadOptions, IndexRootInput, IndexSearchOptions, IndexUpdateOptions } from "./search-provider";
import type { IndexReadResponse, IndexSearchResponse, IndexSyncResult, IndexStatus, WorkspaceModel } from "./types";

export type { IndexReadOptions, IndexRootInput, IndexSearchOptions, IndexUpdateOptions };
export { filesystemSearchProvider, getQmdDbPath, getQmdRuntimePath, qmdSearchProvider };

export async function getIndexStatus(model: WorkspaceModel, runtimeRoot: string): Promise<IndexStatus> {
  return defaultSearchProvider().getStatus(model, runtimeRoot);
}

export async function updateIndex(model: WorkspaceModel, runtimeRoot: string, options: IndexUpdateOptions = {}): Promise<IndexStatus> {
  return defaultSearchProvider().update(model, runtimeRoot, options);
}

export async function embedIndex(model: WorkspaceModel, runtimeRoot: string): Promise<IndexStatus> {
  return defaultSearchProvider().embed(model, runtimeRoot);
}

export async function syncIndex(model: WorkspaceModel, runtimeRoot: string): Promise<IndexSyncResult> {
  return defaultSearchProvider().sync(model, runtimeRoot);
}

export async function searchIndex(
  model: WorkspaceModel,
  runtimeRoot: string,
  query: string,
  options: IndexSearchOptions = {},
): Promise<IndexSearchResponse> {
  return defaultSearchProvider().search(model, runtimeRoot, query, options);
}

export async function readIndexDocument(
  model: WorkspaceModel,
  runtimeRoot: string,
  target: string,
  options: IndexReadOptions = {},
): Promise<IndexReadResponse> {
  return defaultSearchProvider().read(model, runtimeRoot, target, options);
}

export async function readAuthorizedIndexDocument(
  model: WorkspaceModel,
  runtimeRoot: string,
  target: string,
  options: IndexReadOptions,
  authorizeResolvedPath: (filePath: string) => Promise<void>,
): Promise<IndexReadResponse> {
  return qmdSearchProvider.readAuthorized(model, runtimeRoot, target, options, authorizeResolvedPath);
}
