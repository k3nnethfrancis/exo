import type {
  IndexedRoot,
  IndexReadResponse,
  IndexSearchResponse,
  IndexSyncResult,
  IndexStatus,
  WorkspaceModel,
} from "./types";
import type { CapabilityMetadata } from "./capabilities";

export interface IndexSearchOptions {
  limit?: number;
  intent?: string;
  rootIds?: string[];
  includeContent?: boolean;
  maxLinesPerResult?: number;
  forceMode?: "lexical" | "semantic" | "hybrid";
}

export interface IndexReadOptions {
  fromLine?: number;
  maxLines?: number;
}

export interface IndexUpdateOptions {
  rootIds?: string[];
}

export interface IndexRootInput {
  path: string;
  id?: string;
  label?: string;
  kind?: IndexedRoot["kind"];
  pattern?: string;
  ignore?: string[];
}

export interface SearchProvider {
  metadata: CapabilityMetadata;
  getStatus(model: WorkspaceModel, runtimeRoot: string): Promise<IndexStatus>;
  search(model: WorkspaceModel, runtimeRoot: string, query: string, options?: IndexSearchOptions): Promise<IndexSearchResponse>;
  read(model: WorkspaceModel, runtimeRoot: string, target: string, options?: IndexReadOptions): Promise<IndexReadResponse>;
  update(model: WorkspaceModel, runtimeRoot: string, options?: IndexUpdateOptions): Promise<IndexStatus>;
  embed(model: WorkspaceModel, runtimeRoot: string): Promise<IndexStatus>;
  sync(model: WorkspaceModel, runtimeRoot: string): Promise<IndexSyncResult>;
}
