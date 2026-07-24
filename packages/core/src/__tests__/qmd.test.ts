import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import { qmdSearchProvider } from "../search-providers/qmd-provider";
import { createIndexedRoot, resolveWorkspaceModel } from "../workspace";
import { WorkspaceFiles } from "../workspace-files";

const { readFileMock } = vi.hoisted(() => ({ readFileMock: vi.fn() }));

vi.mock("node:fs/promises", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs/promises")>();
  readFileMock.mockImplementation(actual.readFile);
  return { ...actual, readFile: readFileMock };
});

const stores: MockStore[] = [];
const tempPaths: string[] = [];
let createStoreError: Error | null = null;
let searchLexResultsOverride: unknown[] | null = null;
const searchLexResultsByCollection = new Map<string, unknown[]>();
let searchVectorResultsOverride: unknown[] | null = null;
let hybridSearchError: Error | null = null;
let documentPathOverride: string | null = null;
interface MockQmdStatus {
  totalDocuments: number;
  needsEmbedding: number;
  hasVectorIndex: boolean;
  collections: Array<{ name: string; documents: number; lastUpdated: string }>;
}
let storeStatusOverride: MockQmdStatus | null = null;

vi.mock("@tobilu/qmd", () => ({
  createStore: vi.fn(async () => {
    if (createStoreError) {
      throw createStoreError;
    }
    const store = new MockStore();
    stores.push(store);
    return store;
  }),
}));

afterEach(async () => {
  vi.restoreAllMocks();
  stores.splice(0);
  createStoreError = null;
  searchLexResultsOverride = null;
  searchLexResultsByCollection.clear();
  searchVectorResultsOverride = null;
  hybridSearchError = null;
  documentPathOverride = null;
  readFileMock.mockClear();
  storeStatusOverride = null;
  await Promise.all(tempPaths.splice(0).map((target) => rm(target, { recursive: true, force: true })));
});

