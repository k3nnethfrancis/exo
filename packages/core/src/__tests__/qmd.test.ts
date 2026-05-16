import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import { embedIndex, getIndexStatus, readIndexDocument, searchIndex, updateIndex } from "../qmd";
import { createIndexedRoot, resolveWorkspaceModel } from "../workspace";

const stores: MockStore[] = [];
const tempPaths: string[] = [];

vi.mock("@tobilu/qmd", () => ({
  createStore: vi.fn(async () => {
    const store = new MockStore();
    stores.push(store);
    return store;
  }),
}));

afterEach(async () => {
  stores.splice(0);
  await Promise.all(tempPaths.splice(0).map((target) => rm(target, { recursive: true, force: true })));
});

describe("QMD index adapter", () => {
  it("uses filesystem search when the index is off", async () => {
    const root = await fixtureRoot();
    const model = resolveWorkspaceModel({
      EXO_WORKSPACE_ROOT: root,
      EXO_NOTE_ROOTS: path.join(root, "notes"),
      EXO_PROJECT_ROOTS: "",
    });

    const result = await searchIndex(model, path.join(root, ".exo"), "focus");

    expect(result.source).toBe("filesystem");
    expect(result.results.some((entry) => entry.title === "focus")).toBe(true);
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

    const result = await searchIndex(model, path.join(root, ".exo"), "focus");

    expect(result.source).toBe("qmd");
    expect(stores[0].searchLexCalls).toEqual([{ query: "focus", collection: "notes", limit: 10 }]);
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

    const result = await searchIndex(model, path.join(root, ".exo"), "focus");

    expect(result.warnings[0]).toContain("Semantic search is not ready");
    expect(stores[0].searchLexCalls.length).toBeGreaterThanOrEqual(1);
  });

  it("reports status and delegates update/embed", async () => {
    const root = await fixtureRoot();
    const model = indexedModel(root, "hybrid");

    const status = await getIndexStatus(model, path.join(root, ".exo"));
    expect(status.dbPath).toContain(path.join(".exo", "qmd", "index.sqlite"));
    expect(status.documentCount).toBe(1);
    expect(status.pendingEmbeddings).toBe(1);

    await updateIndex(model, path.join(root, ".exo"));
    await embedIndex(model, path.join(root, ".exo"));

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

    const result = await readIndexDocument(model, path.join(root, ".exo"), filePath, { fromLine: 2, maxLines: 1 });

    expect(result.body).toBe("alpha");
  });

  it("resolves QMD docids to filesystem paths", async () => {
    const root = await fixtureRoot();
    const model = indexedModel(root, "lexical");

    const result = await readIndexDocument(model, path.join(root, ".exo"), "#abc123", { fromLine: 1, maxLines: 2 });

    expect(result.filePath).toBe(path.join(root, "notes", "focus.md"));
    expect(result.source).toBe("qmd");
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
  updateCalls = 0;
  embedCalls = 0;

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

  async search() {
    return this.searchLex("hybrid", { collection: "notes", limit: 10 });
  }

  async get() {
    return {
      filepath: "qmd://notes/focus.md",
      title: "Focus",
    };
  }

  async getDocumentBody() {
    return "# Focus\nalpha";
  }

  async update() {
    this.updateCalls += 1;
  }

  async embed() {
    this.embedCalls += 1;
  }

  async close() {}
}
