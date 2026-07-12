import { describe, expect, it } from "vitest";

import { workspaceBreadcrumb } from "./workspaceBreadcrumb";

describe("workspaceBreadcrumb", () => {
  it("distinguishes a root note from a folder", () => {
    expect(workspaceBreadcrumb("/vault/tasks.md", ["/vault"])).toEqual([
      { kind: "file", label: "tasks", path: "/vault/tasks.md" },
    ]);
  });

  it("keeps nested folder and file paths clickable", () => {
    expect(workspaceBreadcrumb("/vault/research/concepts/cantrip-pattern.md", ["/vault"])).toEqual([
      { kind: "folder", label: "research", path: "/vault/research" },
      { kind: "folder", label: "concepts", path: "/vault/research/concepts" },
      { kind: "file", label: "cantrip-pattern", path: "/vault/research/concepts/cantrip-pattern.md" },
    ]);
  });

  it("uses paths rather than labels as identity when names repeat", () => {
    const segments = workspaceBreadcrumb("/vault/research/research/note.md", ["/vault"]);
    expect(segments.map((segment) => segment.path)).toEqual([
      "/vault/research",
      "/vault/research/research",
      "/vault/research/research/note.md",
    ]);
  });

  it("does not invent clickable folder paths outside Note Roots", () => {
    expect(workspaceBreadcrumb("/attached/reference/readme.md", ["/vault"])).toEqual([
      { kind: "file", label: "readme", path: "/attached/reference/readme.md" },
    ]);
  });
});
