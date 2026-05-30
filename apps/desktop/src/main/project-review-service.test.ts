import { describe, expect, it } from "vitest";

import { parseGitDiffFirstChangedLines, parseGitStatusChanges } from "./project-review-service";

describe("project review git parsing", () => {
  it("parses porcelain changes and changed-line starts", () => {
    const changedLines = new Map([
      ["src/app.ts", 14],
      ["renamed-new.ts", 3],
    ]);

    expect(parseGitStatusChanges("/repo", " M src/app.ts\nR  renamed-old.ts -> renamed-new.ts\n?? new.md\n", changedLines)).toEqual([
      {
        path: "src/app.ts",
        absolutePath: "/repo/src/app.ts",
        status: "M",
        firstChangedLine: 14,
      },
      {
        path: "renamed-new.ts",
        absolutePath: "/repo/renamed-new.ts",
        status: "R",
        firstChangedLine: 3,
      },
      {
        path: "new.md",
        absolutePath: "/repo/new.md",
        status: "??",
        firstChangedLine: 1,
      },
    ]);
  });

  it("takes the first non-empty added hunk line for each file", () => {
    const diff = [
      "diff --git a/src/app.ts b/src/app.ts",
      "--- a/src/app.ts",
      "+++ b/src/app.ts",
      "@@ -10,0 +11,2 @@",
      "+one",
      "@@ -30,2 +40,3 @@",
      "+two",
      "diff --git a/deleted.ts b/deleted.ts",
      "--- a/deleted.ts",
      "+++ b/deleted.ts",
      "@@ -1,2 +0,0 @@",
      "-gone",
    ].join("\n");

    expect(Object.fromEntries(parseGitDiffFirstChangedLines(diff))).toEqual({
      "src/app.ts": 11,
    });
  });
});
