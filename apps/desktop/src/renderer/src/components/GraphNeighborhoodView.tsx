import { Expand } from "lucide-react";
import { useEffect, useRef } from "react";

import type { RendererGraphNeighborhood } from "../graphAffordances";
import { GraphCanvasRenderer, type GraphCanvasSurface } from "../graphCanvasRenderer";
import { resolveGraphPalette } from "../graphPalette";
import {
  compileGraphNeighborhoodPresentation,
  projectGraphNeighborhoodTopology,
} from "../graphNeighborhoodPresentation";
import { GraphPresentationCompiler } from "../graphPresentation";

interface GraphNeighborhoodViewProps {
  neighborhood: RendererGraphNeighborhood | null;
  onOpenTarget: (target: string) => void;
  onOpenExternal: (target: string) => void;
  onOpenCanvas?: (focusPath: string) => void;
}

export function GraphNeighborhoodView(props: GraphNeighborhoodViewProps) {
  const { neighborhood, onOpenTarget, onOpenExternal, onOpenCanvas } = props;
  const projected = neighborhood ? projectGraphNeighborhoodTopology(neighborhood) : null;
  const nodes = projected?.nodes ?? [];

  if (!neighborhood || nodes.length <= 1) {
    return <div className="footer-empty">No neighborhood yet</div>;
  }

  const visibleNodes = nodes;
  const visibleEdges = projected?.edges ?? [];

  return (
    <section className="graph-neighborhood" data-testid="graph-neighborhood-panel">
      <div className="connections-panel__section-title">Neighborhood</div>
      <GraphNeighborhoodCanvas neighborhood={neighborhood} visibleLabels={visibleNodes.map((node) => node.label)} />
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

function GraphNeighborhoodCanvas(props: {
  neighborhood: RendererGraphNeighborhood;
  visibleLabels: readonly string[];
}) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const renderer = new GraphCanvasRenderer(canvas as unknown as GraphCanvasSurface);
    const compiler = new GraphPresentationCompiler();
    const draw = () => {
      const bounds = canvas.getBoundingClientRect();
      const viewport = {
        width: Math.max(1, Math.round(bounds.width || 240)),
        height: Math.max(1, Math.round(bounds.height || 156)),
      };
      renderer.resize({ ...viewport, dpr: window.devicePixelRatio || 1 });
      const compiled = compileGraphNeighborhoodPresentation(
        props.neighborhood,
        viewport,
        resolveGraphPalette(canvas),
        compiler,
      );
      renderer.render(compiled.plan);
    };
    const resizeObserver = new ResizeObserver(draw);
    resizeObserver.observe(canvas);
    const themeObserver = new MutationObserver(draw);
    themeObserver.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["data-theme", "data-appearance-mode"],
    });
    draw();
    return () => {
      resizeObserver.disconnect();
      themeObserver.disconnect();
      renderer.destroy();
    };
  }, [props.neighborhood]);

  return (
    <div className="graph-neighborhood__map">
      <canvas
        ref={canvasRef}
        aria-label={`Local graph neighborhood: ${props.visibleLabels.join(", ")}`}
        data-testid="graph-neighborhood-canvas"
        role="img"
      >
        Local graph neighborhood for {props.visibleLabels.join(", ")}
      </canvas>
    </div>
  );
}
