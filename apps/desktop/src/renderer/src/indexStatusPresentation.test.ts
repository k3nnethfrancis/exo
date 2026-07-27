import { describe, expect, it } from "vitest";
import type { IndexStatus } from "@stem/core";

import { summarizeIndexStatus } from "./indexStatusPresentation";

describe("index status presentation", () => {
  it("shows the waiting-note count in the app search badge", () => {
    expect(summarizeIndexStatus(indexStatusFixture({ pendingEmbeddings: 1 }), null)).toMatchObject({
      label: "1 note waiting",
      tone: "warn",
      busy: false,
    });
    expect(summarizeIndexStatus(indexStatusFixture({ pendingEmbeddings: 12 }), null).label).toBe("12 notes waiting");
  });

});

function indexStatusFixture(overrides: Partial<IndexStatus> = {}): IndexStatus {
  return {
    enabled: true,
    mode: "hybrid",
    backend: "qmd",
    dbPath: "/workspace/.stem/qmd/index.sqlite",
    runtimePath: "/workspace/.stem/qmd",
    indexedRoots: [
      {
        id: "index-root-1",
        label: "notes",
        path: "/workspace/notes",
        kind: "mixed",
        pattern: "**/*.md",
        ignore: [],
        backend: "qmd",
      },
    ],
    documentCount: 10,
    pendingEmbeddings: 0,
    hasVectorIndex: true,
    lastUpdated: "2026-07-03T10:00:00.000Z",
    warnings: [],
    errors: [],
    ...overrides,
  };
}
