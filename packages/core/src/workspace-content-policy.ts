/**
 * User-owned scope for Markdown content in one Workspace.
 *
 * This does not grant filesystem authority: Note Roots remain that boundary.
 * It only decides which paths beneath an authorized root become visible Notes,
 * QMD documents, and graph concepts.
 */
export interface WorkspaceContentPolicy {
  excludedPaths: string[];
  sourceVisibility: boolean;
}

export const REPOSITORY_CONTENT_EXCLUSIONS = [
  ".git/**", ".stem/**", ".next/**", ".nuxt/**", ".pnpm-store/**",
  ".turbo/**", ".venv/**", "__pycache__/**", "artifacts/**", "build/**",
  "coverage/**", "dist/**", "node_modules/**", "out/**", "release/**",
  "target/**", "tmp/**", "vendor/**",
] as const;

export function defaultWorkspaceContentPolicy(): WorkspaceContentPolicy {
  return { excludedPaths: [], sourceVisibility: false };
}

export function repositoryWorkspaceContentPolicy(): WorkspaceContentPolicy {
  return { excludedPaths: [...REPOSITORY_CONTENT_EXCLUSIONS], sourceVisibility: false };
}

export function normalizeWorkspaceContentPolicy(value: unknown): WorkspaceContentPolicy {
  if (!value || typeof value !== "object") return defaultWorkspaceContentPolicy();
  const candidate = value as Partial<WorkspaceContentPolicy>;
  return {
    excludedPaths: Array.isArray(candidate.excludedPaths)
      ? [...new Set(candidate.excludedPaths
        .filter((entry): entry is string => typeof entry === "string")
        .map(normalizePattern)
        .filter(Boolean))]
      : [],
    sourceVisibility: candidate.sourceVisibility === true,
  };
}

/** True when a path relative to a Note Root is deliberately outside content scope. */
export function isWorkspaceContentExcluded(relativePath: string, policy: WorkspaceContentPolicy): boolean {
  const normalized = normalizeRelativePath(relativePath);
  return policy.excludedPaths.some((pattern) => matchesExcludedPath(normalized, pattern));
}

function normalizePattern(value: string): string {
  return value.trim().replaceAll("\\", "/").replace(/^\.\//, "").replace(/^\/+/, "");
}

function normalizeRelativePath(value: string): string {
  return value.replaceAll("\\", "/").replace(/^\.\//, "").replace(/^\/+/, "");
}

function matchesExcludedPath(relativePath: string, pattern: string): boolean {
  const prefix = pattern.endsWith("/**") ? pattern.slice(0, -3) : pattern;
  if (!prefix) return false;
  const pathSegments = relativePath.split("/");
  const prefixSegments = prefix.split("/");
  if (prefixSegments.length === 1) return pathSegments.includes(prefixSegments[0]);
  return relativePath === prefix || relativePath.startsWith(`${prefix}/`);
}
