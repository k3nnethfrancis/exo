import type {
  IndexSearchOptions,
  IndexStatus,
  IndexSyncResult,
  GraphConceptDetailByIndexResult,
  GraphConceptLookupReference,
  GraphConceptLookupResult,
  GraphConceptSummaryResult,
  GraphTopology,
  WorkspaceGraphContext,
  WorkspaceIndexSearchResponse,
  WorkspaceModel,
} from "@exo/core";

export interface DerivedIndexContext {
  model: WorkspaceModel;
  runtimeRoot: string;
}

export interface DerivedIndexEmbedOptions {
  maxDocuments?: number;
  maxDocsPerBatch?: number;
  maxDurationMs?: number;
}

export type DerivedIndexRequest =
  | { id: number; operation: "status"; context: DerivedIndexContext }
  | { id: number; operation: "search"; context: DerivedIndexContext; query: string; options: IndexSearchOptions }
  | { id: number; operation: "update"; context: DerivedIndexContext; rootIds?: string[] }
  | { id: number; operation: "embed"; context: DerivedIndexContext; options?: DerivedIndexEmbedOptions }
  | { id: number; operation: "sync"; context: DerivedIndexContext }
  | { id: number; operation: "graph-context"; context: DerivedIndexContext; filePath: string }
  | { id: number; operation: "graph-topology"; context: DerivedIndexContext; profileId?: string | null }
  | { id: number; operation: "graph-concept-summaries"; context: DerivedIndexContext; indexes: number[]; sourceSnapshotId: string; profileId?: string | null }
  | { id: number; operation: "graph-concept-lookup"; context: DerivedIndexContext; reference: GraphConceptLookupReference; sourceSnapshotId: string; profileId?: string | null }
  | { id: number; operation: "graph-concept-detail-by-index"; context: DerivedIndexContext; index: number; sourceSnapshotId: string; profileId?: string | null }
  | { id: number; operation: "graph-refresh"; context: DerivedIndexContext; filePath: string }
  | { id: number; operation: "graph-invalidate"; context: DerivedIndexContext };

export type DerivedIndexRequestInput = DerivedIndexRequest extends infer Request
  ? Request extends { id: number }
    ? Omit<Request, "id">
    : never
  : never;

export interface DerivedIndexCancelRequest {
  id: number;
  operation: "cancel";
}

export type DerivedIndexWorkerRequest = DerivedIndexRequest | DerivedIndexCancelRequest;

export type DerivedIndexResult = IndexStatus | IndexSyncResult | WorkspaceIndexSearchResponse | WorkspaceGraphContext | GraphTopology | GraphConceptSummaryResult | GraphConceptLookupResult | GraphConceptDetailByIndexResult | null;

export type DerivedIndexResponse =
  | { id: number; ok: true; result: DerivedIndexResult }
  | { id: number; ok: false; error: string };

export function isDerivedIndexResponse(value: unknown): value is DerivedIndexResponse {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Record<string, unknown>;
  return Number.isSafeInteger(candidate.id) && typeof candidate.ok === "boolean"
    && (candidate.ok ? "result" in candidate : typeof candidate.error === "string");
}
