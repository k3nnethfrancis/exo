import {
  qmdSearchProvider,
  WorkspaceIndex,
  WorkspaceGraph,
  type GraphConceptDetail,
  type GraphViewBundle,
  type IndexStatus,
  type IndexSyncResult,
  type WorkspaceGraphContext,
  type WorkspaceModel,
  type WorkspaceIndexSearchResponse,
} from "@exo/core";

import type {
  DerivedIndexRequest,
  DerivedIndexResponse,
  DerivedIndexWorkerRequest,
} from "./derived-index-protocol";

const MAX_RESPONSE_BYTES = 8 * 1024 * 1024;
const MAX_ERROR_CHARS = 8_192;
const cancelledRequests = new Set<number>();
const liveRequests = new Set<number>();
let operationQueue = Promise.resolve();
let workspaceGraph: WorkspaceGraph | null = null;
let workspaceGraphKey: string | null = null;

process.parentPort.on("message", (event) => {
  const message = event.data as DerivedIndexWorkerRequest;
  if (message?.operation === "cancel" && Number.isSafeInteger(message.id)) {
    if (liveRequests.has(message.id)) cancelledRequests.add(message.id);
    return;
  }
  if (!isRequest(message)) return;
  liveRequests.add(message.id);
  operationQueue = operationQueue.then(() => execute(message), () => execute(message));
});

async function execute(request: DerivedIndexRequest): Promise<void> {
  if (cancelledRequests.delete(request.id)) {
    liveRequests.delete(request.id);
    return;
  }
  try {
    const result = await run(request);
    if (cancelledRequests.delete(request.id)) return;
    postBounded({ id: request.id, ok: true, result });
  } catch (error) {
    if (cancelledRequests.delete(request.id)) return;
    postBounded({ id: request.id, ok: false, error: errorMessage(error) });
  } finally {
    liveRequests.delete(request.id);
  }
}

function run(request: DerivedIndexRequest): Promise<IndexStatus | IndexSyncResult | WorkspaceIndexSearchResponse | WorkspaceGraphContext | GraphViewBundle | GraphConceptDetail | null> {
  const { model, runtimeRoot } = request.context;
  const index = new WorkspaceIndex({ context: { model, runtimeRoot } });
  switch (request.operation) {
    case "status":
      return index.status();
    case "search":
      return index.search(request.query, request.options);
    case "update":
      return qmdSearchProvider.update(model, runtimeRoot, { rootIds: request.rootIds });
    case "embed":
      return qmdSearchProvider.embed(model, runtimeRoot, request.options);
    case "sync":
      return index.rebuild();
    case "graph-context":
      return graphFor(model).contextForNote(request.filePath);
    case "graph-view":
      return graphFor(model).graphView(request.profileId);
    case "graph-concept-detail":
      return graphFor(model).graphConceptDetail(request.conceptId, request.sourceSnapshotId, request.profileId);
    case "graph-refresh":
      return graphFor(model).refreshFile(request.filePath).then(() => null);
    case "graph-invalidate":
      graphFor(model).invalidate();
      return Promise.resolve(null);
  }
}

function graphFor(model: WorkspaceModel): WorkspaceGraph {
  const key = model.noteRoots
    .map((root) => `${root.id}:${root.path}`)
    .sort()
    .join("\n");
  if (!workspaceGraph || workspaceGraphKey !== key) {
    workspaceGraph = new WorkspaceGraph(model);
    workspaceGraphKey = key;
  }
  return workspaceGraph;
}

function postBounded(response: DerivedIndexResponse): void {
  const size = Buffer.byteLength(JSON.stringify(response), "utf8");
  if (size > MAX_RESPONSE_BYTES) {
    process.parentPort.postMessage({
      id: response.id,
      ok: false,
      error: `Derived index response exceeded the ${MAX_RESPONSE_BYTES}-byte limit.`,
    } satisfies DerivedIndexResponse);
    return;
  }
  process.parentPort.postMessage(response);
}

function isRequest(value: unknown): value is DerivedIndexRequest {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<DerivedIndexRequest>;
  return Number.isSafeInteger(candidate.id)
    && ["status", "search", "update", "embed", "sync", "graph-context", "graph-view", "graph-concept-detail", "graph-refresh", "graph-invalidate"].includes(String(candidate.operation))
    && Boolean(candidate.context?.model)
    && typeof candidate.context?.runtimeRoot === "string";
}

function errorMessage(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return message.slice(0, MAX_ERROR_CHARS);
}
