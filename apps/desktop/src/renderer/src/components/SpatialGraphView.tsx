import { RefreshCw, Scan } from "lucide-react";
import { useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent, type WheelEvent } from "react";
import type { GraphConceptDetail, GraphViewBundle, GraphViewProjection } from "@exo/core";

import {
  graphEscapeDecision,
  graphNodeClickDecision,
  graphNodeDoubleClickDecision,
} from "../graphInteraction";
import {
  DEFAULT_GRAPH_CAMERA,
  frameGraphCamera,
  focusGraphNodeCamera,
  graphNeighbors,
  pickGraphNode,
  projectGraphPositions,
  seededGraphPositions,
  shortestGraphPath,
  type GraphCamera,
  type ProjectedGraphNode,
} from "../graphScene";
import {
  graphNodeIndexForConcept,
  type GraphFocusRequest,
  type InspectedConcept,
} from "../hooks/useInspectedConcept";

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

interface PointerGesture {
  pointerId: number;
  x: number;
  y: number;
  yaw: number;
  pitch: number;
  target: [number, number, number];
  pan: boolean;
  moved: boolean;
}

interface RecentGraphPick {
  concept: InspectedConcept;
  clientX: number;
  clientY: number;
  at: number;
}

const PALETTE = ["#3f7d72", "#bf6840", "#78699c", "#8a7b4e", "#52779c", "#9b5f6c", "#65825b", "#8d684c"];

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
  const gestureRef = useRef<PointerGesture | null>(null);
  const recentPickRef = useRef<RecentGraphPick | null>(null);
  const bundleRef = useRef<GraphViewBundle | null>(null);
  const profileId = "generic-markdown" as const;
  const [bundle, setBundle] = useState<GraphViewBundle | null>(null);
  const [positions, setPositions] = useState<Float32Array>(new Float32Array());
  const [camera, setCamera] = useState<GraphCamera>({ ...DEFAULT_GRAPH_CAMERA, target: [...DEFAULT_GRAPH_CAMERA.target] });
  const [selectedDetail, setSelectedDetail] = useState<GraphConceptDetail | null>(null);
  const [pathTarget, setPathTarget] = useState(-1);
  const [size, setSize] = useState({ width: 1, height: 1 });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [reloadNonce, setReloadNonce] = useState(0);
  const projection = bundle?.projection ?? null;
  const selected = useMemo(
    () => graphNodeIndexForConcept(projection, inspectedConcept),
    [inspectedConcept, projection],
  );

  useEffect(() => {
    bundleRef.current = bundle;
  }, [bundle]);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    void window.exo.notes.getGraphView(profileId).then((next) => {
      if (cancelled) return;
      const preserveScene = shouldPreserveGraphScene(
        bundleRef.current?.projection.sourceSnapshotId ?? null,
        next.projection.sourceSnapshotId,
        positions.length,
        next.projection.nodes.length,
      );
      bundleRef.current = next;
      setBundle(next);
      if (!preserveScene) {
        const seeded = seededGraphPositions(next.projection);
        setPositions(seeded);
        setCamera(frameGraphCamera(seeded));
        setSelectedDetail(null);
        setPathTarget(-1);
      }
      setLoading(false);
    }).catch((reason) => {
      if (cancelled) return;
      setError(reason instanceof Error ? reason.message : String(reason));
      setLoading(false);
    });
    return () => { cancelled = true; };
  }, [profileId, refreshKey, reloadNonce]);

  useEffect(() => {
    if (!bundle || bundle.projection.nodes.length === 0) return;
    const worker = new Worker(new URL("../workers/graphLayout.worker.ts", import.meta.url), { type: "module" });
    worker.onmessage = (event: MessageEvent<{ positions: Float32Array }>) => {
      const next = event.data.positions;
      if (!(next instanceof Float32Array)) return;
      setPositions(next);
    };
    worker.postMessage({ projection: bundle.projection });
    return () => worker.terminate();
  }, [bundle?.projection.sourceSnapshotId]);

  useEffect(() => {
    if (!focusRequest || !projection || positions.length === 0) return;
    const index = graphNodeIndexForConcept(projection, focusRequest.concept);
    if (index < 0) return;
    setPathTarget(-1);
    setCamera(focusGraphNodeCamera(positions, index));
  }, [focusRequest?.sequence, positions, projection]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const observer = new ResizeObserver(([entry]) => {
      const width = Math.max(1, Math.round(entry.contentRect.width));
      const height = Math.max(1, Math.round(entry.contentRect.height));
      setSize({ width, height });
    });
    observer.observe(canvas);
    return () => observer.disconnect();
  }, []);

  const path = useMemo(
    () => projection
      ? shortestGraphPath(projection, selected, pathTarget)
      : { status: "idle" as const, nodes: new Set<number>(), edgeIds: new Set<string>() },
    [projection, selected, pathTarget],
  );
  const neighbors = useMemo(
    () => projection && selected >= 0 ? graphNeighbors(projection, selected) : new Set<number>(),
    [projection, selected],
  );
  const projected = useMemo(
    () => projectGraphPositions(positions, camera, size.width, size.height),
    [positions, camera, size],
  );

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !projection) return;
    const frame = requestAnimationFrame(() => drawGraph(canvas, projection, projected, selected, pathTarget, path.nodes, path.edgeIds, neighbors));
    return () => cancelAnimationFrame(frame);
  }, [projection, projected, selected, pathTarget, path, neighbors]);

  useEffect(() => {
    const conceptId = selected >= 0 ? projection?.nodes[selected]?.id : null;
    const sourceSnapshotId = projection?.sourceSnapshotId;
    if (!conceptId || !sourceSnapshotId) {
      setSelectedDetail(null);
      return;
    }
    let cancelled = false;
    setSelectedDetail(null);
    void window.exo.notes.getGraphConceptDetail(conceptId, sourceSnapshotId, profileId).then((detail) => {
      if (!cancelled) setSelectedDetail(detail);
    }).catch(() => {
      if (!cancelled) setSelectedDetail(null);
    });
    return () => { cancelled = true; };
  }, [profileId, projection, selected]);

  function onPointerDown(event: ReactPointerEvent<HTMLCanvasElement>) {
    event.currentTarget.setPointerCapture(event.pointerId);
    gestureRef.current = {
      pointerId: event.pointerId,
      x: event.clientX,
      y: event.clientY,
      yaw: camera.yaw,
      pitch: camera.pitch,
      target: [...camera.target],
      pan: event.shiftKey || event.button === 1 || event.button === 2,
      moved: false,
    };
  }

  function onPointerMove(event: ReactPointerEvent<HTMLCanvasElement>) {
    const gesture = gestureRef.current;
    if (!gesture || gesture.pointerId !== event.pointerId) return;
    const dx = event.clientX - gesture.x;
    const dy = event.clientY - gesture.y;
    if (Math.hypot(dx, dy) > 3) gesture.moved = true;
    if (!gesture.moved) return;
    if (gesture.pan) {
      const scale = camera.distance / Math.max(320, size.width) * 0.85;
      setCamera((current) => ({ ...current, target: [gesture.target[0] - dx * scale, gesture.target[1] + dy * scale, gesture.target[2]] }));
    } else {
      setCamera((current) => ({
        ...current,
        yaw: gesture.yaw + dx * 0.007,
        pitch: Math.max(-1.35, Math.min(1.35, gesture.pitch + dy * 0.006)),
      }));
    }
  }

  function onPointerUp(event: ReactPointerEvent<HTMLCanvasElement>) {
    const gesture = gestureRef.current;
    gestureRef.current = null;
    if (!gesture || gesture.pointerId !== event.pointerId || gesture.moved) return;
    const rect = event.currentTarget.getBoundingClientRect();
    const picked = pickGraphNode(projected, event.clientX - rect.left, event.clientY - rect.top);
    const recentPick = recentPickRef.current;
    const pickedConcept = conceptForNode(projection, picked);
    if (pickedConcept) {
      recentPickRef.current = { concept: pickedConcept, clientX: event.clientX, clientY: event.clientY, at: performance.now() };
    } else if (!recentPick || performance.now() - recentPick.at > 600 || Math.hypot(event.clientX - recentPick.clientX, event.clientY - recentPick.clientY) > 6) {
      recentPickRef.current = null;
    }
    const decision = graphNodeClickDecision(picked, selected, event.shiftKey);
    if (decision.kind === "clear-route") {
      setPathTarget(-1);
    } else if (decision.kind === "route") {
      setPathTarget(decision.index);
    } else {
      setPathTarget(-1);
      const concept = conceptForNode(projection, decision.index);
      if (concept) onInspectConcept(concept);
    }
  }

  function onDoubleClick(event: ReactPointerEvent<HTMLCanvasElement>) {
    const rect = event.currentTarget.getBoundingClientRect();
    let picked = pickGraphNode(projected, event.clientX - rect.left, event.clientY - rect.top);
    const recentPick = recentPickRef.current;
    if (picked < 0 && recentPick && performance.now() - recentPick.at <= 600 && Math.hypot(event.clientX - recentPick.clientX, event.clientY - recentPick.clientY) <= 6) {
      // Selecting a node reveals its detail row, which can resize the canvas
      // between the two clicks of a double-click. Preserve the physical target
      // of that gesture instead of interpreting the shifted second hit as
      // empty space.
      picked = graphNodeIndexForConcept(projection, recentPick.concept);
    }
    recentPickRef.current = null;
    const concept = conceptForNode(projection, picked);
    const target = concept?.filePath ?? null;
    const decision = graphNodeDoubleClickDecision(target, Boolean(target && isTargetOpen(target)));
    if (concept) onInspectConcept(concept);
    if (decision === "focus" && concept && target) {
      onFocusConcept(concept);
      onActivateOpenTarget(target);
    }
    if (decision === "open" && target) onOpenTarget(target);
    // Empty-space double click is intentionally inert. Resetting the camera
    // here made a navigation gesture destructive and diverged from the canvas.
  }

  function onWheel(event: WheelEvent<HTMLCanvasElement>) {
    event.preventDefault();
    const delta = event.deltaMode === 1 ? event.deltaY * 16 : event.deltaY;
    setCamera((current) => ({ ...current, distance: Math.max(48, Math.min(8_000, current.distance * Math.exp(delta * 0.0024))) }));
  }

  return (
    <div className="spatial-graph" data-testid="spatial-graph">
      <div className="spatial-graph__toolbar">
        <span className="spatial-graph__phase">Experimental</span>
        <span className="spatial-graph__count">{projection?.nodes.length ?? 0} · {projection?.edges.length ?? 0}</span>
        <button aria-label="Frame graph" onClick={() => setCamera(frameGraphCamera(positions))} title="Frame graph" type="button"><Scan size={14} /></button>
        <button aria-label="Refresh graph" onClick={() => setReloadNonce((value) => value + 1)} title="Refresh graph" type="button"><RefreshCw size={14} /></button>
      </div>
      <div className="spatial-graph__viewport">
        <canvas
          ref={canvasRef}
          aria-label="Interactive knowledge graph"
          onContextMenu={(event) => event.preventDefault()}
          onDoubleClick={onDoubleClick}
          onKeyDown={(event) => {
            if (event.key === "Escape") {
              const decision = graphEscapeDecision(pathTarget >= 0, activeEditorPath, inspectedConcept?.filePath);
              if (decision === "clear-route") setPathTarget(-1);
              if (decision === "restore-editor" && activeEditorPath) onRestoreEditorConcept(activeEditorPath);
            }
            if (event.key === "+" || event.key === "=") setCamera((value) => ({ ...value, distance: value.distance * 0.86 }));
            if (event.key === "-") setCamera((value) => ({ ...value, distance: value.distance * 1.16 }));
          }}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onWheel={onWheel}
          tabIndex={0}
        />
        {loading ? <div className="spatial-graph__state">Building graph…</div> : null}
        {error ? <button className="spatial-graph__state spatial-graph__state--error" onClick={() => setReloadNonce((value) => value + 1)} type="button">Graph unavailable · retry</button> : null}
      </div>
      <GraphConceptDetailPanel detail={selectedDetail} projection={projection} selected={selected} onOpenTarget={onOpenTarget} />
    </div>
  );
}

