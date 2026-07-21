import { Children, isValidElement, type ReactElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import type { RendererGraphNeighborhood } from "../graphAffordances";
import { GraphNeighborhoodView } from "./GraphNeighborhoodView";

const neighborhood: RendererGraphNeighborhood = {
  focusPath: "/notes/focus.md",
  nodes: [
    { id: "focus", label: "Focus", kind: "note", target: "/notes/focus.md" },
    { id: "source", label: "Source", kind: "note", target: "/notes/source.md" },
  ],
  edges: [
    { id: "backlink", label: "Source", source: "source", target: "focus", kind: "wikilink" },
    { id: "hidden", label: "Missing", source: "focus", target: "unresolved:missing", kind: "wikilink" },
  ],
};

describe("GraphNeighborhoodView", () => {
  it("opens the full graph at the inspected note instead of forwarding the click event", () => {
    const onOpenCanvas = vi.fn();
    const tree = GraphNeighborhoodView({
      neighborhood,
      onOpenCanvas,
      onOpenTarget: vi.fn(),
      onOpenExternal: vi.fn(),
    });
    const button = findElement(tree, (element) => element.props["aria-label"] === "Open full graph");

    expect(button).not.toBeNull();
    button?.props.onClick?.();
    expect(onOpenCanvas).toHaveBeenCalledWith("/notes/focus.md");
  });

  it("reports only edges that are actually drawn in the bounded neighborhood", () => {
    const html = renderToStaticMarkup(
      <GraphNeighborhoodView
        neighborhood={neighborhood}
        onOpenTarget={() => {}}
        onOpenExternal={() => {}}
      />,
    );

    expect(html).toContain("1 edges");
    expect(html).not.toContain("2 edges");
    expect(html).toContain('data-testid="graph-neighborhood-canvas"');
    expect(html).not.toContain("<svg");
  });
});

interface TestElementProps extends Record<string, unknown> {
  children?: ReactNode;
  onClick?: () => void;
  "aria-label"?: string;
}

function findElement(node: ReactNode, predicate: (element: ReactElement<TestElementProps>) => boolean): ReactElement<TestElementProps> | null {
  if (!isValidElement<TestElementProps>(node)) return null;
  if (predicate(node)) return node;
  for (const child of Children.toArray(node.props.children)) {
    const found = findElement(child, predicate);
    if (found) return found;
  }
  return null;
}
