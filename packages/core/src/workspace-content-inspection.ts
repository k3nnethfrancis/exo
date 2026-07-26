import { readdir } from "node:fs/promises";

import {
  defaultWorkspaceContentPolicy,
  repositoryWorkspaceContentPolicy,
  type WorkspaceContentPolicy,
} from "./workspace-content-policy";

/**
 * A deliberately small, read-only classification used during setup. It does
 * not infer what a user means by their notes; it only distinguishes an
 * ordinary Markdown folder from a folder that visibly contains a code repo.
 */
export interface WorkspaceContentInspection {
  kind: "markdown" | "repository";
  signals: string[];
  recommendedPolicy: WorkspaceContentPolicy;
}

const REPOSITORY_MARKERS = new Map<string, string>([
  [".git", "Git"],
  ["package.json", "Node"],
  ["pnpm-workspace.yaml", "pnpm"],
  ["tsconfig.json", "TypeScript"],
  ["pyproject.toml", "Python"],
  ["Cargo.toml", "Rust"],
  ["go.mod", "Go"],
]);

export async function inspectWorkspaceContent(rootPath: string): Promise<WorkspaceContentInspection> {
  const entries = await readdir(rootPath, { withFileTypes: true });
  const names = new Set(entries.map((entry) => entry.name));
  const signals = [...REPOSITORY_MARKERS]
    .filter(([marker]) => names.has(marker))
    .map(([, label]) => label);

  return signals.length > 0
    ? { kind: "repository", signals, recommendedPolicy: repositoryWorkspaceContentPolicy() }
    : { kind: "markdown", signals: [], recommendedPolicy: defaultWorkspaceContentPolicy() };
}