function conceptForNode(projection: GraphViewProjection | null, index: number): InspectedConcept | null {
  const node = index >= 0 ? projection?.nodes[index] : null;
  if (!node) return null;
  return {
    conceptId: node.id,
    filePath: node.path || undefined,
  };
}

export function shouldPreserveGraphScene(
  previousSnapshotId: string | null,
  nextSnapshotId: string,
  positionCount: number,
  nodeCount: number,
): boolean {
  return previousSnapshotId === nextSnapshotId && positionCount === nodeCount * 3;
}

function GraphConceptDetailPanel({
  detail,
  projection,
  selected,
  onOpenTarget,
}: {
  detail: GraphConceptDetail | null;
  projection: GraphViewProjection | null;
  selected: number;
  onOpenTarget: (target: string) => void;
}) {
  const concept = detail?.concept ?? null;
  if (!concept) return <div className="spatial-graph__hint">Drag to orbit · shift-drag to pan · scroll to zoom</div>;
  const properties = Object.entries(concept.properties).filter(([key]) => !["title", "tags", "type"].includes(key)).slice(0, 4);
  return (
    <div className="spatial-graph__detail">
      <button className="spatial-graph__detail-title" disabled={!concept.filePath} onClick={() => concept.filePath && onOpenTarget(concept.filePath)} type="button">{concept.label}</button>
      <div className="spatial-graph__detail-meta">
        <span>{concept.conceptTypes.join(" · ") || "Note"}</span>
        <span>{projection?.nodes[selected]?.degree ?? 0} links</span>
      </div>
      {concept.relativePath ? <div className="spatial-graph__path">{concept.relativePath}</div> : null}
      {properties.length ? <div className="spatial-graph__detail-properties">{properties.map(([key, value]) => <span key={key}><b>{key}</b>{compactValue(value)}</span>)}</div> : null}
      {detail?.findings.length ? <div className="spatial-graph__finding">{detail.findings[0]?.message}</div> : null}
    </div>
  );
}

