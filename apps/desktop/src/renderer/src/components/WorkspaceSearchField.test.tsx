import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

import { WorkspaceSearchField, workspaceSearchKeyAction } from "./WorkspaceSearchField";

describe("WorkspaceSearchField", () => {
  it("renders one accessible workspace search control", () => {
    const markup = renderToStaticMarkup(
      <WorkspaceSearchField query="graph" onChange={() => undefined} onClear={() => undefined} onSubmit={() => undefined} />,
    );

    expect(markup).toContain('aria-label="Search workspace"');
    expect(markup).toContain('value="graph"');
    expect(markup).toContain('aria-label="Clear workspace search"');
  });

  it("keeps the clear control absent when there is no query", () => {
    const markup = renderToStaticMarkup(
      <WorkspaceSearchField query="" onChange={() => undefined} onClear={() => undefined} onSubmit={() => undefined} />,
    );

    expect(markup).not.toContain('aria-label="Clear workspace search"');
  });

  it("maps Enter and Escape to explicit search actions", () => {
    expect(workspaceSearchKeyAction("Enter")).toBe("submit");
    expect(workspaceSearchKeyAction("Escape")).toBe("clear");
    expect(workspaceSearchKeyAction("ArrowDown")).toBeNull();
  });
});
