import { Expand } from "lucide-react";

import type { RendererGraphNeighborhood } from "../graphAffordances";

interface GraphNeighborhoodViewProps {
  neighborhood: RendererGraphNeighborhood | null;
  onOpenTarget: (target: string) => void;
  onOpenExternal: (target: string) => void;
  onOpenTag: (tag: string) => void;
  onOpenCanvas?: (focusPath: string) => void;
}

export function GraphNeighborhoodView(props: GraphNeighborhoodViewProps) {
  const { neighborhood, onOpenTarget, onOpenExternal, onOpenCanvas } = props;
  const nodes = neighborhood?.nodes.filter((node) => node.kind !== "note" || node.target) ?? [];

  if (!neighborhood || nodes.length <= 1) {
    return <div className="footer-empty">No neighborhood yet</div>;
  }

  const visibleNodes = nodes.slice(0, 8);
  const visibleNodeIds = new Set(visibleNodes.map((node) => node.id));
  const visibleEdges = neighborhood.edges.filter((edge) => visibleNodeIds.has(edge.source) && visibleNodeIds.has(edge.target));

  return (
    <section className="graph-neighborhood" data-testid="graph-neighborhood-panel">
      <div className="connections-panel__section-title">Neighborhood</div>
      <div className="graph-neighborhood__map" aria-label="Local graph neighborhood">
        <svg viewBox="0 0 240 156" role="img">
          {visibleEdges.map((edge) => {
            const source = visibleNodes.findIndex((node) => node.id === edge.source);
            const target = visibleNodes.findIndex((node) => node.id === edge.target);
            if (source < 0 || target < 0) return null;
            const sourcePoint = localPoint(source, visibleNodes.length);
            const targetPoint = localPoint(target, visibleNodes.length);
            return <line key={edge.id} x1={sourcePoint.x} y1={sourcePoint.y} x2={targetPoint.x} y2={targetPoint.y} className="graph-neighborhood__edge" />;
          })}
          {visibleNodes.map((node, index) => {
            const point = localPoint(index, visibleNodes.length);
            return (
              <g key={node.id} className="graph-neighborhood__point" transform={`translate(${point.x} ${point.y})`}>
                <circle r={index === 0 ? 6 : 4} />
                <text x={index === 0 ? 10 : 8} y="3">{truncateLabel(node.label)}</text>
                <title>{node.label}</title>
              </g>
            );
          })}
        </svg>
      </div>
      <div className="graph-neighborhood__nodes">
        {visibleNodes.map((node) => (
          <button
            key={node.id}
            className={`graph-neighborhood__node graph-neighborhood__node--${node.kind}`}
            onClick={() => node.kind === "external" ? onOpenExternal(node.target) : onOpenTarget(node.target)}
            title={node.label}
            type="button"
          >
            <span className="graph-neighborhood__label">{node.label}</span>
          </button>
        ))}
      </div>
      <div className="graph-neighborhood__footer">
        <span>{visibleEdges.length} edges</span>
        {onOpenCanvas ? (
          <button aria-label="Open full graph" onClick={() => onOpenCanvas(neighborhood.focusPath)} title="Open full graph" type="button">
            <Expand size={13} />
          </button>
        ) : null}
      </div>
    </section>
  );
}

function localPoint(index: number, count: number): { x: number; y: number } {
  if (index === 0) return { x: 120, y: 78 };
  const angle = ((index - 1) / Math.max(1, count - 1)) * Math.PI * 2 - Math.PI / 2;
  return { x: 120 + Math.cos(angle) * 54, y: 78 + Math.sin(angle) * 48 };
}

function truncateLabel(label: string): string {
  return label.length > 18 ? `${label.slice(0, 16)}…` : label;
}
