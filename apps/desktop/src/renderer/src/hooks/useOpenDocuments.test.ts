import { describe, expect, it } from "vitest";

import { applyDocumentBodyEdit, applyDocumentFrontmatterEdit, type OpenEditorDocument } from "./useOpenDocuments";

function document(filePath: string): OpenEditorDocument {
  return {
    filePath,
    title: filePath,
    kind: "markdown",
    frontmatter: {},
    body: "# Original\n",
    dirty: false,
    diskVersion: null,
  };
}

describe("path-explicit document writes", () => {
  it("edits the editor path that emitted the change even when another document owns focus", () => {
    const documents = {
      "/notes/left.md": document("/notes/left.md"),
      "/notes/right.md": document("/notes/right.md"),
    };

    const next = applyDocumentBodyEdit(documents, "/notes/right.md", "# Right\nupdated");

    expect(next?.["/notes/left.md"].body).toBe("# Original\n");
    expect(next?.["/notes/right.md"]).toMatchObject({ body: "# Right\nupdated", dirty: true });
  });

  it("updates frontmatter on the explicit editor path only", () => {
    const documents = {
      "/notes/left.md": document("/notes/left.md"),
      "/notes/right.md": document("/notes/right.md"),
    };

    const next = applyDocumentFrontmatterEdit(documents, "/notes/right.md", "status", "draft");

    expect(next?.["/notes/left.md"].frontmatter).toEqual({});
    expect(next?.["/notes/right.md"].frontmatter).toEqual({ status: "draft" });
  });
});
