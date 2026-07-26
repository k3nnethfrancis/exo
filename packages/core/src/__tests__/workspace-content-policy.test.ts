import { describe, expect, it } from "vitest";

import {
  defaultWorkspaceContentPolicy,
  isWorkspaceContentExcluded,
  normalizeWorkspaceContentPolicy,
  repositoryWorkspaceContentPolicy,
} from "../workspace-content-policy";

describe("workspace content policy", () => {
  it("keeps generic Markdown workspaces unconstrained by default", () => {
    expect(defaultWorkspaceContentPolicy()).toEqual({ excludedPaths: [], sourceVisibility: false });
    expect(isWorkspaceContentExcluded("garden/release-notes.md", defaultWorkspaceContentPolicy())).toBe(false);
  });

  it("keeps common repository artifacts out of content scope without excluding nearby docs", () => {
    const policy = repositoryWorkspaceContentPolicy();

    expect(isWorkspaceContentExcluded("release/mac-arm64/Exo.app/Contents/info.md", policy)).toBe(true);
    expect(isWorkspaceContentExcluded("packages/core/node_modules/package/readme.md", policy)).toBe(true);
    expect(isWorkspaceContentExcluded("docs/release-notes.md", policy)).toBe(false);
  });

  it("normalizes only explicit user exclusions and preserves source visibility", () => {
    expect(normalizeWorkspaceContentPolicy({
      excludedPaths: [" ./release/** ", "release/**", 4],
      sourceVisibility: true,
    })).toEqual({ excludedPaths: ["release/**"], sourceVisibility: true });
  });
});
