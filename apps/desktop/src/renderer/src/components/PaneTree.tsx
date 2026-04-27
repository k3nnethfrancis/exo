import type { ReactNode } from "react";
import { useRef } from "react";

import type { PaneContent, PaneLeaf, PaneNode, PaneNodeId, PaneTreeActions } from "../hooks/usePaneTree";
import type { DropEdge } from "../hooks/useDragManager";

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

export interface PaneTreeProps {
  node: PaneNode;
  actions: PaneTreeActions;
  focusedLeafId: PaneNodeId;
  renderLeaf: (leaf: PaneLeaf, isFocused: boolean) => ReactNode;
  /** Which leaf+edge is currently hovered during a drag (from DragManager) */
  hoverEdge?: { leafId: string; edge: DropEdge } | null;
}

// ---------------------------------------------------------------------------
// PaneTree — recursive renderer
// ---------------------------------------------------------------------------

export function PaneTree({ node, actions, focusedLeafId, renderLeaf, hoverEdge }: PaneTreeProps) {
  if (node.kind === "leaf") {
    return (
      <PaneLeafContainer
        leaf={node}
        isFocused={node.id === focusedLeafId}
        onFocus={() => actions.focusLeaf(node.id)}
        renderLeaf={renderLeaf}
        hoverEdge={hoverEdge?.leafId === node.id ? hoverEdge.edge : null}
      />
    );
  }

  return (
    <PaneSplitContainer
      node={node}
      actions={actions}
      focusedLeafId={focusedLeafId}
      renderLeaf={renderLeaf}
      hoverEdge={hoverEdge}
    />
  );
}

// ---------------------------------------------------------------------------
// PaneSplitContainer
// ---------------------------------------------------------------------------

function PaneSplitContainer({
  node,
  actions,
  focusedLeafId,
  renderLeaf,
  hoverEdge,
}: {
  node: PaneNode & { kind: "split" };
  actions: PaneTreeActions;
  focusedLeafId: PaneNodeId;
  renderLeaf: (leaf: PaneLeaf, isFocused: boolean) => ReactNode;
  hoverEdge?: { leafId: string; edge: DropEdge } | null;
}) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const isHorizontal = node.direction === "horizontal";

  const gridTemplate = `minmax(0, ${node.ratio}fr) 1px minmax(0, ${1 - node.ratio}fr)`;

  return (
    <div
      ref={containerRef}
      className="pane-split"
      style={{
        display: "grid",
        ...(isHorizontal
          ? { gridTemplateColumns: gridTemplate, gridTemplateRows: "minmax(0, 1fr)" }
          : { gridTemplateRows: gridTemplate, gridTemplateColumns: "minmax(0, 1fr)" }),
        overflow: "hidden",
        minWidth: 0,
        minHeight: 0,
      }}
    >
      <PaneTree
        node={node.children[0]}
        actions={actions}
        focusedLeafId={focusedLeafId}
        renderLeaf={renderLeaf}
        hoverEdge={hoverEdge}
      />
      <PaneSplitResizer
        direction={node.direction}
        onMouseDown={(event) => {
          const container = containerRef.current;
          if (!container) return;
          const rect = container.getBoundingClientRect();
          const containerSize = isHorizontal ? rect.width : rect.height;
          actions.startResize(
            node.id,
            node.direction,
            isHorizontal ? event.clientX : event.clientY,
            containerSize,
          );
        }}
      />
      <PaneTree
        node={node.children[1]}
        actions={actions}
        focusedLeafId={focusedLeafId}
        renderLeaf={renderLeaf}
        hoverEdge={hoverEdge}
      />
    </div>
  );
}

// ---------------------------------------------------------------------------
// PaneSplitResizer
// ---------------------------------------------------------------------------

function PaneSplitResizer({
  direction,
  onMouseDown,
}: {
  direction: "horizontal" | "vertical";
  onMouseDown: (event: React.MouseEvent) => void;
}) {
  return (
    <div
      className={`pane-split-resizer pane-split-resizer--${direction === "horizontal" ? "vertical" : "horizontal"}`}
      onMouseDown={onMouseDown}
    />
  );
}

// ---------------------------------------------------------------------------
// PaneLeafContainer
// ---------------------------------------------------------------------------

function PaneLeafContainer({
  leaf,
  isFocused,
  onFocus,
  renderLeaf,
  hoverEdge,
}: {
  leaf: PaneLeaf;
  isFocused: boolean;
  onFocus: () => void;
  renderLeaf: (leaf: PaneLeaf, isFocused: boolean) => ReactNode;
  hoverEdge: DropEdge | null;
}) {
  return (
    <div
      className={`pane-leaf ${isFocused ? "pane-leaf--focused" : ""} pane-leaf--${leaf.content.kind}`}
      onMouseDown={onFocus}
      data-pane-id={leaf.id}
      data-pane-kind={leaf.content.kind}
    >
      {renderLeaf(leaf, isFocused)}
      {hoverEdge ? (
        <div className="leaf-drop-zones" style={{ pointerEvents: "none" }}>
          <div className={`leaf-drop-zone leaf-drop-zone--${hoverEdge} leaf-drop-zone--active`} />
        </div>
      ) : null}
    </div>
  );
}
