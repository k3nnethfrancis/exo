import type {
  IndexSearchResponse,
  IndexStatus,
  IndexSyncResult,
  SearchResult,
  WorkspaceSearchResults,
} from "@exo/core";

export interface IndexSyncStateEvent {
  state: "running" | "idle" | "error";
  reason: string;
  result?: IndexSyncResult;
  error?: string;
}

export interface WorkspaceIndexApi {
  getIndexStatus: () => Promise<IndexStatus>;
  syncIndex: () => Promise<IndexSyncResult>;
  updateIndex: () => Promise<IndexStatus>;
  embedIndex: () => Promise<IndexStatus>;
  searchNotes: (query: string) => Promise<SearchResult[]>;
  searchWorkspace: (query: string) => Promise<WorkspaceSearchResults>;
  searchIndex: (query: string, options?: { limit?: number; forceMode?: "lexical" | "semantic" | "hybrid" }) => Promise<IndexSearchResponse>;
  searchTag: (tag: string) => Promise<SearchResult[]>;
  onIndexSyncState: (callback: (event: IndexSyncStateEvent) => void) => () => void;
}
