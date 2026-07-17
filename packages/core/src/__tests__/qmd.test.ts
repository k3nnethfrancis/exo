import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import { qmdSearchProvider } from "../search-providers/qmd-provider";
import { createIndexedRoot, resolveWorkspaceModel } from "../workspace";

const stores: MockStore[] = [];
const tempPaths: string[] = [];
let createStoreError: Error | null = null;

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
  stores.splice(0);
  createStoreError = null;
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

  it("falls back from semantic search to lexical when vectors are unavailable", async () => {
    const root = await fixtureRoot();
    const indexedRoot = createIndexedRoot(path.join(root, "notes"), { id: "index-notes", label: "notes", kind: "notes" });
    const model = {
      ...resolveWorkspaceModel({
        EXO_WORKSPACE_ROOT: root,
        EXO_NOTE_ROOTS: path.join(root, "notes"),
        EXO_PROJECT_ROOTS: "",
      }),
      indexedRoots: [indexedRoot],
      indexing: { enabled: true, mode: "semantic" as const, backend: "qmd" as const },
    };

    const result = await qmdSearchProvider.search(model, path.join(root, ".exo"), "focus");

    expect(result.warnings.some((warning) => warning.includes("Semantic search is not ready"))).toBe(true);
    expect(stores[0].searchLexCalls.length).toBeGreaterThanOrEqual(1);
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

    await qmdSearchProvider.update(model, path.join(root, ".exo"));
    await qmdSearchProvider.embed(model, path.join(root, ".exo"));

    expect(stores.some((store) => store.updateCalls === 1)).toBe(true);
    expect(stores.some((store) => store.embedCalls === 1)).toBe(true);
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
  searchCalls: Array<{ query?: string; collections?: string[]; limit?: number }> = [];
  updateOptions: unknown[] = [];
  updateCalls = 0;
  embedCalls = 0;
  embedOptions: unknown[] = [];
  getDocumentBodyCalls = 0;

  async getStatus() {
    return {
      totalDocuments: 1,
      needsEmbedding: 1,
      hasVectorIndex: false,
      collections: [{ name: "notes", documents: 1, lastUpdated: "2026-05-15T00:00:00.000Z" }],
    };
  }

  async searchLex(query: string, options: { collection?: string; limit?: number }) {
    this.searchLexCalls.push({ query, collection: options.collection, limit: options.limit });
    return [{
      file: `qmd://${options.collection}/focus.md`,
      title: "Focus",
      snippet: "alpha",
      score: 0.8,
      docid: "abc123",
    }];
  }

  async searchVector() {
    throw new Error("no vectors");
  }

  async search(options: { query?: string; collections?: string[]; limit?: number }) {
    this.searchCalls.push(options);
    return this.searchLex(options.query ?? "hybrid", { collection: options.collections?.[0] ?? "notes", limit: options.limit ?? 10 });
  }

  async get() {
    return {
      filepath: "qmd://notes/focus.md",
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
