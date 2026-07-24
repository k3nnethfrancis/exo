import { describe, expect, it } from "vitest";
import type { InvocationFileReviewPayload } from "../../shared/api";

import {
  invocationReviewMetadata,
  invocationReviewOriginal,
  invocationSnapshotBody,
  invocationSnapshotFrontmatter,
} from "./invocationInlineReview";

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

  it("uses former content as the original side of a deleted-file review", () => {
    const payload = { beforeText: "former content\n", afterText: null } as InvocationFileReviewPayload;
    expect(invocationReviewOriginal(payload, "text")).toBe("former content\n");
  });

  it("treats a created file as empty before the invocation", () => {
    const payload = { beforeText: null, afterText: "created content\n" } as InvocationFileReviewPayload;
    expect(invocationReviewOriginal(payload, "text")).toBe("");
  });

  it("projects frontmatter-only edits as exact structured field changes", () => {
    const payload = {
      beforeText: "---\ntitle: Before\ntags:\n  - exo\nstatus: draft\n---\nSame body\n",
      afterText: "---\ntitle: After\ntags:\n  - exo\nstatus: ready\n---\nSame body\n",
      change: {
        before: { mode: 0o644 },
        after: { mode: 0o644 },
      },
    } as InvocationFileReviewPayload;

    expect(invocationReviewMetadata(payload)).toEqual({
      frontmatter: [
        { key: "status", before: "draft", after: "ready" },
        { key: "title", before: "Before", after: "After" },
      ],
    });
    expect(invocationSnapshotFrontmatter(payload.afterText)).toBe("title: After\ntags:\n  - exo\nstatus: ready\n");
  });

  it("falls back to the exact YAML block when complex and simple keys change together", () => {
    const before = '"display name": Before\ntitle: Before\n';
    const after = '"display name": After\ntitle: After\n';
    const payload = {
      beforeText: `---\n${before}---\nSame body\n`,
      afterText: `---\n${after}---\nSame body\n`,
      change: { before: { mode: 0o644 }, after: { mode: 0o644 } },
    } as InvocationFileReviewPayload;

    expect(invocationReviewMetadata(payload)).toEqual({
      frontmatter: [{ key: "Frontmatter", before: before.trim(), after: after.trim() }],
    });
  });

  it("projects chmod-only changes even when file text is identical", () => {
    const payload = {
      beforeText: "Same body\n",
      afterText: "Same body\n",
      change: {
        before: { mode: 0o644 },
        after: { mode: 0o755 },
      },
    } as InvocationFileReviewPayload;

    expect(invocationReviewMetadata(payload)).toEqual({
      frontmatter: [],
      permission: { before: "0644", after: "0755" },
    });
  });
});
