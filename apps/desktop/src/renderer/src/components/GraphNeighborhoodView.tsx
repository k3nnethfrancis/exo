import type { RendererGraphNeighborhood } from "../graphAffordances";

interface GraphNeighborhoodViewProps {
  neighborhood: RendererGraphNeighborhood | null;
  onOpenTarget: (target: string) => void;
  onOpenExternal: (target: string) => void;
  onOpenTag: (tag: string) => void;
}

export function GraphNeighborhoodView(props: GraphNeighborhoodViewProps) {
  const { neighborhood, onOpenTarget, onOpenExternal, onOpenTag } = props;
  const nodes = neighborhood?.nodes.filter((node) => node.kind !== "note" || node.target) ?? [];

  if (!neighborhood || nodes.length <= 1) {
    return <div className="footer-empty">No neighborhood yet</div>;
  }

  return (
    <div className="graph-neighborhood" data-testid="graph-neighborhood">
      <div className="graph-neighborhood__nodes">
        {nodes.slice(0, 8).map((node) => (
          <button
            key={node.id}
            className={`graph-neighborhood__node graph-neighborhood__node--${node.kind}`}
            onClick={() => {
              if (node.kind === "external") {
                onOpenExternal(node.target);
                return;
              }
              if (node.kind === "tag") {
                onOpenTag(node.target.replace(/^#/, ""));
                return;
              }
              onOpenTarget(node.target);
            }}
            title={node.label}
            type="button"
          >
            <span className="graph-neighborhood__kind">{node.kind}</span>
            <span className="graph-neighborhood__label">{node.label}</span>
          </button>
        ))}
      </div>
      {neighborhood.edges.length ? (
        <div className="graph-neighborhood__meta">{neighborhood.edges.length} edges</div>
      ) : null}
    </div>
  );
}
