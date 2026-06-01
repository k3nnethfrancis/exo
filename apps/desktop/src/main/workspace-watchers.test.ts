import { describe, expect, it } from "vitest";

import { shouldIgnoreWorkspaceChange } from "./workspace-watchers";

describe("workspace watcher filtering", () => {
  const rootPath = "/workspace/exo";

  it("keeps source and note changes visible to the workspace", () => {
    expect(shouldIgnoreWorkspaceChange(rootPath, "/workspace/exo/src/App.tsx")).toBe(false);
    expect(shouldIgnoreWorkspaceChange(rootPath, "/workspace/exo/docs/issues.md")).toBe(false);
    expect(shouldIgnoreWorkspaceChange(rootPath, null)).toBe(false);
  });

  it("drops noisy generated and vendor changes before they churn the renderer", () => {
    expect(shouldIgnoreWorkspaceChange(rootPath, "/workspace/exo/.git/index")).toBe(true);
    expect(shouldIgnoreWorkspaceChange(rootPath, "/workspace/exo/node_modules/.vite/deps.ts")).toBe(true);
    expect(shouldIgnoreWorkspaceChange(rootPath, "/workspace/exo/.exo/server.json")).toBe(true);
    expect(shouldIgnoreWorkspaceChange(rootPath, "/workspace/exo/dist/index.js")).toBe(true);
    expect(shouldIgnoreWorkspaceChange(rootPath, "/workspace/exo/coverage/index.html")).toBe(true);
  });
});
