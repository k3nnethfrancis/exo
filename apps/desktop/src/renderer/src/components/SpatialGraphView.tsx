import { RefreshCw, Scan } from "lucide-react";
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
  type WheelEvent as ReactWheelEvent,
} from "react";
import type {
  BoundedGraphConceptDetail,
  GraphConceptLookupReference,
  GraphConceptSummary,
  GraphTopology,
} from "@exo/core";

import {
  graphEscapeDecision,
  graphNodeClickDecision,
  graphNodeDoubleClickDecision,
} from "../graphInteraction";
import {
  createGraphLayoutInput,
  graphKeyboardIntent,
  panGraphCamera,
  pickGraphSceneNode,
  zoomGraphCameraAt,
} from "../graphSceneFoundation";
import { browserGraphFrameDriver } from "../graphRenderScheduler";
import {
  GraphSnapshotRefreshCoordinator,
  SpatialGraphRuntime,
  SpatialGraphPointerSession,
  initialGraphSummaryIndexes,
  pruneGraphSnapshotCache,
  resolveGraphPalette,
  shouldRefreshGraphForWorkspaceChange,
  spatialGraphWheelIntent,
  type SpatialGraphRuntimeCounters,
} from "../spatialGraphRuntime";
import type { GraphCanvasSurface } from "../graphCanvasRenderer";
import type { GraphWebGpuSurface } from "../graphWebGpuRenderer";
import type { GraphLayoutWorkerRequest, GraphLayoutWorkerResponse } from "../graphLayoutWorkerProtocol";
import type { GraphFocusRequest, InspectedConcept } from "../hooks/useInspectedConcept";

interface SpatialGraphViewProps {
  refreshKey?: string;
  inspectedConcept: InspectedConcept | null;
  focusRequest: GraphFocusRequest | null;
  activeEditorPath?: string | null;
  isTargetOpen: (target: string) => boolean;
  onInspectConcept: (concept: InspectedConcept) => void;
  onFocusConcept: (concept: InspectedConcept) => void;
  onRestoreEditorConcept: (filePath: string) => void;
  onActivateOpenTarget: (filePath: string) => void;
  onOpenTarget: (target: string) => void;
}

interface RecentGraphPick {
  index: number;
  clientX: number;
  clientY: number;
  at: number;
}

type DebugCanvas = HTMLCanvasElement & {
  __exoGraphSnapshot?: () => (SpatialGraphRuntimeCounters & {
    metadataCacheEntries: number;
    sourceSnapshotId: string | null;
    selected: number;
    pathTarget: number;
    pathNodeCount: number;
    activeEditorPath: string | null;
    inspectedFilePath: string | null;
  }) | null;
  __exoGraphPointForIndex?: (index: number) => { x: number; y: number; visible: boolean } | null;
  __exoGraphPickAt?: (x: number, y: number) => number;
  __exoGraphForceCanvasFallback?: () => Promise<void>;
};

const PROFILE_ID = "generic-markdown" as const;