describe("QMD index adapter", () => {
  it("exposes QMD search-provider metadata", () => {
    expect(qmdSearchProvider.metadata).toMatchObject({
      id: "qmd",
      label: "QMD search",
      description: expect.stringContaining("Bundled local Markdown search provider"),
      lifecycle: "built-in",
      backend: "qmd",
    });
  });

  it("uses filesystem search when the index is off", async () => {
    const root = await fixtureRoot();
    const model = resolveWorkspaceModel({
      EXO_WORKSPACE_ROOT: root,
      EXO_NOTE_ROOTS: path.join(root, "notes"),
      EXO_PROJECT_ROOTS: "",
    });

    const result = await qmdSearchProvider.search(model, path.join(root, ".exo"), "focus");

    expect(result.source).toBe("filesystem");
    expect(result.warnings[0]).toBe("QMD is unavailable; showing Simple search results.");
    expect(result.results.some((entry) => entry.title === "Focus")).toBe(true);
  });

  it("routes lexical search through QMD collections", async () => {
    const root = await fixtureRoot();
    const indexedRoot = createIndexedRoot(path.join(root, "notes"), { id: "index-notes", label: "notes", kind: "notes" });
    const model = {
      ...resolveWorkspaceModel({
        EXO_WORKSPACE_ROOT: root,
        EXO_NOTE_ROOTS: path.join(root, "notes"),
        EXO_PROJECT_ROOTS: "",
      }),
      indexedRoots: [indexedRoot],
      indexing: { enabled: true, mode: "lexical" as const, backend: "qmd" as const },
    };

    const result = await qmdSearchProvider.search(model, path.join(root, ".exo"), "focus");

    expect(result.source).toBe("qmd");
    expect(stores[0].searchLexCalls).toEqual([{ query: "focus", collection: "notes", limit: 11 }]);
    expect(result.results[0]).toMatchObject({ title: "Focus", source: "qmd" });
  });

  it("refills lexical and vector streams independently during semantic search", async () => {
    const root = await fixtureRoot();
    const lexicalPaths = ["lex-a.md", "lex-b.md", "lex-c.md"].map((name) => path.join(root, "notes", name));
    const vectorPaths = ["vec-a.md", "vec-b.md", "vec-c.md"].map((name) => path.join(root, "notes", name));
    await Promise.all([...lexicalPaths, ...vectorPaths].map((filePath) => writeFile(filePath, "# Result\n", "utf8")));
    searchLexResultsOverride = [
      qmdResult(path.join(root, "notes", "stale-lex.md"), 1),
      ...lexicalPaths.map((filePath, index) => qmdResult(filePath, 0.95 - index / 10)),
    ];
    searchVectorResultsOverride = [
      qmdResult(path.join(root, "notes", "stale-vector.md"), 0.98),
      ...vectorPaths.map((filePath, index) => qmdResult(filePath, 0.9 - index / 10)),
    ];
    storeStatusOverride = {
      totalDocuments: 6,
      needsEmbedding: 0,
      hasVectorIndex: true,
      collections: [{ name: "notes", documents: 6, lastUpdated: "2026-05-15T00:00:00.000Z" }],
    };

    const result = await qmdSearchProvider.search(indexedModel(root, "semantic"), path.join(root, ".exo"), "result", { limit: 2 });

    expect(result.mode).toBe("semantic");
    expect(result.results.map((entry) => entry.filePath)).toEqual([lexicalPaths[0], vectorPaths[0]]);
    expect(result.hasMore).toBe(true);
    expect(result.warnings).toEqual(["Dropped 2 invalid or stale QMD results."]);
    expect(stores[0].searchLexCalls.map((call) => call.limit)).toEqual([3, 6]);
    expect(stores[0].searchVectorCalls.map((call) => call.limit)).toEqual([3, 6]);
  });

  it("refills a successful hybrid stream before computing pagination", async () => {
    const root = await fixtureRoot();
    const notePaths = ["a.md", "b.md", "c.md", "d.md"].map((name) => path.join(root, "notes", name));
    await Promise.all(notePaths.map((filePath) => writeFile(filePath, "# Result\n", "utf8")));
    searchLexResultsOverride = [
      qmdResult(path.join(root, "notes", "stale.md"), 1),
      ...notePaths.map((filePath, index) => qmdResult(filePath, 0.9 - index / 10)),
    ];
    storeStatusOverride = {
      totalDocuments: 4,
      needsEmbedding: 0,
      hasVectorIndex: true,
      collections: [{ name: "notes", documents: 4, lastUpdated: "2026-05-15T00:00:00.000Z" }],
    };

    const result = await qmdSearchProvider.search(indexedModel(root, "hybrid"), path.join(root, ".exo"), "result", { limit: 2 });

    expect(result.mode).toBe("hybrid");
    expect(result.results.map((entry) => entry.filePath)).toEqual(notePaths.slice(0, 2));
    expect(result.hasMore).toBe(true);
    expect(result.warnings).toEqual(["Dropped 1 invalid or stale QMD result."]);
    expect(stores[0].searchCalls.map((call) => call.limit)).toEqual([3, 6]);
  });

  it.each(["semantic", "hybrid"] as const)("refills a fresh lexical stream when %s search falls back", async (mode) => {
    const root = await fixtureRoot();
    const notePaths = ["a.md", "b.md", "c.md", "d.md"].map((name) => path.join(root, "notes", name));
    await Promise.all(notePaths.map((filePath) => writeFile(filePath, "# Result\n", "utf8")));
    searchLexResultsOverride = [
      qmdResult(path.join(root, "notes", "stale.md"), 1),
      ...notePaths.map((filePath, index) => qmdResult(filePath, 0.9 - index / 10)),
    ];
    storeStatusOverride = {
      totalDocuments: 4,
      needsEmbedding: 0,
      hasVectorIndex: true,
      collections: [{ name: "notes", documents: 4, lastUpdated: "2026-05-15T00:00:00.000Z" }],
    };
    hybridSearchError = mode === "hybrid" ? new Error("no vectors") : null;

    const result = await qmdSearchProvider.search(indexedModel(root, mode), path.join(root, ".exo"), "result", { limit: 2 });

    expect(result.mode).toBe("lexical");
    expect(result.results.map((entry) => entry.filePath)).toEqual(notePaths.slice(0, 2));
    expect(result.hasMore).toBe(true);
    expect(result.warnings).toEqual([
      `${mode[0].toUpperCase()}${mode.slice(1)} search is not ready (no vectors); using lexical search.`,
      "Dropped 1 invalid or stale QMD result.",
    ]);
    expect(stores[0].searchLexCalls.map((call) => call.limit)).toEqual(mode === "semantic" ? [3, 3, 6] : [3, 6]);
    if (mode === "semantic") {
      expect(stores[0].searchVectorCalls.map((call) => call.limit)).toEqual([3]);
    } else {
      expect(stores[0].searchCalls.map((call) => call.limit)).toEqual([3]);
    }
  });

  it.each(["lexical", "hybrid"] as const)("enforces selected-root authority during %s search", async (mode) => {
    const root = await fixtureRoot();
    const docsPath = path.join(root, "docs");
    const secretPath = path.join(docsPath, "secret.md");
    await mkdir(docsPath);
    await writeFile(secretPath, "# Secret\n", "utf8");
    const model = {
      ...indexedModel(root, mode),
      indexedRoots: [
        createIndexedRoot(path.join(root, "notes"), { id: "index-notes", label: "notes", kind: "notes" }),
        createIndexedRoot(docsPath, { id: "index-docs", label: "docs", kind: "docs" }),
      ],
    };
    hybridSearchError = mode === "hybrid" ? new Error("no vectors") : null;
    searchLexResultsOverride = [
      qmdResult("qmd://notes/focus.md", 0.9),
      qmdResult("qmd://docs/secret.md", 0.8),
      qmdResult(secretPath, 0.7),
    ];

    const result = await qmdSearchProvider.search(model, path.join(root, ".exo"), "focus", {
      rootIds: ["index-notes"],
      includeContent: true,
    });

    expect(result.results.map((entry) => entry.filePath)).toEqual([path.join(root, "notes", "focus.md")]);
    expect(result.warnings).toContain("Dropped 2 invalid or stale QMD results.");
    expect(stores[0].searchLexCalls.every((call) => call.collection === "notes")).toBe(true);
    if (mode === "hybrid") {
      expect(stores[0].searchCalls).toEqual([expect.objectContaining({ collections: ["notes"] })]);
    }
    expect(readFileMock).toHaveBeenCalledTimes(1);
    expect(readFileMock).not.toHaveBeenCalledWith(secretPath, "utf8");
  });

  it.each([false, true])("refills limit-truncated %scontent search after initial authorization rejection", async (includeContent) => {
    const root = await fixtureRoot();
    const stalePath = path.join(root, "notes", "stale.md");
    const notePaths = ["a.md", "b.md", "c.md", "d.md"].map((name) => path.join(root, "notes", name));
    await Promise.all(notePaths.map((filePath, index) => writeFile(filePath, `# Result ${index + 1}\n`, "utf8")));
    searchLexResultsOverride = [
      qmdResult(stalePath, 1),
      ...notePaths.map((filePath, index) => qmdResult(filePath, 0.9 - index / 10)),
    ];

    const firstPage = await qmdSearchProvider.search(indexedModel(root, "lexical"), path.join(root, ".exo"), "result", {
      includeContent,
      limit: 2,
      offset: 0,
    });
    const secondPage = await qmdSearchProvider.search(indexedModel(root, "lexical"), path.join(root, ".exo"), "result", {
      includeContent,
      limit: 2,
      offset: firstPage.results.length,
    });

    expect(firstPage.results.map((entry) => entry.filePath)).toEqual(notePaths.slice(0, 2));
    expect(firstPage.hasMore).toBe(true);
    expect(secondPage.results.map((entry) => entry.filePath)).toEqual(notePaths.slice(2));
    expect(secondPage.hasMore).toBe(false);
    expect(new Set([...firstPage.results, ...secondPage.results].map((entry) => entry.filePath)).size).toBe(4);
    expect(firstPage.warnings.filter((warning) => warning.includes("invalid or stale QMD"))).toEqual(["Dropped 1 invalid or stale QMD result."]);
    expect(secondPage.warnings.filter((warning) => warning.includes("invalid or stale QMD"))).toEqual(["Dropped 1 invalid or stale QMD result."]);
    expect(stores[0].searchLexCalls.map((call) => call.limit)).toEqual([3, 6]);
    expect(stores[1].searchLexCalls.map((call) => call.limit)).toEqual([5, 10]);
    expect(readFileMock).not.toHaveBeenCalledWith(stalePath, "utf8");
    expect(firstPage.results.every((entry) => includeContent ? typeof entry.content === "string" : entry.content === undefined)).toBe(true);
  });

  it("paginates over the post-hydration result set without duplicates or skipped rows", async () => {
    const root = await fixtureRoot();
    const notePaths = ["a.md", "b.md", "c.md", "d.md", "e.md"].map((name) => path.join(root, "notes", name));
    await Promise.all(notePaths.map((filePath, index) => writeFile(filePath, `# Result ${index + 1}\n`, "utf8")));
    searchLexResultsOverride = notePaths.map((filePath, index) => qmdResult(filePath, 1 - index / 10));

    const originalExisting = WorkspaceFiles.prototype.existing;
    const authorityCalls = new Map<string, number>();
    vi.spyOn(WorkspaceFiles.prototype, "existing").mockImplementation(async function (this: WorkspaceFiles, targetPath: string) {
      const callCount = (authorityCalls.get(targetPath) ?? 0) + 1;
      authorityCalls.set(targetPath, callCount);
      if (targetPath === notePaths[1] && callCount % 2 === 0) {
        throw new Error("simulated path change before hydration");
      }
      return originalExisting.call(this, targetPath);
    });

    const firstPage = await qmdSearchProvider.search(indexedModel(root, "lexical"), path.join(root, ".exo"), "result", {
      includeContent: true,
      limit: 2,
      offset: 0,
    });
    authorityCalls.clear();
    const secondPage = await qmdSearchProvider.search(indexedModel(root, "lexical"), path.join(root, ".exo"), "result", {
      includeContent: true,
      limit: 2,
      offset: firstPage.results.length,
    });

    expect(firstPage.results.map((entry) => entry.filePath)).toEqual([notePaths[0], notePaths[2]]);
    expect(firstPage.hasMore).toBe(true);
    expect(secondPage.results.map((entry) => entry.filePath)).toEqual([notePaths[3], notePaths[4]]);
    expect(secondPage.hasMore).toBe(false);
    expect(new Set([...firstPage.results, ...secondPage.results].map((entry) => entry.filePath)).size).toBe(4);
    expect(firstPage.warnings.filter((warning) => warning.includes("invalid or stale QMD"))).toEqual(["Dropped 1 invalid or stale QMD result."]);
    expect(secondPage.warnings.filter((warning) => warning.includes("invalid or stale QMD"))).toEqual(["Dropped 1 invalid or stale QMD result."]);
    expect(stores[0].searchLexCalls.map((call) => call.limit)).toEqual([3, 6]);
    expect(stores[1].searchLexCalls.map((call) => call.limit)).toEqual([5, 10]);
    expect(readFileMock).not.toHaveBeenCalledWith(notePaths[1], "utf8");
  });

  it("stops refilling when the selected provider stream proves exhaustion", async () => {
    const root = await fixtureRoot();
    const notePaths = ["a.md", "b.md"].map((name) => path.join(root, "notes", name));
    await Promise.all(notePaths.map((filePath, index) => writeFile(filePath, `# Result ${index + 1}\n`, "utf8")));
    searchLexResultsOverride = notePaths.map((filePath, index) => qmdResult(filePath, 1 - index / 10));

    const result = await qmdSearchProvider.search(indexedModel(root, "lexical"), path.join(root, ".exo"), "result", { limit: 2 });

    expect(result.results.map((entry) => entry.filePath)).toEqual(notePaths);
    expect(result.hasMore).toBe(false);
    expect(result.warnings).toEqual([]);
    expect(stores[0].searchLexCalls.map((call) => call.limit)).toEqual([3]);
  });

  it("surfaces incomplete results when hydration rejection reaches the hard per-stream scan bound", async () => {
    const root = await fixtureRoot();
    const cappedPaths = Array.from({ length: 101 }, (_, index) => path.join(root, "notes", `capped-${index}.md`));
    searchLexResultsOverride = cappedPaths.map((filePath, index) => qmdResult(filePath, 1 - index / 1000));
    const authorityCalls = new Map<string, number>();
    vi.spyOn(WorkspaceFiles.prototype, "existing").mockImplementation(async (targetPath: string) => {
      const callCount = (authorityCalls.get(targetPath) ?? 0) + 1;
      authorityCalls.set(targetPath, callCount);
      if (callCount % 2 === 0) {
        throw new Error("simulated path change before hydration");
      }
      return targetPath;
    });

    await expect(qmdSearchProvider.search(indexedModel(root, "lexical"), path.join(root, ".exo"), "result", {
      includeContent: true,
      limit: 2,
    })).rejects.toThrow(
      "QMD search reached the hard scan limit of 100 results in a provider stream before finding enough authorized results or proving exhaustion.",
    );
    expect(stores[0].searchLexCalls.map((call) => call.limit)).toEqual([3, 6, 12, 24, 48, 96, 100]);
    expect(readFileMock).not.toHaveBeenCalled();
  });

  it("preserves global score ordering while refilling bounded collection streams", async () => {
    const root = await fixtureRoot();
    const docsPath = path.join(root, "docs");
    await mkdir(docsPath);
    const stalePaths = [
      path.join(root, "notes", "stale-a.md"),
      path.join(root, "notes", "stale-b.md"),
    ];
    const notesResults = [
      [stalePaths[0], 1],
      [stalePaths[1], 0.98],
      [path.join(root, "notes", "note-a.md"), 0.95],
      [path.join(root, "notes", "note-b.md"), 0.9],
      [path.join(root, "notes", "note-c.md"), 0.85],
    ] as const;
    const docsResults = [
      [path.join(docsPath, "doc-a.md"), 0.8],
      [path.join(docsPath, "doc-b.md"), 0.7],
      [path.join(docsPath, "doc-c.md"), 0.6],
    ] as const;
    await Promise.all([...notesResults.slice(2), ...docsResults].map(([filePath]) => writeFile(filePath, "# Result\n", "utf8")));
    searchLexResultsByCollection.set("notes", notesResults.map(([filePath, score]) => qmdResult(filePath, score)));
    searchLexResultsByCollection.set("docs", docsResults.map(([filePath, score]) => qmdResult(filePath, score)));
    const model = {
      ...indexedModel(root, "lexical"),
      indexedRoots: [
        createIndexedRoot(path.join(root, "notes"), { id: "index-notes", label: "notes", kind: "notes" }),
        createIndexedRoot(docsPath, { id: "index-docs", label: "docs", kind: "docs" }),
      ],
    };

    const firstPage = await qmdSearchProvider.search(model, path.join(root, ".exo"), "result", { limit: 2 });
    const secondPage = await qmdSearchProvider.search(model, path.join(root, ".exo"), "result", {
      limit: 2,
      offset: firstPage.results.length,
    });
    const thirdPage = await qmdSearchProvider.search(model, path.join(root, ".exo"), "result", {
      limit: 2,
      offset: firstPage.results.length + secondPage.results.length,
    });

    expect(firstPage.results.map((entry) => entry.filePath)).toEqual([notesResults[2][0], notesResults[3][0]]);
    expect(firstPage.hasMore).toBe(true);
    expect(secondPage.results.map((entry) => entry.filePath)).toEqual([notesResults[4][0], docsResults[0][0]]);
    expect(secondPage.hasMore).toBe(true);
    expect(thirdPage.results.map((entry) => entry.filePath)).toEqual([docsResults[1][0], docsResults[2][0]]);
    expect(thirdPage.hasMore).toBe(false);
    expect(firstPage.warnings).toEqual(["Dropped 2 invalid or stale QMD results."]);
    expect(secondPage.warnings).toEqual(["Dropped 2 invalid or stale QMD results."]);
    expect(thirdPage.warnings).toEqual(["Dropped 2 invalid or stale QMD results."]);
    expect(stores[0].searchLexCalls).toEqual([
      { query: "result", collection: "notes", limit: 3 },
      { query: "result", collection: "docs", limit: 3 },
      { query: "result", collection: "notes", limit: 6 },
    ]);
    expect(stores[1].searchLexCalls).toEqual([
      { query: "result", collection: "notes", limit: 5 },
      { query: "result", collection: "docs", limit: 5 },
      { query: "result", collection: "notes", limit: 10 },
    ]);
    expect(stores[2].searchLexCalls).toEqual([
      { query: "result", collection: "notes", limit: 7 },
      { query: "result", collection: "docs", limit: 7 },
    ]);
  });

  it.each([
    { label: "empty", rootIds: [] as string[], collections: [] as string[], expectedPaths: [] as string[] },
    { label: "unknown-only", rootIds: ["missing"], collections: [] as string[], expectedPaths: [] as string[] },
    { label: "mixed known and unknown", rootIds: ["missing", "index-notes"], collections: ["notes"], expectedPaths: ["focus.md"] },
  ])("treats $label search root IDs as an exact known-ID intersection", async ({ rootIds, collections, expectedPaths }) => {
    const root = await fixtureRoot();
    const docsPath = path.join(root, "docs");
    await mkdir(docsPath);
    await writeFile(path.join(docsPath, "secret.md"), "# Secret\n", "utf8");
    const model = {
      ...indexedModel(root, "lexical"),
      indexedRoots: [
        createIndexedRoot(path.join(root, "notes"), { id: "index-notes", label: "notes", kind: "notes" }),
        createIndexedRoot(docsPath, { id: "index-docs", label: "docs", kind: "docs" }),
      ],
    };
    searchLexResultsOverride = [
      qmdResult("qmd://notes/focus.md", 0.9),
      qmdResult("qmd://docs/secret.md", 0.8),
    ];

    const result = await qmdSearchProvider.search(model, path.join(root, ".exo"), "focus", { rootIds, includeContent: true });

    expect(result.results.map((entry) => path.basename(entry.filePath))).toEqual(expectedPaths);
    expect(stores[0].searchLexCalls.map((call) => call.collection)).toEqual(collections);
    expect(readFileMock).toHaveBeenCalledTimes(expectedPaths.length);
  });

  it("drops an absolute QMD path outside configured indexed roots", async () => {
    const root = await fixtureRoot();
    const outsidePath = path.join(root, "outside.md");
    await writeFile(outsidePath, "# Outside\n", "utf8");
    searchLexResultsOverride = [qmdResult(outsidePath)];

    const result = await qmdSearchProvider.search(indexedModel(root, "lexical"), path.join(root, ".exo"), "focus");

    expect(result.results).toEqual([]);
    expect(result.warnings).toContain("Dropped 1 invalid or stale QMD result.");
  });

  it("drops a QMD result whose path escapes through a symlink", async () => {
    const root = await fixtureRoot();
    const outsidePath = path.join(root, "outside.md");
    await writeFile(outsidePath, "# Outside\n", "utf8");
    await symlink(outsidePath, path.join(root, "notes", "escape.md"));
    searchLexResultsOverride = [qmdResult("qmd://notes/escape.md")];

    const result = await qmdSearchProvider.search(indexedModel(root, "lexical"), path.join(root, ".exo"), "focus");

    expect(result.results).toEqual([]);
    expect(result.warnings).toContain("Dropped 1 invalid or stale QMD result.");
  });

  it("drops a QMD traversal result even when it lands in another indexed root", async () => {
    const root = await fixtureRoot();
    await mkdir(path.join(root, "docs"));
    await writeFile(path.join(root, "docs", "outside.md"), "# Outside\n", "utf8");
    const model = {
      ...indexedModel(root, "lexical"),
      indexedRoots: [
        createIndexedRoot(path.join(root, "notes"), { id: "index-notes", label: "notes", kind: "notes" }),
        createIndexedRoot(path.join(root, "docs"), { id: "index-docs", label: "docs", kind: "docs" }),
      ],
    };
    searchLexResultsOverride = [qmdResult("qmd://notes/../docs/outside.md")];

    const result = await qmdSearchProvider.search(model, path.join(root, ".exo"), "focus");

    expect(result.results).toEqual([]);
    expect(result.warnings).toContain("Dropped 2 invalid or stale QMD results.");
  });

  it("returns a contained QMD result and hydrates its content", async () => {
    const root = await fixtureRoot();
    searchLexResultsOverride = [qmdResult("qmd://notes/focus.md")];

    const result = await qmdSearchProvider.search(indexedModel(root, "lexical"), path.join(root, ".exo"), "focus", { includeContent: true });

    expect(result.results).toEqual([expect.objectContaining({
      filePath: path.join(root, "notes", "focus.md"),
      content: "# Focus\nalpha\nbeta\n",
    })]);
  });

  it("does not read rejected QMD targets when hydrating content", async () => {
    const root = await fixtureRoot();
    const outsidePath = path.join(root, "outside.md");
    await writeFile(outsidePath, "secret\n", "utf8");
    searchLexResultsOverride = [qmdResult(outsidePath)];
    const result = await qmdSearchProvider.search(indexedModel(root, "lexical"), path.join(root, ".exo"), "focus", { includeContent: true });

    expect(result.results).toEqual([]);
    expect(readFileMock).not.toHaveBeenCalled();
  });

  it("falls back to filesystem title and body search when QMD cannot open", async () => {
    const root = await fixtureRoot();
    const notePath = path.join(root, "notes", "sigmund.md");
    await writeFile(
      notePath,
      [
        "---",
        "title: Sigmund Lab",
        "tags: [cybernetics]",
        "---",
        "",
        "Ashby shows up only in the note body.",
        "",
      ].join("\n"),
      "utf8",
    );
    const model = indexedModel(root, "hybrid");
    createStoreError = new Error("The module was compiled against a different Node.js version using NODE_MODULE_VERSION 127");

    const bodyResult = await qmdSearchProvider.search(model, path.join(root, ".exo"), "Ashby");
    const titleResult = await qmdSearchProvider.search(model, path.join(root, ".exo"), "Sigmund Lab");

    expect(bodyResult.source).toBe("filesystem");
    expect(bodyResult.warnings[0]).toContain("QMD native ABI mismatch");
    expect(bodyResult.results[0]).toMatchObject({ filePath: notePath, title: "Sigmund Lab", source: "filesystem" });
    expect(bodyResult.results[0].snippet).toContain("Ashby");
    expect(titleResult.results[0]).toMatchObject({ filePath: notePath, title: "Sigmund Lab", snippet: "title: Sigmund Lab" });
  });

  it("reports missing vec0 separately when degraded search is used", async () => {
    const root = await fixtureRoot();
    const model = indexedModel(root, "hybrid");
    createStoreError = new Error("SQLITE_ERROR: no such module: vec0");

    const result = await qmdSearchProvider.search(model, path.join(root, ".exo"), "focus");

    expect(result.source).toBe("filesystem");
    expect(result.warnings[0]).toContain("QMD vec0 extension is unavailable");
  });

  it("runs hybrid search against every selected indexed root", async () => {
    const root = await fixtureRoot();
    const model = {
      ...resolveWorkspaceModel({
        EXO_WORKSPACE_ROOT: root,
        EXO_NOTE_ROOTS: path.join(root, "notes"),
        EXO_PROJECT_ROOTS: "",
      }),
      indexedRoots: [
        createIndexedRoot(path.join(root, "notes"), { id: "index-notes", label: "notes", kind: "notes" }),
        createIndexedRoot(path.join(root, "docs"), { id: "index-docs", label: "docs", kind: "docs" }),
      ],
      indexing: { enabled: true, mode: "hybrid" as const, backend: "qmd" as const },
    };

    await qmdSearchProvider.search(model, path.join(root, ".exo"), "focus");

    expect(stores[0].searchCalls.map((call) => call.collections)).toEqual([["notes"], ["docs"]]);
  });

  it("reports status and delegates update/embed", async () => {
    const root = await fixtureRoot();
    const model = indexedModel(root, "hybrid");

    const status = await qmdSearchProvider.getStatus(model, path.join(root, ".exo"));
    expect(status.dbPath).toContain(path.join(".exo", "qmd", "index.sqlite"));
    expect(status.documentCount).toBe(1);
    expect(status.pendingEmbeddings).toBe(1);
    expect(status.warnings.join(" ")).not.toContain("exo index sync");

    await qmdSearchProvider.update(model, path.join(root, ".exo"));
    await qmdSearchProvider.embed(model, path.join(root, ".exo"));

    expect(stores.some((store) => store.updateCalls === 1)).toBe(true);
    expect(stores.some((store) => store.embedCalls === 1)).toBe(true);
  });

  it("distinguishes an empty semantic index from a missing non-empty vector index", async () => {
    const root = await fixtureRoot();
    const model = indexedModel(root, "hybrid");
    storeStatusOverride = {
      totalDocuments: 0,
      needsEmbedding: 0,
      hasVectorIndex: false,
      collections: [{ name: "notes", documents: 0, lastUpdated: "2026-05-15T00:00:00.000Z" }],
    };
    const empty = await qmdSearchProvider.getStatus(model, path.join(root, ".exo"));
    expect(empty.warnings).not.toContainEqual(expect.stringContaining("Semantic vector index is unavailable"));

    storeStatusOverride = {
      ...storeStatusOverride,
      totalDocuments: 1,
      collections: [{ name: "notes", documents: 1, lastUpdated: "2026-05-15T00:00:00.000Z" }],
    };
    const inconsistent = await qmdSearchProvider.getStatus(model, path.join(root, ".exo"));
    expect(inconsistent.warnings).toContain("Semantic vector index is unavailable even though no embeddings are pending. Build embeddings to repair it.");
  });

  it("passes total-work bounds to automatic embedding without changing explicit defaults", async () => {
    const root = await fixtureRoot();
    const model = indexedModel(root, "hybrid");

    await qmdSearchProvider.embed(model, path.join(root, ".exo"), {
      maxDocuments: 4,
      maxDocsPerBatch: 1,
      maxDurationMs: 15_000,
    });
    await qmdSearchProvider.embed(model, path.join(root, ".exo"));

    const embeddingStores = stores.filter((store) => store.embedCalls > 0);
    expect(embeddingStores.map((store) => store.embedOptions[0])).toEqual([
      { maxDocuments: 4, maxDocsPerBatch: 1, maxDurationMs: 15_000 },
      undefined,
    ]);
  });

  it("warns when derived Exo state in a Git workspace is not ignored", async () => {
    const root = await fixtureRoot();
    await mkdir(path.join(root, ".git"));
    const status = await qmdSearchProvider.getStatus(indexedModel(root, "lexical"), path.join(root, ".exo"));

    expect(status.warnings).toContain("This Workspace is a Git repository and .exo/ is not ignored. Add .exo/ to .gitignore; Exo will not modify repository files automatically.");

    await writeFile(path.join(root, ".gitignore"), "/.exo/\n", "utf8");
    const ignoredStatus = await qmdSearchProvider.getStatus(indexedModel(root, "lexical"), path.join(root, ".exo"));

    expect(ignoredStatus.warnings).not.toContain("This Workspace is a Git repository and .exo/ is not ignored. Add .exo/ to .gitignore; Exo will not modify repository files automatically.");
  });

  it("can scope updates to selected indexed roots", async () => {
    const root = await fixtureRoot();
    const model = indexedModel(root, "hybrid");

    await qmdSearchProvider.update(model, path.join(root, ".exo"), { rootIds: ["index-notes"] });

    expect(stores.some((store) => JSON.stringify(store.updateOptions[0]) === JSON.stringify({ collections: ["notes"] }))).toBe(true);
  });

  it.each([
    { label: "undefined", rootIds: undefined, expectedCollections: ["notes", "docs"] },
    { label: "empty", rootIds: [] as string[], expectedCollections: null },
    { label: "unknown-only", rootIds: ["missing"], expectedCollections: null },
    { label: "mixed known and unknown", rootIds: ["missing", "index-notes"], expectedCollections: ["notes"] },
  ])("treats $label update root IDs as an exact known-ID intersection", async ({ rootIds, expectedCollections }) => {
    const root = await fixtureRoot();
    const docsPath = path.join(root, "docs");
    await mkdir(docsPath);
    const model = {
      ...indexedModel(root, "hybrid"),
      indexedRoots: [
        createIndexedRoot(path.join(root, "notes"), { id: "index-notes", label: "notes", kind: "notes" }),
        createIndexedRoot(docsPath, { id: "index-docs", label: "docs", kind: "docs" }),
      ],
    };

    await qmdSearchProvider.update(model, path.join(root, ".exo"), { rootIds });

    const updatingStores = stores.filter((store) => store.updateCalls > 0);
    if (expectedCollections) {
      expect(updatingStores).toHaveLength(1);
      expect(updatingStores[0].updateOptions).toEqual([{ collections: expectedCollections }]);
    } else {
      expect(updatingStores).toEqual([]);
    }
  });

  it("syncs lexical indexes without embeddings", async () => {
    const root = await fixtureRoot();
    const model = indexedModel(root, "lexical");

    const result = await qmdSearchProvider.sync(model, path.join(root, ".exo"));

    expect(result.phases).toEqual([
      { name: "update", status: "completed", message: "Indexed documents refreshed." },
      { name: "embed", status: "skipped", message: "Embeddings are not needed in lexical mode." },
    ]);
    expect(stores.some((store) => store.updateCalls === 1)).toBe(true);
    expect(stores.some((store) => store.embedCalls === 1)).toBe(false);
  });

  it("syncs hybrid indexes and embeddings", async () => {
    const root = await fixtureRoot();
    const model = indexedModel(root, "hybrid");

    const result = await qmdSearchProvider.sync(model, path.join(root, ".exo"));

    expect(result.phases.map((phase) => `${phase.name}:${phase.status}`)).toEqual(["update:completed", "embed:completed"]);
    expect(stores.some((store) => store.updateCalls === 1)).toBe(true);
    expect(stores.some((store) => store.embedCalls === 1)).toBe(true);
  });

  it("reads filesystem paths with line ranges", async () => {
    const root = await fixtureRoot();
    const filePath = path.join(root, "notes", "focus.md");
    const model = resolveWorkspaceModel({
      EXO_WORKSPACE_ROOT: root,
      EXO_NOTE_ROOTS: path.join(root, "notes"),
      EXO_PROJECT_ROOTS: "",
    });

    const result = await qmdSearchProvider.read(model, path.join(root, ".exo"), filePath, { fromLine: 2, maxLines: 1 });

    expect(result.body).toBe("alpha");
  });

  it("resolves QMD docids to filesystem paths", async () => {
    const root = await fixtureRoot();
    const model = indexedModel(root, "lexical");

    const result = await qmdSearchProvider.read(model, path.join(root, ".exo"), "#abc123", { fromLine: 1, maxLines: 2 });

    expect(result.filePath).toBe(path.join(root, "notes", "focus.md"));
    expect(result.source).toBe("qmd");
  });

  it("authorizes a resolved QMD path before reading its body", async () => {
    const root = await fixtureRoot();
    const model = indexedModel(root, "lexical");

    await expect(
      qmdSearchProvider.readAuthorized(
        model,
        path.join(root, ".exo"),
        "#abc123",
        {},
        async () => {
          throw new Error("path rejected");
        },
      ),
    ).rejects.toThrow("path rejected");
    expect(stores[0].getDocumentBodyCalls).toBe(0);
  });

  it("rejects stale QMD docids outside configured indexed roots", async () => {
    const root = await fixtureRoot();
    const model = {
      ...indexedModel(root, "lexical"),
      indexedRoots: [createIndexedRoot(path.join(root, "docs"), { id: "index-docs", label: "docs", kind: "docs" })],
    };

    await expect(qmdSearchProvider.read(model, path.join(root, ".exo"), "#abc123")).rejects.toThrow(
      "outside configured indexed roots",
    );
  });

  it("does not read a QMD docid body through a symlink escape", async () => {
    const root = await fixtureRoot();
    const outsidePath = path.join(root, "outside.md");
    await writeFile(outsidePath, "# Outside\n", "utf8");
    await symlink(outsidePath, path.join(root, "notes", "escape.md"));
    documentPathOverride = "qmd://notes/escape.md";

    await expect(qmdSearchProvider.read(indexedModel(root, "lexical"), path.join(root, ".exo"), "#abc123")).rejects.toThrow(
      "outside configured indexed roots",
    );
    expect(stores[0].getDocumentBodyCalls).toBe(0);
  });
});

