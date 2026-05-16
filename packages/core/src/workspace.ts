import { access, mkdir, readdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { constants, existsSync, readFileSync } from "node:fs";
import path from "node:path";

import type {
  AttachedRoot,
  IndexedRoot,
  IndexingConfig,
  SearchResult,
  TreeNode,
  WorkspaceModel,
  WorkspaceSearchResults,
} from "./types";
import { readWorkspaceDocument } from "./notes";

const SEARCH_RESULT_LIMIT = 30;
const PROJECT_SEARCH_RESULT_LIMIT = 25;
const MAX_SEARCH_VISITED_ENTRIES = 20_000;
export const DEFAULT_INDEX_PATTERN = "**/*.md";
export const DEFAULT_INDEXING: IndexingConfig = {
  enabled: false,
  mode: "off",
  backend: "qmd",
};
const IGNORED_DIRECTORY_NAMES = new Set([
  ".git",
  ".next",
  ".nuxt",
  ".turbo",
  ".venv",
  "__pycache__",
  "build",
  "coverage",
  "dist",
  "node_modules",
  "site-packages",
  "target",
  "venv",
]);

function pathExists(targetPath: string): Promise<boolean> {
  return access(targetPath, constants.F_OK).then(
    () => true,
    () => false,
  );
}

function attachedRoot(id: string, label: string, targetPath: string, kind: AttachedRoot["kind"]): AttachedRoot {
  return { id, label, path: targetPath, kind };
}

export function resolveWorkspaceModel(env: NodeJS.ProcessEnv = process.env): WorkspaceModel {
  const workspaceRoot = env.EXO_WORKSPACE_ROOT ?? process.cwd();
  const defaultTerminalCwd = env.EXO_DEFAULT_TERMINAL_CWD ?? workspaceRoot;
  const noteRootCandidates = (env.EXO_NOTE_ROOTS ?? path.join(workspaceRoot, "notes")).split(path.delimiter).filter(Boolean);
  const projectRootCandidates =
    env.EXO_PROJECT_ROOTS !== undefined
      ? env.EXO_PROJECT_ROOTS.split(path.delimiter).filter(Boolean)
      : defaultProjectRoots(workspaceRoot);
  const indexedRoots = parseIndexedRoots(env.EXO_INDEXED_ROOTS);
  const indexing = parseIndexingConfig(env);

  return {
    workspaceRoot,
    defaultTerminalCwd,
    noteRoots: noteRootCandidates.map((targetPath, index) =>
      attachedRoot(`note-root-${index + 1}`, path.basename(targetPath), targetPath, "notes"),
    ),
    projectRoots: projectRootCandidates.map((targetPath, index) =>
      attachedRoot(`project-root-${index + 1}`, path.basename(targetPath), targetPath, "projects"),
    ),
    indexedRoots,
    indexing,
    attachedWorkcells: [],
  };
}

export function createIndexedRoot(
  targetPath: string,
  options: Partial<Omit<IndexedRoot, "path" | "backend" | "ignore">> & { ignore?: string[] } = {},
): IndexedRoot {
  const resolvedPath = path.resolve(targetPath);
  const label = options.label?.trim() || path.basename(resolvedPath) || "root";
  return {
    id: options.id?.trim() || `index-${handelize(label)}`,
    label,
    path: resolvedPath,
    kind: options.kind ?? "mixed",
    pattern: options.pattern?.trim() || DEFAULT_INDEX_PATTERN,
    ignore: options.ignore ?? [],
    backend: "qmd",
  };
}

function parseIndexedRoots(rawValue?: string): IndexedRoot[] {
  if (!rawValue) {
    return [];
  }

  try {
    const parsed = JSON.parse(rawValue) as unknown;
    if (!Array.isArray(parsed)) {
      return [];
    }
    return parsed.map((entry, index) => normalizeIndexedRoot(entry, index)).filter(isIndexedRoot);
  } catch {
    return rawValue
      .split(path.delimiter)
      .filter(Boolean)
      .map((entry, index) => createIndexedRoot(entry, { id: `index-root-${index + 1}` }));
  }
}

function normalizeIndexedRoot(entry: unknown, index: number): IndexedRoot | null {
  if (!entry || typeof entry !== "object") {
    return null;
  }
  const candidate = entry as Partial<IndexedRoot>;
  if (typeof candidate.path !== "string" || !candidate.path.trim()) {
    return null;
  }
  return createIndexedRoot(candidate.path, {
    id: typeof candidate.id === "string" && candidate.id.trim() ? candidate.id : `index-root-${index + 1}`,
    label: typeof candidate.label === "string" ? candidate.label : undefined,
    kind: candidate.kind === "notes" || candidate.kind === "docs" || candidate.kind === "code" || candidate.kind === "mixed" ? candidate.kind : "mixed",
    pattern: typeof candidate.pattern === "string" ? candidate.pattern : DEFAULT_INDEX_PATTERN,
    ignore: Array.isArray(candidate.ignore) ? candidate.ignore.filter((item): item is string => typeof item === "string") : [],
  });
}

function isIndexedRoot(value: IndexedRoot | null): value is IndexedRoot {
  return value !== null;
}

function parseIndexingConfig(env: NodeJS.ProcessEnv): IndexingConfig {
  const mode = normalizeIndexMode(env.EXO_INDEX_MODE);
  return {
    enabled: env.EXO_INDEX_ENABLED === "1" || mode !== "off",
    mode,
    backend: "qmd",
  };
}

export function normalizeIndexMode(value: unknown): IndexingConfig["mode"] {
  return value === "lexical" || value === "semantic" || value === "hybrid" ? value : "off";
}

function handelize(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    || "root";
}

function defaultProjectRoots(workspaceRoot: string): string[] {
  const exoRoot = findExoRepoRoot(process.cwd()) ?? path.join(workspaceRoot, "projects", "exo");
  return [exoRoot];
}

function findExoRepoRoot(startPath: string): string | null {
  let currentPath = path.resolve(startPath);

  while (true) {
    const packagePath = path.join(currentPath, "package.json");
    if (existsSync(packagePath)) {
      try {
        const packageJson = JSON.parse(readFileSync(packagePath, "utf8")) as { name?: unknown };
        if (packageJson.name === "exo") {
          return currentPath;
        }
      } catch {
        // Keep walking upward; malformed package metadata should not block startup.
      }
    }

    const parentPath = path.dirname(currentPath);
    if (parentPath === currentPath) {
      return null;
    }
    currentPath = parentPath;
  }
}

export async function listRootTree(rootPath: string, options?: { markdownOnly?: boolean; maxDepth?: number }): Promise<TreeNode[]> {
  const maxDepth = options?.maxDepth ?? 4;
  return listTreeRecursive(rootPath, options?.markdownOnly ?? false, maxDepth, 0);
}

async function listTreeRecursive(rootPath: string, markdownOnly: boolean, maxDepth: number, depth: number): Promise<TreeNode[]> {
  if (!(await pathExists(rootPath))) {
    return [];
  }

  const entries = await readdir(rootPath, { withFileTypes: true });
  const visibleEntries = entries
    .filter((entry) => {
      if (!entry.name.startsWith(".")) {
        return true;
      }

      return !markdownOnly && entry.isFile() && entry.name !== ".DS_Store";
    })
    .filter((entry) => entry.name !== "node_modules" && entry.name !== ".git")
    .sort((left, right) => {
      if (left.isDirectory() === right.isDirectory()) {
        return left.name.localeCompare(right.name);
      }

      return left.isDirectory() ? -1 : 1;
    });

  const nodes = await Promise.all(
    visibleEntries.map(async (entry) => {
      const entryPath = path.join(rootPath, entry.name);

      if (entry.isDirectory()) {
        const children =
          depth >= maxDepth ? [] : await listTreeRecursive(entryPath, markdownOnly, maxDepth, depth + 1);

        if (markdownOnly && children.length === 0) {
          return null;
        }

        return {
          id: entryPath,
          name: entry.name,
          path: entryPath,
          kind: "directory" as const,
          children,
        };
      }

      if (markdownOnly && !entry.name.endsWith(".md")) {
        return null;
      }

      return {
        id: entryPath,
        name: entry.name,
        path: entryPath,
        kind: "file" as const,
      };
    }),
  );

  return nodes.reduce<TreeNode[]>((accumulator, node) => {
    if (node) {
      accumulator.push(node);
    }
    return accumulator;
  }, []);
}

export async function searchNotes(model: WorkspaceModel, query: string): Promise<SearchResult[]> {
  const trimmedQuery = query.trim().toLowerCase();
  if (!trimmedQuery) {
    return [];
  }

  const noteFiles = await findMatchingFiles(
    model.noteRoots.map((root) => root.path),
    (filePath) => {
      if (!/\.md(?:own)?$/i.test(filePath)) {
        return false;
      }
      const relativePath = path.relative(model.workspaceRoot, filePath);
      const title = path.basename(filePath, path.extname(filePath));
      return `${title}\n${relativePath}`.toLowerCase().includes(trimmedQuery);
    },
    SEARCH_RESULT_LIMIT,
  );
  const results = noteFiles.map<SearchResult>((filePath) => {
    const relativePath = path.relative(model.workspaceRoot, filePath);
    const title = path.basename(filePath, path.extname(filePath));
    return {
      filePath,
      title,
      snippet: relativePath,
      kind: "note" as const,
    };
  });

  return results.slice(0, SEARCH_RESULT_LIMIT);
}

export async function searchProjectFiles(model: WorkspaceModel, query: string): Promise<SearchResult[]> {
  const trimmedQuery = query.trim().toLowerCase();
  if (!trimmedQuery) {
    return [];
  }

  const files = await findMatchingFiles(
    model.projectRoots.map((root) => root.path),
    (filePath) => {
      if (!isTextLikeFile(filePath)) {
        return false;
      }
      return path.relative(model.workspaceRoot, filePath).toLowerCase().includes(trimmedQuery);
    },
    PROJECT_SEARCH_RESULT_LIMIT,
  );

  return files.map((filePath) => ({
    filePath,
    title: path.basename(filePath),
    snippet: path.relative(model.workspaceRoot, filePath),
    kind: "project-file" as const,
  }));
}

export async function searchTags(model: WorkspaceModel, query: string): Promise<SearchResult[]> {
  const trimmedQuery = query.trim().replace(/^#/, "").toLowerCase();
  if (!trimmedQuery) {
    return [];
  }

  const noteFiles = await listMarkdownFiles(model.noteRoots.map((root) => root.path));
  const results: Array<SearchResult | null> = await Promise.all(
    noteFiles.map(async (filePath) => {
        const document = await readWorkspaceDocument(filePath);
        const rawTags =
          Array.isArray(document.frontmatter.tags)
            ? document.frontmatter.tags.filter((entry: unknown): entry is string => typeof entry === "string")
            : typeof document.frontmatter.tags === "string"
              ? document.frontmatter.tags.split(/[,\s]+/)
              : [];
        const matchingTag = rawTags
          .map((entry) => entry.replace(/^#/, ""))
          .find((entry) => entry.toLowerCase().includes(trimmedQuery))
          ?? Array.from(document.body.matchAll(/(^|\s)#([a-zA-Z0-9/_-]+)/g))
            .map((match) => match[2] ?? "")
            .find((entry) => entry.toLowerCase().includes(trimmedQuery));

      if (!matchingTag) {
        return null;
      }

      return {
        filePath,
        title: document.title,
        snippet: `#${matchingTag}`,
        kind: "tag" as const,
      };
    }),
  );

  return results.filter(isSearchResult).slice(0, 30);
}

export async function searchWorkspace(model: WorkspaceModel, query: string): Promise<WorkspaceSearchResults> {
  const notes = await searchNotes(model, query);

  return {
    notes,
    projectFiles: [],
    tags: [],
  };
}

export async function listMarkdownFiles(rootPaths: string[]): Promise<string[]> {
  const files = await Promise.all(rootPaths.map((rootPath) => collectMarkdownFiles(rootPath)));
  return files.flat();
}

async function collectMarkdownFiles(rootPath: string): Promise<string[]> {
  const files = await collectFiles(rootPath, true);
  return files.filter((filePath) => filePath.endsWith(".md"));
}

async function collectFiles(rootPath: string, markdownOnly = false): Promise<string[]> {
  if (!(await pathExists(rootPath))) {
    return [];
  }

  const entries = await readdir(rootPath, { withFileTypes: true });
  const files = await Promise.all(
    entries
      .filter((entry) => !entry.name.startsWith("."))
      .filter((entry) => entry.name !== "node_modules" && entry.name !== ".git")
      .map(async (entry) => {
        const entryPath = path.join(rootPath, entry.name);
        if (entry.isDirectory()) {
          return collectFiles(entryPath, markdownOnly);
        }

        if (markdownOnly) {
          return entry.name.endsWith(".md") ? [entryPath] : [];
        }

        return [entryPath];
      }),
  );

  return files.flat();
}

export async function listFiles(rootPaths: string[]): Promise<string[]> {
  const files = await Promise.all(rootPaths.map((rootPath) => collectFiles(rootPath)));
  return files.flat();
}

async function findMatchingFiles(
  rootPaths: string[],
  matches: (filePath: string) => boolean,
  limit: number,
): Promise<string[]> {
  const results: string[] = [];
  let visited = 0;

  async function visit(directoryPath: string): Promise<void> {
    if (results.length >= limit || visited >= MAX_SEARCH_VISITED_ENTRIES || !(await pathExists(directoryPath))) {
      return;
    }

    let entries;
    try {
      entries = await readdir(directoryPath, { withFileTypes: true });
    } catch {
      return;
    }

    entries.sort((left, right) => {
      if (left.isDirectory() === right.isDirectory()) {
        return left.name.localeCompare(right.name);
      }
      return left.isDirectory() ? -1 : 1;
    });

    for (const entry of entries) {
      if (results.length >= limit || visited >= MAX_SEARCH_VISITED_ENTRIES) {
        return;
      }
      if (entry.name.startsWith(".")) {
        continue;
      }
      if (entry.isDirectory() && IGNORED_DIRECTORY_NAMES.has(entry.name)) {
        continue;
      }

      visited += 1;
      const entryPath = path.join(directoryPath, entry.name);
      if (entry.isDirectory()) {
        await visit(entryPath);
      } else if (matches(entryPath)) {
        results.push(entryPath);
      }
    }
  }

  for (const rootPath of rootPaths) {
    await visit(rootPath);
    if (results.length >= limit || visited >= MAX_SEARCH_VISITED_ENTRIES) {
      break;
    }
  }

  return results;
}

export async function createWorkspaceFile(targetPath: string, content = ""): Promise<string> {
  await mkdir(path.dirname(targetPath), { recursive: true });
  await writeFile(targetPath, content, "utf8");
  return targetPath;
}

export async function createWorkspaceDirectory(targetPath: string): Promise<string> {
  await mkdir(targetPath, { recursive: true });
  return targetPath;
}

export async function renameWorkspacePath(sourcePath: string, nextPath: string): Promise<string> {
  await mkdir(path.dirname(nextPath), { recursive: true });
  await rename(sourcePath, nextPath);
  return nextPath;
}

export async function deleteWorkspacePath(targetPath: string): Promise<void> {
  await rm(targetPath, { recursive: true, force: true });
}

export async function loadFilePreview(filePath: string): Promise<string> {
  const content = await readFile(filePath, "utf8");
  return content.slice(0, 400);
}

function isTextLikeFile(filePath: string): boolean {
  return /\.(?:md|markdown|txt|ts|tsx|js|jsx|json|py|swift|toml|ya?ml|css|html|sh|mjs|cjs)$/i.test(filePath);
}

function isSearchResult(value: SearchResult | null): value is SearchResult {
  return value !== null;
}