function drawGraph(
  canvas: HTMLCanvasElement,
  projection: GraphViewProjection,
  nodes: readonly ProjectedGraphNode[],
  selected: number,
  pathTarget: number,
  pathNodes: Set<number>,
  pathEdgeIds: Set<string>,
  neighbors: Set<number>,
) {
  const rect = canvas.getBoundingClientRect();
  const dpr = Math.min(2.5, window.devicePixelRatio || 1);
  const width = Math.max(1, Math.round(rect.width));
  const height = Math.max(1, Math.round(rect.height));
  if (canvas.width !== Math.round(width * dpr) || canvas.height !== Math.round(height * dpr)) {
    canvas.width = Math.round(width * dpr);
    canvas.height = Math.round(height * dpr);
  }
  const context = canvas.getContext("2d", { alpha: true, desynchronized: true });
  if (!context) return;
  const styles = getComputedStyle(canvas);
  const text = styles.getPropertyValue("--text").trim() || "#dcdcdc";
  const muted = styles.getPropertyValue("--muted").trim() || "#a6a6a6";
  const accent = styles.getPropertyValue("--accent").trim() || "#6ca8d8";
  context.setTransform(dpr, 0, 0, dpr, 0, 0);
  context.clearRect(0, 0, width, height);
  context.lineCap = "round";

  for (const edge of projection.edges) {
    const source = nodes[edge.source];
    const target = nodes[edge.target];
    if (!source?.visible || !target?.visible) continue;
    const pathEdge = pathEdgeIds.has(edge.id);
    const focused = edge.source === selected || edge.target === selected;
    context.beginPath();
    context.moveTo(source.x, source.y);
    const bend = ((edge.source * 17 + edge.target * 29) % 9 - 4) * 0.8;
    const mx = (source.x + target.x) * 0.5 + (source.y - target.y) * bend * 0.02;
    const my = (source.y + target.y) * 0.5 + (target.x - source.x) * bend * 0.02;
    context.quadraticCurveTo(mx, my, target.x, target.y);
    context.strokeStyle = pathEdge ? accent : edge.authority === "derived" ? muted : text;
    context.globalAlpha = pathEdge ? 0.94 : focused ? 0.46 : selected >= 0 ? 0.035 : 0.045;
    context.lineWidth = pathEdge ? 2 : focused ? 1.25 : 0.65;
    context.stroke();
  }

  const ordered = [...nodes].filter((node) => node.visible).sort((left, right) => right.depth - left.depth);
  for (const node of ordered) {
    const source = projection.nodes[node.index];
    const focused = node.index === selected || node.index === pathTarget || pathNodes.has(node.index) || neighbors.has(node.index);
    const radius = Math.max(2.4, Math.min(8.2, (2.7 + Math.sqrt(Math.max(1, source.degree)) * 0.48) * Math.max(0.78, node.scale)));
    context.beginPath();
    context.arc(node.x, node.y, radius, 0, Math.PI * 2);
    context.fillStyle = node.index === selected || node.index === pathTarget ? accent : PALETTE[groupColor(source.group)];
    context.globalAlpha = selected < 0 ? 0.78 : focused ? 0.98 : 0.17;
    context.fill();
    if (node.index === selected || node.index === pathTarget) {
      context.globalAlpha = 0.34;
      context.lineWidth = 4;
      context.strokeStyle = accent;
      context.stroke();
    }
  }
  context.globalAlpha = 1;
  drawLabels(context, projection, nodes, selected, pathTarget, pathNodes, neighbors, text, accent, width, height);
}