async function fixtureRoot(): Promise<string> {
  const root = await mkdtemp(path.join(os.tmpdir(), "exo-qmd-test-"));
  tempPaths.push(root);
  await mkdir(path.join(root, "notes"), { recursive: true });
  await writeFile(path.join(root, "notes", "focus.md"), "# Focus\nalpha\nbeta\n", "utf8");
  return root;
}

function indexedModel(root: string, mode: "lexical" | "semantic" | "hybrid") {
  return {
    ...resolveWorkspaceModel({
      EXO_WORKSPACE_ROOT: root,
      EXO_NOTE_ROOTS: path.join(root, "notes"),
      EXO_PROJECT_ROOTS: "",
    }),
    indexedRoots: [createIndexedRoot(path.join(root, "notes"), { id: "index-notes", label: "notes", kind: "notes" })],
    indexing: { enabled: true, mode, backend: "qmd" as const },
  };
}

class MockStore {
  searchLexCalls: Array<{ query: string; collection?: string; limit?: number }> = [];
  searchVectorCalls: Array<{ query: string; collection?: string; limit?: number }> = [];
  searchCalls: Array<{ query?: string; collections?: string[]; limit?: number }> = [];
  updateOptions: unknown[] = [];
  updateCalls = 0;
  embedCalls = 0;
  embedOptions: unknown[] = [];
  getDocumentBodyCalls = 0;