export function SpatialGraphView({
  refreshKey,
  inspectedConcept,
  focusRequest,
  activeEditorPath,
  isTargetOpen,
  onInspectConcept,
  onFocusConcept,
  onRestoreEditorConcept,
  onActivateOpenTarget,
  onOpenTarget,
}: SpatialGraphViewProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const webGpuCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const runtimeRef = useRef<SpatialGraphRuntime | null>(null);
  const workerRef = useRef<Worker | null>(null);
  const refreshCoordinatorRef = useRef<GraphSnapshotRefreshCoordinator | null>(null);
  const topologyRef = useRef<GraphTopology | null>(null);
  const activeEditorPathRef = useRef(activeEditorPath ?? null);
  const inspectedConceptRef = useRef(inspectedConcept);
  activeEditorPathRef.current = activeEditorPath ?? null;
  inspectedConceptRef.current = inspectedConcept;
  const summaryCacheRef = useRef(new Map<string, GraphConceptSummary>());
  const detailCacheRef = useRef(new Map<string, BoundedGraphConceptDetail>());
  const lookupCacheRef = useRef(new Map<string, GraphConceptSummary>());
  const pointerSessionRef = useRef(new SpatialGraphPointerSession());
  const recentPickRef = useRef<RecentGraphPick | null>(null);
  const loadSequenceRef = useRef(0);
  const inspectionSequenceRef = useRef(0);
  const generationRef = useRef(0);
  const activeGenerationRef = useRef(0);
  const topologyPendingRef = useRef(false);
  const metadataPendingRef = useRef(0);
  const layoutPendingRef = useRef(false);
  const [runtimeVersion, setRuntimeVersion] = useState(0);
  const [topology, setTopology] = useState<GraphTopology | null>(null);
  const [selectedDetail, setSelectedDetail] = useState<BoundedGraphConceptDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [detailStatus, setDetailStatus] = useState<string | null>(null);
  const [reloadNonce, setReloadNonce] = useState(0);
  const [rendererNonce, setRendererNonce] = useState(0);
  const [routeNodeCount, setRouteNodeCount] = useState(0);

  const updatePendingWork = useCallback(() => {
    runtimeRef.current?.setExternalPendingWork(
      Number(topologyPendingRef.current)
        + metadataPendingRef.current
        + Number(layoutPendingRef.current)
        + Number(Boolean(
          refreshCoordinatorRef.current?.snapshot().pending
          || refreshCoordinatorRef.current?.snapshot().awaitingChange,
        )),
    );
  }, []);

  const refreshForStaleRead = useCallback((sourceSnapshotId: string) => {
    if (topologyRef.current?.sourceSnapshotId !== sourceSnapshotId) return;
    setReloadNonce((value) => value + 1);
  }, []);

  const readSummaries = useCallback(async (indexes: readonly number[], sourceSnapshotId: string) => {
    const unique = [...new Set(indexes)]
      .filter((index) => Number.isSafeInteger(index) && index >= 0 && index < (topologyRef.current?.nodeCount ?? 0))
      .filter((index) => !summaryCacheRef.current.has(cacheKey(sourceSnapshotId, index)))
      .slice(0, 64);
    if (!unique.length) return;
    metadataPendingRef.current += 1;
    updatePendingWork();
    try {
      const result = await window.exo.notes.getGraphConceptSummaries(unique, sourceSnapshotId, PROFILE_ID);
      if (result.status === "stale") {
        refreshForStaleRead(sourceSnapshotId);
        return;
      }
      if (result.status === "too-large") {
        setDetailStatus("Graph labels exceeded the bounded read limit.");
        return;
      }
      if (result.status !== "ok" || topologyRef.current?.sourceSnapshotId !== sourceSnapshotId) return;
      for (const summary of result.summaries) summaryCacheRef.current.set(cacheKey(sourceSnapshotId, summary.index), summary);
      runtimeRef.current?.setSummaries(result.summaries);
    } catch (reason) {
      if (topologyRef.current?.sourceSnapshotId === sourceSnapshotId) {
        setDetailStatus(reason instanceof Error ? reason.message : String(reason));
      }
    } finally {
      metadataPendingRef.current = Math.max(0, metadataPendingRef.current - 1);
      updatePendingWork();
    }
  }, [refreshForStaleRead, updatePendingWork]);

  const readDetail = useCallback(async (index: number, sourceSnapshotId: string): Promise<BoundedGraphConceptDetail | null> => {
    const key = cacheKey(sourceSnapshotId, index);
    const cached = detailCacheRef.current.get(key);
    if (cached) return cached;
    metadataPendingRef.current += 1;
    updatePendingWork();
    try {
      const result = await window.exo.notes.getGraphConceptDetailByIndex(index, sourceSnapshotId, PROFILE_ID);
      if (result.status === "stale") {
        refreshForStaleRead(sourceSnapshotId);
        return null;
      }
      if (result.status === "too-large") {
        setDetailStatus("Concept detail exceeded the bounded read limit.");
        return null;
      }
      if (result.status === "missing") {
        setDetailStatus("Concept is no longer present in this graph.");
        return null;
      }
      if (!result.detail || topologyRef.current?.sourceSnapshotId !== sourceSnapshotId) return null;
      detailCacheRef.current.set(key, result.detail);
      return result.detail;
    } catch (reason) {
      if (topologyRef.current?.sourceSnapshotId === sourceSnapshotId) {
        setDetailStatus(reason instanceof Error ? reason.message : String(reason));
      }
      return null;
    } finally {
      metadataPendingRef.current = Math.max(0, metadataPendingRef.current - 1);
      updatePendingWork();
    }
  }, [refreshForStaleRead, updatePendingWork]);

  const resolveConcept = useCallback(async (concept: InspectedConcept, sourceSnapshotId: string) => {
    const reference = lookupReference(concept);
    if (!reference) return null;
    const key = lookupKey(sourceSnapshotId, reference);
    const cached = lookupCacheRef.current.get(key);
    if (cached) return cached;
    metadataPendingRef.current += 1;
    updatePendingWork();
    try {
      const result = await window.exo.notes.graphConceptLookup(reference, sourceSnapshotId, PROFILE_ID);
      if (result.status === "stale") {
        refreshForStaleRead(sourceSnapshotId);
        return null;
      }
      if (result.status === "missing") {
        setDetailStatus("Concept is no longer present in this graph.");
        return null;
      }
      if (result.status !== "ok" || !result.summary || topologyRef.current?.sourceSnapshotId !== sourceSnapshotId) return null;
      lookupCacheRef.current.set(key, result.summary);
      summaryCacheRef.current.set(cacheKey(sourceSnapshotId, result.summary.index), result.summary);
      runtimeRef.current?.setSummaries([result.summary]);
      return result.summary;
    } catch (reason) {
      if (topologyRef.current?.sourceSnapshotId === sourceSnapshotId) {
        setDetailStatus(reason instanceof Error ? reason.message : String(reason));
      }
      return null;
    } finally {
      metadataPendingRef.current = Math.max(0, metadataPendingRef.current - 1);
      updatePendingWork();
    }
  }, [refreshForStaleRead, updatePendingWork]);

  const inspectIndex = useCallback(async (index: number, announce: boolean) => {
    const currentTopology = topologyRef.current;
    if (!currentTopology || index < 0 || index >= currentTopology.nodeCount) return;
    runtimeRef.current?.setSelection(index);
    setRouteNodeCount(0);
    const summaryKey = cacheKey(currentTopology.sourceSnapshotId, index);
    if (!summaryCacheRef.current.has(summaryKey)) void readSummaries([index], currentTopology.sourceSnapshotId);
    const detail = await readDetail(index, currentTopology.sourceSnapshotId);
    if (!detail || topologyRef.current?.sourceSnapshotId !== currentTopology.sourceSnapshotId) return;
    if (announce) {
      onInspectConcept({ conceptId: detail.concept.id, filePath: detail.concept.filePath });
      return;
    }
    setSelectedDetail(detail);
    setDetailStatus(null);
  }, [onInspectConcept, readDetail, readSummaries]);

  useEffect(() => {
    const canvas = canvasRef.current as DebugCanvas | null;
    const webGpuCanvas = webGpuCanvasRef.current;
    if (!canvas || !webGpuCanvas) return;
    setError(null);
    let runtime: SpatialGraphRuntime;
    try {
      runtime = new SpatialGraphRuntime(canvas as unknown as GraphCanvasSurface, {
        frameDriver: browserGraphFrameDriver(),
        palette: resolveGraphPalette(canvas),
        dpr: window.devicePixelRatio || 1,
        webGpuSurface: webGpuCanvas as unknown as GraphWebGpuSurface,
        onDrawError: (reason) => setError(reason.message),
      });
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
      return;
    }
    runtimeRef.current = runtime;
    canvas.__exoGraphSnapshot = () => {
      const snapshot = runtimeRef.current?.snapshot();
      if (!snapshot) return null;
      return {
        ...snapshot,
        metadataCacheEntries: summaryCacheRef.current.size + detailCacheRef.current.size + lookupCacheRef.current.size,
        sourceSnapshotId: topologyRef.current?.sourceSnapshotId ?? null,
        selected: runtimeRef.current?.getScene()?.interaction.selected ?? -1,
        pathTarget: runtimeRef.current?.getScene()?.interaction.pathTarget ?? -1,
        pathNodeCount: runtimeRef.current?.getScene()?.interaction.pathNodes.reduce((count, value) => count + Number(value > 0), 0) ?? 0,
        activeEditorPath: activeEditorPathRef.current,
        inspectedFilePath: inspectedConceptRef.current?.filePath ?? null,
      };
    };
    canvas.__exoGraphPointForIndex = (index) => {
      const scene = runtimeRef.current?.getScene();
      if (!scene || index < 0 || index >= scene.topology.nodes.seeds.length) return null;
      const offset = index * 4;
      return {
        x: scene.projection.nodes[offset] ?? 0,
        y: scene.projection.nodes[offset + 1] ?? 0,
        visible: scene.projection.nodes[offset + 3] === 1,
      };
    };
    canvas.__exoGraphPickAt = (x, y) => {
      const scene = runtimeRef.current?.getScene();
      if (!scene) return -1;
      return pickGraphSceneNode(scene.topology, scene.projection, scene.camera, x, y, { pointer: "fine" });
    };
    canvas.__exoGraphForceCanvasFallback = () => runtime.forceCanvasFallbackForTesting();
    const refreshCoordinator = new GraphSnapshotRefreshCoordinator(
      {
        schedule: (callback, delay) => window.setTimeout(callback, delay),
        cancel: (handle) => window.clearTimeout(handle),
      },
      () => setReloadNonce((value) => value + 1),
      updatePendingWork,
    );
    refreshCoordinatorRef.current = refreshCoordinator;
    const unsubscribeWorkspace = window.exo.workspace.onDidChange((event) => {
      if (shouldRefreshGraphForWorkspaceChange(event)) refreshCoordinator.workspaceChanged();
    });
    let worker: Worker | null = null;
    try {
      worker = new Worker(new URL("../workers/graphLayout.worker.ts", import.meta.url), { type: "module" });
      workerRef.current = worker;
      worker.onmessage = ({ data }: MessageEvent<GraphLayoutWorkerResponse>) => {
        if (data.generation !== activeGenerationRef.current) {
          runtime.rejectLayoutMessage();
          return;
        }
        if (data.type === "error") {
          layoutPendingRef.current = false;
          updatePendingWork();
          setError(data.message);
          return;
        }
        const accepted = runtime.applyLayoutFrame(data.frame);
        layoutPendingRef.current = accepted && !data.frame.settled;
        updatePendingWork();
        if (!accepted) setError("Graph layout returned an invalid frame.");
      };
      worker.onerror = (event) => {
        layoutPendingRef.current = false;
        updatePendingWork();
        setError(event.message || "Graph layout worker failed.");
      };
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Graph layout worker could not start.");
    }
    const resize = () => {
      const rect = canvas.getBoundingClientRect();
      runtime.resize(
        { width: Math.max(1, Math.round(rect.width)), height: Math.max(1, Math.round(rect.height)) },
        window.devicePixelRatio || 1,
      );
    };
    const resizeObserver = new ResizeObserver(resize);
    resizeObserver.observe(canvas);
    const themeObserver = new MutationObserver(() => runtime.setPalette(resolveGraphPalette(canvas)));
    themeObserver.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme", "data-appearance-mode"] });
    setRuntimeVersion((value) => value + 1);
    return () => {
      const generation = ++generationRef.current;
      worker?.postMessage({ type: "dispose", generation } satisfies GraphLayoutWorkerRequest);
      worker?.terminate();
      workerRef.current = null;
      resizeObserver.disconnect();
      themeObserver.disconnect();
      unsubscribeWorkspace();
      refreshCoordinator.dispose();
      refreshCoordinatorRef.current = null;
      runtime.dispose();
      runtimeRef.current = null;
      delete canvas.__exoGraphSnapshot;
      delete canvas.__exoGraphPointForIndex;
      delete canvas.__exoGraphPickAt;
      delete canvas.__exoGraphForceCanvasFallback;
    };
  }, [rendererNonce, updatePendingWork]);

  useEffect(() => {
    const runtime = runtimeRef.current;
    if (!runtime) return;
    const request = ++loadSequenceRef.current;
    topologyPendingRef.current = true;
    updatePendingWork();
    setLoading(topologyRef.current === null);
    setError(null);
    void window.exo.notes.getGraphTopology(PROFILE_ID).then((next) => {
      if (request !== loadSequenceRef.current || runtimeRef.current !== runtime) return;
      const previous = topologyRef.current;
      if (previous?.sourceSnapshotId !== next.sourceSnapshotId) {
        setSelectedDetail(null);
        setDetailStatus(null);
      }
      pruneGraphSnapshotCache(summaryCacheRef.current, next.sourceSnapshotId);
      pruneGraphSnapshotCache(detailCacheRef.current, next.sourceSnapshotId);
      pruneGraphSnapshotCache(lookupCacheRef.current, next.sourceSnapshotId);
      topologyRef.current = next;
      setTopology(next);
      refreshCoordinatorRef.current?.observeSnapshot(next.sourceSnapshotId);
      const rect = canvasRef.current?.getBoundingClientRect();
      const viewport = { width: Math.max(1, Math.round(rect?.width ?? 1)), height: Math.max(1, Math.round(rect?.height ?? 1)) };
      const scene = runtime.setTopology(next, viewport);
      setRouteNodeCount(scene.interaction.pathNodes.reduce((count, value) => count + Number(value > 0), 0));
      const cachedSummaries = [...summaryCacheRef.current.entries()]
        .filter(([key]) => key.startsWith(`${next.sourceSnapshotId}:`))
        .map(([, summary]) => summary);
      runtime.replaceSummaries(new Map(cachedSummaries.map((summary) => [summary.index, summary])));
      void readSummaries(initialGraphSummaryIndexes(next, scene.interaction.selected), next.sourceSnapshotId);
      const sameLayoutEpoch = previous?.topologyHash === next.topologyHash && previous.layoutEpochId === next.layoutEpochId;
      if ((!sameLayoutEpoch || !scene.layout.settled) && workerRef.current) {
        const generation = ++generationRef.current;
        activeGenerationRef.current = generation;
        layoutPendingRef.current = true;
        workerRef.current.postMessage({
          type: "init",
          generation,
          input: createGraphLayoutInput(next, scene.layout),
        } satisfies GraphLayoutWorkerRequest);
      }
      setLoading(false);
    }).catch((reason) => {
      if (request !== loadSequenceRef.current) return;
      setError(reason instanceof Error ? reason.message : String(reason));
      setLoading(false);
      layoutPendingRef.current = false;
    }).finally(() => {
      if (request !== loadSequenceRef.current) return;
      topologyPendingRef.current = false;
      updatePendingWork();
    });
    return () => { loadSequenceRef.current += 1; };
  }, [readSummaries, refreshKey, reloadNonce, runtimeVersion, updatePendingWork]);

  useEffect(() => {
    const currentTopology = topologyRef.current;
    if (!inspectedConcept || !currentTopology) return;
    const sequence = ++inspectionSequenceRef.current;
    let cancelled = false;
    void resolveConcept(inspectedConcept, currentTopology.sourceSnapshotId).then(async (summary) => {
      if (cancelled || !summary || topologyRef.current?.sourceSnapshotId !== currentTopology.sourceSnapshotId) return;
      runtimeRef.current?.setSelection(summary.index);
      setRouteNodeCount(0);
      const detail = await readDetail(summary.index, currentTopology.sourceSnapshotId);
      if (cancelled || sequence !== inspectionSequenceRef.current || !detail
        || topologyRef.current?.sourceSnapshotId !== currentTopology.sourceSnapshotId) return;
      setSelectedDetail(detail);
      setDetailStatus(null);
    });
    return () => {
      cancelled = true;
      inspectionSequenceRef.current += 1;
    };
  }, [inspectedConcept?.conceptId, inspectedConcept?.filePath, readDetail, resolveConcept, topology?.sourceSnapshotId]);

  useEffect(() => {
    const currentTopology = topologyRef.current;
    if (!focusRequest || !currentTopology) return;
    let cancelled = false;
    void resolveConcept(focusRequest.concept, currentTopology.sourceSnapshotId).then((summary) => {
      if (cancelled || !summary || topologyRef.current?.sourceSnapshotId !== currentTopology.sourceSnapshotId) return;
      runtimeRef.current?.setSelection(summary.index);
      setRouteNodeCount(0);
      runtimeRef.current?.focus(summary.index, prefersReducedMotion());
    });
    return () => { cancelled = true; };
  }, [focusRequest?.sequence, resolveConcept, topology?.sourceSnapshotId]);

  const pickAt = useCallback((clientX: number, clientY: number, pointerType = "mouse") => {
    const canvas = canvasRef.current;
    const scene = runtimeRef.current?.getScene();
    if (!canvas || !scene) return -1;
    const rect = canvas.getBoundingClientRect();
    return pickGraphSceneNode(
      scene.topology,
      scene.projection,
      scene.camera,
      clientX - rect.left,
      clientY - rect.top,
      { pointer: pointerType === "touch" || pointerType === "pen" ? "coarse" : "fine" },
    );
  }, []);

  function onPointerDown(event: ReactPointerEvent<HTMLCanvasElement>) {
    if (pointerSessionRef.current.activePointers === 0) runtimeRef.current?.cancelMotion();
    pointerSessionRef.current.begin(pointerSample(event), event.shiftKey || event.button === 1 || event.button === 2);
    event.currentTarget.setPointerCapture(event.pointerId);
  }

  function onPointerMove(event: ReactPointerEvent<HTMLCanvasElement>) {
    const move = pointerSessionRef.current.move(pointerSample(event));
    if (move.kind === "hover") runtimeRef.current?.setHovered(pickAt(move.sample.x, move.sample.y, move.sample.pointerType));
    if (move.kind === "orbit") runtimeRef.current?.orbit(move.deltaX, move.deltaY);
    if (move.kind === "pan") runtimeRef.current?.pan(move.deltaX, move.deltaY);
    if (move.kind !== "pinch-pan") return;
    const canvas = canvasRef.current;
    const rect = canvas?.getBoundingClientRect();
    const runtime = runtimeRef.current;
    const scene = runtime?.getScene();
    if (!runtime || !scene || !rect) return;
    const zoomed = zoomGraphCameraAt(scene.camera, scene.projection.viewport, move.centerX - rect.left, move.centerY - rect.top, move.scale);
    runtime.setCamera(panGraphCamera(zoomed, move.panX, move.panY, scene.projection.viewport), "pinch-pan");
  }

  function onPointerUp(event: ReactPointerEvent<HTMLCanvasElement>) {
    const ended = pointerSessionRef.current.end(event.pointerId);
    releasePointer(event);
    if (!ended.click || !ended.sample) return;
    const picked = pickAt(event.clientX, event.clientY, ended.sample.pointerType);
    if (picked >= 0) recentPickRef.current = { index: picked, clientX: event.clientX, clientY: event.clientY, at: performance.now() };
    const scene = runtimeRef.current?.getScene();
    const decision = graphNodeClickDecision(picked, scene?.interaction.selected ?? -1, event.shiftKey);
    if (decision.kind === "clear-route") {
      runtimeRef.current?.clearRoute();
      setRouteNodeCount(0);
    }
    if (decision.kind === "route") {
      runtimeRef.current?.setSelection(scene?.interaction.selected ?? -1, decision.index);
      setRouteNodeCount(runtimeRef.current?.getScene()?.interaction.pathNodes.reduce((count, value) => count + Number(value > 0), 0) ?? 0);
      void readSummaries([decision.index], topologyRef.current?.sourceSnapshotId ?? "");
    }
    if (decision.kind === "inspect") void inspectIndex(decision.index, true);
  }

  function onPointerCancel(event: ReactPointerEvent<HTMLCanvasElement>) {
    pointerSessionRef.current.cancel(event.pointerId);
    releasePointer(event);
  }

  function onDoubleClick(event: ReactPointerEvent<HTMLCanvasElement>) {
    let picked = pickAt(event.clientX, event.clientY, event.pointerType);
    const recent = recentPickRef.current;
    if (picked < 0 && recent && performance.now() - recent.at <= 650
      && Math.hypot(event.clientX - recent.clientX, event.clientY - recent.clientY) <= 7) picked = recent.index;
    recentPickRef.current = null;
    if (picked < 0) return;
    void openIndex(picked);
  }

  async function openIndex(index: number) {
    const currentTopology = topologyRef.current;
    if (!currentTopology) return;
    const detail = await readDetail(index, currentTopology.sourceSnapshotId);
    if (!detail || topologyRef.current?.sourceSnapshotId !== currentTopology.sourceSnapshotId) return;
    const concept = { conceptId: detail.concept.id, filePath: detail.concept.filePath };
    onInspectConcept(concept);
    const target = detail.concept.filePath ?? null;
    const decision = graphNodeDoubleClickDecision(target, Boolean(target && isTargetOpen(target)));
    if (decision === "focus" && target) {
      runtimeRef.current?.focus(index, prefersReducedMotion());
      onFocusConcept(concept);
      onActivateOpenTarget(target);
    }
    if (decision === "open" && target) onOpenTarget(target);
  }

  function onWheel(event: ReactWheelEvent<HTMLCanvasElement>) {
    event.preventDefault();
    const canvas = canvasRef.current;
    const scene = runtimeRef.current?.getScene();
    if (!canvas || !scene) return;
    const rect = canvas.getBoundingClientRect();
    const intent = spatialGraphWheelIntent({
      ctrlKey: event.ctrlKey,
      deltaMode: event.deltaMode,
      deltaX: event.deltaX,
      deltaY: event.deltaY,
      viewportHeight: scene.projection.viewport.height,
    });
    if (intent.kind === "pan") runtimeRef.current?.pan(intent.deltaX, intent.deltaY);
    else runtimeRef.current?.zoomAt(event.clientX - rect.left, event.clientY - rect.top, intent.scale);
  }

  return (
    <div className="spatial-graph" data-testid="spatial-graph">
      <div className="spatial-graph__toolbar">
        <span className="spatial-graph__count">{topology?.nodeCount ?? 0} · {topology?.edgeCount ?? 0}</span>
        {routeNodeCount > 0 ? <span data-testid="graph-route-status">Route · {routeNodeCount}</span> : null}
        <button aria-label="Frame graph" onClick={() => runtimeRef.current?.frameAll()} title="Frame graph" type="button"><Scan size={14} /></button>
        <button aria-label="Refresh graph" onClick={() => setReloadNonce((value) => value + 1)} title="Refresh graph" type="button"><RefreshCw size={14} /></button>
      </div>
      <div className="spatial-graph__viewport">
        <canvas
          ref={webGpuCanvasRef}
          aria-hidden="true"
          className="spatial-graph__pixels"
        />
        <canvas
          ref={canvasRef}
          aria-label="Interactive knowledge graph"
          className="spatial-graph__interaction"
          onContextMenu={(event) => event.preventDefault()}
          onDoubleClick={onDoubleClick}
          onKeyDown={(event) => {
            const runtime = runtimeRef.current;
            const scene = runtime?.getScene();
            if (!runtime || !scene) return;
            if (event.key === "Escape") {
              event.preventDefault();
              if (runtime.snapshot().moving) {
                runtime.cancelMotion();
                return;
              }
              const decision = graphEscapeDecision(scene.interaction.pathTarget >= 0, activeEditorPath, inspectedConcept?.filePath);
              if (decision === "clear-route") {
                runtime.clearRoute();
                setRouteNodeCount(0);
              }
              else if (decision === "restore-editor" && activeEditorPath) onRestoreEditorConcept(activeEditorPath);
              else {
                runtime.setSelection(-1);
                setRouteNodeCount(0);
              }
              return;
            }
            if (event.key === " ") {
              event.preventDefault();
              return;
            }
            const intent = graphKeyboardIntent(scene.camera, event.key, scene.projection.viewport, event.shiftKey);
            if (intent.kind !== "none") event.preventDefault();
            if (intent.kind === "camera") runtime.setCamera(intent.camera, "keyboard");
            if (intent.kind === "frame") runtime.frameAll();
            if (intent.kind === "focus" && scene.interaction.selected >= 0) runtime.focus(scene.interaction.selected, prefersReducedMotion());
          }}
          onLostPointerCapture={onPointerCancel}
          onPointerCancel={onPointerCancel}
          onPointerDown={onPointerDown}
          onPointerLeave={() => pointerSessionRef.current.activePointers === 0 && runtimeRef.current?.setHovered(-1)}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onWheel={onWheel}
          tabIndex={0}
        />
        {loading ? <div className="spatial-graph__state">Building graph…</div> : null}
        {error ? (
          <button
            className="spatial-graph__state spatial-graph__state--error"
            onClick={() => { setError(null); setRendererNonce((value) => value + 1); }}
            type="button"
          >Graph unavailable · retry</button>
        ) : null}
      </div>
      <GraphConceptDetailPanel
        detail={selectedDetail}
        detailStatus={detailStatus}
        degree={runtimeRef.current?.getScene()?.interaction.selected ?? -1}
        topology={topology}
        onOpenTarget={onOpenTarget}
      />
    </div>
  );
}

