import { qmdSearchProvider, getQmdDbPath, getQmdRuntimePath } from "./search-providers/qmd-provider";
import type { IndexReadOptions, IndexRootInput, IndexSearchOptions, IndexUpdateOptions } from "./search-provider";
import type { IndexReadResponse, IndexSearchResponse, IndexSyncResult, IndexStatus, WorkspaceModel } from "./types";

export type { IndexReadOptions, IndexRootInput, IndexSearchOptions, IndexUpdateOptions };
export { getQmdDbPath, getQmdRuntimePath, qmdSearchProvider };

export async function getIndexStatus(model: WorkspaceModel, runtimeRoot: string): Promise<IndexStatus> {
  return qmdSearchProvider.getStatus(model, runtimeRoot);
}

export async function updateIndex(model: WorkspaceModel, runtimeRoot: string, options: IndexUpdateOptions = {}): Promise<IndexStatus> {
  return qmdSearchProvider.update(model, runtimeRoot, options);
}

export async function embedIndex(model: WorkspaceModel, runtimeRoot: string): Promise<IndexStatus> {
  return qmdSearchProvider.embed(model, runtimeRoot);
}

export async function syncIndex(model: WorkspaceModel, runtimeRoot: string): Promise<IndexSyncResult> {
  return qmdSearchProvider.sync(model, runtimeRoot);
}

export async function searchIndex(
  model: WorkspaceModel,
  runtimeRoot: string,
  query: string,
  options: IndexSearchOptions = {},
): Promise<IndexSearchResponse> {
  return qmdSearchProvider.search(model, runtimeRoot, query, options);
}

export async function readIndexDocument(
  model: WorkspaceModel,
  runtimeRoot: string,
  target: string,
  options: IndexReadOptions = {},
): Promise<IndexReadResponse> {
  return qmdSearchProvider.read(model, runtimeRoot, target, options);
}
