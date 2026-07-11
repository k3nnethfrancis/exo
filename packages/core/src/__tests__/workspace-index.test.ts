import { describe, expect, it } from "vitest";

import { WorkspaceIndex, type WorkspaceIndexAdapters } from "../workspace-index";
import type { SearchProvider } from "../search-provider";
import type { IndexStatus, WorkspaceModel } from "../types";

const model: WorkspaceModel = {
  workspaceRoot: "/workspace",
  defaultTerminalCwd: "/workspace",
  noteRoots: [],
  projectRoots: [],
  indexedRoots: [],
  indexing: { enabled: false, mode: "off", backend: "qmd" },
  attachedWorkcells: [],
};

function status(provider: "qmd" | "filesystem"): IndexStatus {
  return {
    enabled: true,
    mode: "lexical",
    backend: provider,
    dbPath: "/workspace/.exo/qmd/index.sqlite",
    runtimePath: "/workspace/.exo",
    indexedRoots: [],
    documentCount: 1,
    pendingEmbeddings: 0,
    hasVectorIndex: false,
    lastUpdated: null,
    warnings: [],
    errors: [],
  };
}

function provider(id: "qmd" | "filesystem"): SearchProvider {
  return {
    metadata: { id, label: id, description: id, lifecycle: "built-in", backend: id, capabilities: [] },
    getStatus: async () => status(id),
    search: async (_model, _runtimeRoot, query) => ({ query, mode: "lexical", source: id, warnings: [], results: [] }),
    read: async () => { throw new Error("unused"); },
    update: async () => status(id),
    embed: async () => status(id),
    sync: async () => ({ status: status(id), phases: [], warnings: [] }),
  };
}

describe("WorkspaceIndex", () => {
  it("selects filesystem search when indexing is off and exposes provider state", async () => {
    const adapters: WorkspaceIndexAdapters = { qmd: provider("qmd"), filesystem: provider("filesystem") };
    const index = new WorkspaceIndex({ context: { model, runtimeRoot: "/runtime" }, adapters });

    await expect(index.search("hello")).resolves.toMatchObject({ provider: "filesystem", degraded: false, truncated: false });
    await expect(index.status()).resolves.toMatchObject({ provider: "filesystem", degraded: false });
  });

  it("uses qmd for an enabled indexed workspace and rebuilds through that adapter", async () => {
    const indexedModel = { ...model, indexedRoots: [{ id: "notes", label: "Notes", path: "/workspace/notes", kind: "notes" as const, pattern: "**/*.md", ignore: [], backend: "qmd" as const }], indexing: { enabled: true, mode: "hybrid" as const, backend: "qmd" as const } };
    const adapters: WorkspaceIndexAdapters = { qmd: provider("qmd"), filesystem: provider("filesystem") };
    const index = new WorkspaceIndex({ context: { model: indexedModel, runtimeRoot: "/runtime" }, adapters });

    await expect(index.search("hello")).resolves.toMatchObject({ provider: "qmd" });
    await expect(index.rebuild()).resolves.toMatchObject({ status: { backend: "qmd" } });
  });
});