function GraphConceptDetailPanel({
  detail,
  detailStatus,
  degree,
  topology,
  onOpenTarget,
}: {
  detail: BoundedGraphConceptDetail | null;
  detailStatus: string | null;
  degree: number;
  topology: GraphTopology | null;
  onOpenTarget: (target: string) => void;
}) {
  if (!detail) {
    return <div className="spatial-graph__hint">{detailStatus ?? "Drag to orbit · shift-drag or two fingers to pan · pinch or scroll to zoom"}</div>;
  }
  const concept = detail.concept;
  const properties = detail.properties.filter(({ key }) => !["title", "tags", "type"].includes(key)).slice(0, 4);
  return (
    <div className="spatial-graph__detail">
      <button className="spatial-graph__detail-title" disabled={!concept.filePath} onClick={() => concept.filePath && onOpenTarget(concept.filePath)} type="button">{concept.label}</button>
      <div className="spatial-graph__detail-meta">
        <span>{concept.conceptTypes.join(" · ") || "Note"}</span>
        <span>{degree >= 0 ? topology?.nodes.degrees[degree] ?? 0 : 0} links</span>
      </div>
      {concept.relativePath ? <div className="spatial-graph__path">{concept.relativePath}</div> : null}
      {properties.length ? <div className="spatial-graph__detail-properties">{properties.map(({ key, value }) => <span key={key}><b>{key}</b>{compactValue(value)}</span>)}</div> : null}
      {detail.findings.length ? <div className="spatial-graph__finding">{detail.findings[0]?.message}</div> : null}
      {detailStatus ? <div className="spatial-graph__finding">{detailStatus}</div> : null}
    </div>
  );
}

function cacheKey(sourceSnapshotId: string, index: number): string {
  return `${sourceSnapshotId}:${index}`;
}

function lookupReference(concept: InspectedConcept): GraphConceptLookupReference | null {
  if (concept.conceptId) return { conceptId: concept.conceptId };
  if (concept.filePath) return { filePath: concept.filePath };
  return null;
}

function lookupKey(sourceSnapshotId: string, reference: GraphConceptLookupReference): string {
  return "conceptId" in reference
    ? `${sourceSnapshotId}:id:${reference.conceptId}`
    : `${sourceSnapshotId}:path:${reference.filePath}`;
}

function releasePointer(event: ReactPointerEvent<HTMLCanvasElement>): void {
  if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
}

function pointerSample(event: ReactPointerEvent<HTMLCanvasElement>) {
  return { pointerId: event.pointerId, x: event.clientX, y: event.clientY, pointerType: event.pointerType };
}

function prefersReducedMotion(): boolean {
  return window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;
}

function compactValue(value: unknown): string {
  const rendered = typeof value === "string" ? value : JSON.stringify(value);
  return rendered.length > 42 ? `${rendered.slice(0, 39)}…` : rendered;
}
