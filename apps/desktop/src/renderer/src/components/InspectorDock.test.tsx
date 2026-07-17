import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import type { NoteDocument } from "@exo/core";

import { InspectorDock, hasMeaningfulInvocationActivity } from "./InspectorDock";

const note: NoteDocument = {
  filePath: "/notes/alpha.md",
  title: "Alpha",
  kind: "markdown",
  frontmatter: { status: "draft", tags: ["exo"] },
  body: "# Heading\n\n[[Beta]]",
};

describe("Connections", () => {
  it("renders compact Properties and keyboard-safe connection tabs from authoritative note context", () => {
    const html = renderToStaticMarkup(
      <InspectorDock
        document={note}
        graphContext={null}
        open
        activeTag={null}
        tagResults={[]}
        onToggle={() => {}}
        onOpenTarget={() => {}}
        onOpenExternal={() => {}}
        onOpenTag={() => {}}
      />,
    );

    expect(html).toContain("Connections");
    expect(html).toContain("Properties");
    expect(html).toContain('role="tablist"');
    expect(html).toContain("connections-tab-outline");
    expect(html).toContain("connections-tab-activity");
    expect(html).toContain("Heading");
    expect(html).toContain("outline-panel");
    expect(html).not.toContain("No activity yet");
  });

  it("does not surface Activity without meaningful invocation evidence", () => {
    expect(hasMeaningfulInvocationActivity({ status: "running", changedFileRefs: [], diffRefs: [] })).toBe(false);
    expect(hasMeaningfulInvocationActivity({ status: "process-exited", changedFileRefs: [], diffRefs: [] })).toBe(false);
    expect(hasMeaningfulInvocationActivity({ status: "failed", changedFileRefs: [], diffRefs: [] })).toBe(true);
    expect(hasMeaningfulInvocationActivity({ status: "process-exited", changedFileRefs: [{ path: "x", kind: "modified", attribution: "likely" }], diffRefs: [] })).toBe(true);
  });
});
