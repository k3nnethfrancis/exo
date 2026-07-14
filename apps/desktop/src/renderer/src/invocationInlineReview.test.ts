import { describe, expect, it } from "vitest";

import { invocationSnapshotBody } from "./invocationInlineReview";

describe("invocation snapshot projection", () => {
  it("keeps plain-text snapshots intact", () => {
    expect(invocationSnapshotBody("---\nnot metadata\n", "text")).toBe("---\nnot metadata\n");
  });

  it("projects a Markdown artifact onto the editor body", () => {
    expect(invocationSnapshotBody("---\ntitle: Before\ntags:\n  - exo\n---\n# Draft\n", "markdown"))
      .toBe("# Draft\n");
  });

  it("preserves body whitespace and CRLF line endings", () => {
    expect(invocationSnapshotBody("---\r\ntitle: Before\r\n---\r\n\r\n# Draft\r\n", "markdown"))
      .toBe("\r\n# Draft\r\n");
  });

  it("does not strip an unterminated frontmatter fence", () => {
    expect(invocationSnapshotBody("---\ntitle: prose\n# Draft\n", "markdown"))
      .toBe("---\ntitle: prose\n# Draft\n");
  });
});
