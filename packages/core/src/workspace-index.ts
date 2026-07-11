import type { IndexSearchOptions, SearchProvider } from "./search-provider";
import { filesystemSearchProvider } from "./search-providers/filesystem-provider";
import { qmdSearchProvider } from "./search-providers/qmd-provider";
import type { IndexSearchResponse, IndexStatus, IndexSyncResult, WorkspaceModel } from "./types";

/** The complete, immutable input needed for one index operation. */
export interface WorkspaceIndexContext {
  readonly model: WorkspaceModel;
  readonly runtimeRoot: string;
}

/** Concrete providers are adapters, not an extension registry. */
export interface WorkspaceIndexAdapters {
  readonly qmd: SearchProvider;
  readonly filesystem: SearchProvider;
}

export interface WorkspaceIndexOptions {
  readonly context: WorkspaceIndexContext;
  readonly adapters?: Partial<WorkspaceIndexAdapters>;
}

export interface WorkspaceIndexSearchResponse extends IndexSearchResponse {
  readonly provider: "qmd" | "filesystem";
  readonly degraded: boolean;
  /** Number of result candidates observed by the provider when known. */
  readonly visited: number | null;
  readonly truncated: boolean;
}

export interface WorkspaceIndexStatus extends IndexStatus {
  readonly provider: "qmd" | "filesystem";
  readonly degraded: boolean;
}

const defaultAdapters: WorkspaceIndexAdapters = {
  qmd: qmdSearchProvider,
  filesystem: filesystemSearchProvider,
};

/**
 * The workspace's single index boundary. It owns provider selection and keeps
 * provider degradation visible to callers; callers never need a registry or a
 * second model/runtime-root argument.
 */
export class WorkspaceIndex {
  private readonly adapters: WorkspaceIndexAdapters;

  constructor(private readonly options: WorkspaceIndexOptions) {
    this.adapters = {
      ...defaultAdapters,
      ...options.adapters,
    };
  }

  async search(query: string, searchOptions: IndexSearchOptions = {}): Promise<WorkspaceIndexSearchResponse> {
    const provider = this.selectProvider();
    const response = await provider.search(this.options.context.model, this.options.context.runtimeRoot, query, searchOptions);
    const limit = searchOptions.limit;
    const degraded = response.source !== provider.metadata.id || response.warnings.length > 0;
    return {
      ...response,
      provider: response.source,
      degraded,
      visited: response.results.length,
      truncated: limit !== undefined && response.results.length >= limit,
    };
  }

  async status(): Promise<WorkspaceIndexStatus> {
    const provider = this.selectProvider();
    const status = await provider.getStatus(this.options.context.model, this.options.context.runtimeRoot);
    return {
      ...status,
      provider: provider.metadata.id as "qmd" | "filesystem",
      degraded: status.errors.length > 0 || status.warnings.length > 0,
    };
  }

  rebuild(): Promise<IndexSyncResult> {
    return this.adapters.qmd.sync(this.options.context.model, this.options.context.runtimeRoot);
  }

  private selectProvider(): SearchProvider {
    const { model } = this.options.context;
    return model.indexing.enabled && model.indexing.mode !== "off" && model.indexedRoots.length > 0
      ? this.adapters.qmd
      : this.adapters.filesystem;
  }
}