  async getStatus(): Promise<MockQmdStatus> {
    return storeStatusOverride ?? {
      totalDocuments: 1,
      needsEmbedding: 1,
      hasVectorIndex: false,
      collections: [{ name: "notes", documents: 1, lastUpdated: "2026-05-15T00:00:00.000Z" }],
    };
  }

  async searchLex(query: string, options: { collection?: string; limit?: number }) {
    this.searchLexCalls.push({ query, collection: options.collection, limit: options.limit });
    const results = searchLexResultsByCollection.get(options.collection ?? "")
      ?? searchLexResultsOverride
      ?? [{
      file: `qmd://${options.collection}/focus.md`,
      title: "Focus",
      snippet: "alpha",
      score: 0.8,
      docid: "abc123",
      }];
    return results.slice(0, options.limit ?? results.length);
  }

  async searchVector(query: string, options: { collection?: string; limit?: number }) {
    this.searchVectorCalls.push({ query, collection: options.collection, limit: options.limit });
    if (!searchVectorResultsOverride) {
      throw new Error("no vectors");
    }
    return searchVectorResultsOverride.slice(0, options.limit ?? searchVectorResultsOverride.length);
  }

  async search(options: { query?: string; collections?: string[]; limit?: number }) {
    this.searchCalls.push(options);
    if (hybridSearchError) {
      throw hybridSearchError;
    }
    return this.searchLex(options.query ?? "hybrid", { collection: options.collections?.[0] ?? "notes", limit: options.limit ?? 10 });
  }

  async get() {
    return {
      filepath: documentPathOverride ?? "qmd://notes/focus.md",
      title: "Focus",
    };
  }

  async getDocumentBody() {
    this.getDocumentBodyCalls += 1;
    return "# Focus\nalpha";
  }

  async update(options?: unknown) {
    this.updateCalls += 1;
    this.updateOptions.push(options);
  }

  async embed(options?: unknown) {
    this.embedCalls += 1;
    this.embedOptions.push(options);
  }

  async close() {}
}

function qmdResult(file: string, score = 0.8) {
  return {
    file,
    title: "Focus",
    snippet: "alpha",
    score,
    docid: "abc123",
  };
}