function drawLabels(
  context: CanvasRenderingContext2D,
  projection: GraphViewProjection,
  nodes: readonly ProjectedGraphNode[],
  selected: number,
  pathTarget: number,
  pathNodes: Set<number>,
  neighbors: Set<number>,
  text: string,
  accent: string,
  width: number,
  height: number,
) {
  context.font = '500 11px "IBM Plex Mono", monospace';
  context.textBaseline = "middle";
  const candidates = nodes
    .filter((node) => node.visible)
    .sort((left, right) => labelPriority(right.index, projection, selected, pathTarget, pathNodes, neighbors) - labelPriority(left.index, projection, selected, pathTarget, pathNodes, neighbors));
  const occupied: Array<{ left: number; right: number; top: number; bottom: number }> = [];
  const budget = Math.max(6, Math.min(18, Math.floor(width * height / 16_000)));
  let shown = 0;
  for (const node of candidates) {
    if (shown >= budget) break;
    const priority = labelPriority(node.index, projection, selected, pathTarget, pathNodes, neighbors);
    if (priority < 20 && shown >= Math.max(4, budget / 2)) continue;
    const label = projection.nodes[node.index].label;
    const labelWidth = Math.min(180, context.measureText(label).width);
    const box = { left: node.x + 8, right: node.x + 14 + labelWidth, top: node.y - 8, bottom: node.y + 8 };
    if (box.left < 2 || box.right > width - 2 || box.top < 2 || box.bottom > height - 2) continue;
    if (occupied.some((other) => boxesOverlap(box, other))) continue;
    occupied.push(box);
    context.fillStyle = node.index === selected || node.index === pathTarget ? accent : text;
    context.globalAlpha = priority >= 80 ? 1 : 0.78;
    context.fillText(label, box.left, node.y, 180);
    shown += 1;
  }
  context.globalAlpha = 1;
}

function labelPriority(index: number, projection: GraphViewProjection, selected: number, pathTarget: number, path: Set<number>, neighbors: Set<number>): number {
  if (index === selected || index === pathTarget) return 100;
  if (path.has(index)) return 80;
  if (neighbors.has(index)) return 60;
  return Math.min(40, projection.nodes[index].degree * 3);
}

function boxesOverlap(left: { left: number; right: number; top: number; bottom: number }, right: { left: number; right: number; top: number; bottom: number }): boolean {
  return left.left < right.right + 5 && left.right + 5 > right.left && left.top < right.bottom + 3 && left.bottom + 3 > right.top;
}

function groupColor(group: string): number {
  let value = 0;
  for (let index = 0; index < group.length; index += 1) value = (value * 31 + group.charCodeAt(index)) >>> 0;
  return value % PALETTE.length;
}

function compactValue(value: unknown): string {
  const rendered = typeof value === "string" ? value : JSON.stringify(value);
  return rendered.length > 42 ? `${rendered.slice(0, 39)}…` : rendered;
}
