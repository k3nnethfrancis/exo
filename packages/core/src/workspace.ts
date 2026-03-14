import { access, readdir, readFile } from "node:fs/promises";
import { constants } from "node:fs";
import path from "node:path";

import type { AttachedRoot, SearchResult, TreeNode, WorkspaceModel, WorkspaceSearchResults } from "./types";
import { readWorkspaceDocument } from "./notes";

const DEFAULT_WORKSPACE_ROOT = "/Users/kenneth/Desktop/lab";
const DEFAULT_NOTE_ROOT = "/Users/kenneth/Desktop/lab/notes/shoshin-codex";
const DEFAULT_PROJECT_ROOT = "/Users/kenneth/Desktop/lab/projects";

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
  const workspaceRoot = env.EXO_WORKSPACE_ROOT ?? DEFAULT_WORKSPACE_ROOT;
  const defaultTerminalCwd = env.EXO_DEFAULT_TERMINAL_CWD ?? workspaceRoot;
  const noteRootCandidates = (env.EXO_NOTE_ROOTS ?? DEFAULT_NOTE_ROOT).split(path.delimiter).filter(Boolean);
  const projectRootCandidates = (env.EXO_PROJECT_ROOTS ?? DEFAULT_PROJECT_ROOT).split(path.delimiter).filter(Boolean);

  return {
    workspaceRoot,
    defaultTerminalCwd,
    noteRoots: noteRootCandidates.map((targetPath, index) =>
      attachedRoot(`note-root-${index + 1}`, path.basename(targetPath), targetPath, "notes"),
    ),
    projectRoots: projectRootCandidates.map((targetPath, index) =>
      attachedRoot(`project-root-${index + 1}`, path.basename(targetPath), targetPath, "projects"),
    ),
    attachedWorkcells: [],
  };
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
    .filter((entry) => !entry.name.startsWith("."))
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

  const noteFiles = await listMarkdownFiles(model.noteRoots.map((root) => root.path));
  const results: Array<SearchResult | null> = await Promise.all(
    noteFiles.map(async (filePath) => {
      const document = await readWorkspaceDocument(filePath);
      const haystack = `${document.title}\n${document.body}`.toLowerCase();
      if (!haystack.includes(trimmedQuery)) {
        return null;
      }

      const snippetSource = document.body.replace(/\s+/g, " ");
      const matchIndex = snippetSource.toLowerCase().indexOf(trimmedQuery);
      const snippet =
        matchIndex >= 0
          ? snippetSource.slice(Math.max(0, matchIndex - 30), Math.min(snippetSource.length, matchIndex + 90))
          : snippetSource.slice(0, 120);

      return {
        filePath,
        title: document.title,
        snippet,
        kind: "note" as const,
      };
    }),
  );

  return results.filter(isSearchResult).slice(0, 30);
}

export async function searchProjectFiles(model: WorkspaceModel, query: string): Promise<SearchResult[]> {
  const trimmedQuery = query.trim().toLowerCase();
  if (!trimmedQuery) {
    return [];
  }

  const files = await listFiles(model.projectRoots.map((root) => root.path));
  const results: Array<SearchResult | null> = await Promise.all(
    files.map(async (filePath) => {
      const normalizedPath = filePath.toLowerCase();
      let snippet = path.relative(model.workspaceRoot, filePath);
      let matches = normalizedPath.includes(trimmedQuery);

      if (!matches && isTextLikeFile(filePath)) {
        const preview = await loadFilePreview(filePath).catch(() => "");
        if (preview.toLowerCase().includes(trimmedQuery)) {
          matches = true;
          const compactPreview = preview.replace(/\s+/g, " ");
          const matchIndex = compactPreview.toLowerCase().indexOf(trimmedQuery);
          snippet =
            matchIndex >= 0
              ? compactPreview.slice(Math.max(0, matchIndex - 30), Math.min(compactPreview.length, matchIndex + 90))
              : compactPreview.slice(0, 120);
        }
      }

      if (!matches) {
        return null;
      }

      return {
        filePath,
        title: path.basename(filePath),
        snippet,
        kind: "project-file" as const,
      };
    }),
  );

  return results.filter(isSearchResult).slice(0, 40);
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
      const rawTags = Array.isArray(document.frontmatter.tags)
        ? document.frontmatter.tags.filter((entry): entry is string => typeof entry === "string")
        : typeof document.frontmatter.tags === "string"
          ? document.frontmatter.tags.split(/[,\s]+/)
          : [];
      const matchingTag = rawTags
        .map((entry) => entry.replace(/^#/, ""))
        .find((entry) => entry.toLowerCase().includes(trimmedQuery))
        ?? Array.from(document.body.matchAll(/(^|\s)#([a-zA-Z0-9/_-]+)/g))
          .map((match) => match[2])
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
  const [notes, projectFiles, tags] = await Promise.all([
    searchNotes(model, query),
    searchProjectFiles(model, query),
    searchTags(model, query),
  ]);

  return {
    notes,
    projectFiles,
    tags,
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
