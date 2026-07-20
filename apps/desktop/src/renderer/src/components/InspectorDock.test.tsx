import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import type { NoteDocument } from "@exo/core";

import { InspectorDock } from "./InspectorDock";

const note: NoteDocument = {
  filePath: "/notes/alpha.md",
  title: "Alpha",
  kind: "markdown",
  frontmatter: { status: "draft", tags: ["exo"] },
  body: "# Heading\n\n[[Beta]]",
};

describe("Connections", () => {
  it("keeps note properties in the editor and only reveals History when records exist", () => {
    const html = renderToStaticMarkup(
      <InspectorDock
        document={note}
        graphContext={null}
        open
        activeTag={null}
        tagResults={[]}
        invocationHistory={[]}
        onOpenInvocationHistory={() => {}}
        onResumeInvocation={() => {}}
        onToggle={() => {}}
        onOpenTarget={() => {}}
        onOpenExternal={() => {}}
        onOpenTag={() => {}}
      />,
    );

    expect(html).toContain("Connections");
    expect(html).not.toContain("Properties");
    expect(html).toContain('role="tablist"');
    expect(html).toContain("connections-tab-outline");
    expect(html).not.toContain("connections-tab-activity");
    expect(html).not.toContain("connections-tab-history");
    expect(html).toContain("Heading");
    expect(html).toContain("outline-panel");
  });

  it("renders compact invocation History with a resume affordance", () => {
    const html = renderToStaticMarkup(
      <InspectorDock
        document={note}
        graphContext={null}
        open
        activeTag={null}
        tagResults={[]}
        invocationHistory={[{ invocationId: "i-1", createdAt: new Date().toISOString(), command: { handle: "claude", label: "Claude" }, outcome: "kept", changedFileCount: 2, changeIds: ["a", "b"], providerSessionId: "session" }]}
        onOpenInvocationHistory={() => {}}
        onResumeInvocation={() => {}}
        onToggle={() => {}}
        onOpenTarget={() => {}}
        onOpenExternal={() => {}}
        onOpenTag={() => {}}
      />,
    );
    expect(html).toContain("connections-tab-history");
  });
});
