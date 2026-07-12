import { access, readdir } from "node:fs/promises";
import { constants } from "node:fs";
import path from "node:path";

import {
  createWorkspaceFile,
  listMarkdownFiles,
  readWorkspaceDocument,
  type SearchResult,
  type FolderOverview,
  WorkspaceFiles,
  WorkspaceGraph,
  type WorkspaceGraphContext,
  type WorkspaceModel,
} from "@exo/core";

export interface WorkspaceNotesServiceOptions {
  getWorkspaceModel: () => WorkspaceModel;
}

export class WorkspaceNotesService {
  constructor(private readonly options: WorkspaceNotesServiceOptions) {}

  async searchTag(tag: string): Promise<SearchResult[]> {
    const normalized = tag.replace(/^#/, "");
    const files = await listMarkdownFiles(this.noteRootPaths());
    const results: Array<SearchResult | null> = await Promise.all(
      files.map(async (filePath) => {
        const document = await readWorkspaceDocument(filePath);
        const rawTags = Array.isArray(document.frontmatter.tags)
          ? document.frontmatter.tags.filter((entry): entry is string => typeof entry === "string")
          : typeof document.frontmatter.tags === "string"
            ? document.frontmatter.tags.split(/[,\s]+/)
            : [];
        const bodyIncludes = document.body.toLowerCase().includes(`#${normalized.toLowerCase()}`);
        const frontmatterIncludes = rawTags.some((entry) => entry.replace(/^#/, "").toLowerCase() === normalized.toLowerCase());
        if (!bodyIncludes && !frontmatterIncludes) {
          return null;
        }

        return {
          filePath,
          title: document.title,
          snippet: `#${normalized}`,
          kind: "tag" as const,
        };
      }),
    );

    return results.filter((entry): entry is SearchResult => entry !== null);
  }

  async resolveTarget(sourceFilePath: string, target: string): Promise<string | null> {
    const files = this.workspaceFiles();
    await files.existing(sourceFilePath);
    if (/^https?:\/\//.test(target)) {
      return null;
    }

    const relativeCandidate = target.endsWith(".md")
      ? path.resolve(path.dirname(sourceFilePath), target)
      : path.resolve(path.dirname(sourceFilePath), `${target}.md`);
    await files.writable(relativeCandidate);

    if (await fileExists(relativeCandidate)) {
      return relativeCandidate;
    }

    const normalizedTarget = path.basename(target, ".md").toLowerCase();
    const noteFiles = await listMarkdownFiles(this.noteRootPaths());
    return noteFiles.find((filePath) => path.basename(filePath, ".md").toLowerCase() === normalizedTarget) ?? null;
  }

  async ensureTarget(sourceFilePath: string, target: string): Promise<string> {
    const resolved = await this.resolveTarget(sourceFilePath, target);
    if (resolved) {
      return resolved;
    }

    const noteRoot = this.options.getWorkspaceModel().noteRoots.find((root) => isPathWithin(root.path, sourceFilePath));
    const normalizedTarget = target.replace(/\.md$/i, "");
    const targetWithExtension = `${normalizedTarget}.md`;
    const nextPath = path.isAbsolute(targetWithExtension)
      ? path.resolve(targetWithExtension)
      : normalizedTarget.includes("/")
        ? path.join(noteRoot?.path ?? path.dirname(sourceFilePath), targetWithExtension)
        : path.join(path.dirname(sourceFilePath), targetWithExtension);

    const authorizedPath = await this.workspaceFiles().writable(nextPath);
    await createWorkspaceFile(authorizedPath);
    return authorizedPath;
  }

  async suggestTargets(sourceFilePath: string, query: string) {
    await this.workspaceFiles().existing(sourceFilePath);
    const trimmedQuery = query.trim().toLowerCase();
    if (!trimmedQuery) {
      return [];
    }

    const model = this.options.getWorkspaceModel();
    const sourceRoot = model.noteRoots.find((root) => isPathWithin(root.path, sourceFilePath));
    const noteFiles = await listMarkdownFiles(this.noteRootPaths());
    const suggestions = noteFiles
      .map((filePath) => {
        const rootPath = model.noteRoots.find((root) => isPathWithin(root.path, filePath))?.path ?? sourceRoot?.path;
        const relativePath = rootPath ? path.relative(rootPath, filePath) : path.basename(filePath);
        const relativeWithoutExtension = relativePath.replace(/\.md$/i, "");
        const title = path.basename(filePath, ".md");
        const haystack = `${title}\n${relativeWithoutExtension}`.toLowerCase();
        if (!haystack.includes(trimmedQuery)) {
          return null;
        }

        return {
          filePath,
          title,
          target: relativeWithoutExtension,
          snippet: relativeWithoutExtension,
        };
      })
      .filter((entry): entry is { filePath: string; title: string; target: string; snippet: string } => entry !== null)
      .slice(0, 20);

    suggestions.sort((left, right) => {
      const leftExact = left.title.toLowerCase() === trimmedQuery || left.target.toLowerCase() === trimmedQuery;
      const rightExact = right.title.toLowerCase() === trimmedQuery || right.target.toLowerCase() === trimmedQuery;
      if (leftExact !== rightExact) {
        return leftExact ? -1 : 1;
      }
      return left.target.localeCompare(right.target);
    });

    return suggestions;
  }

  async getGraphContext(filePath: string): Promise<WorkspaceGraphContext | null> {
    const authorizedPath = await this.workspaceFiles().existing(filePath);
    return new WorkspaceGraph(this.options.getWorkspaceModel()).contextForNote(authorizedPath);
  }

  async getFolderOverview(directoryPath: string): Promise<FolderOverview> {
    const files = this.workspaceFiles();
    const authorizedDirectory = await files.existing(directoryPath);
    const indexPath = path.join(authorizedDirectory, "index.md");
    const indexExists = await fileExists(indexPath);
    const indexDocument = indexExists ? await readWorkspaceDocument(indexPath) : null;
    const entries = await readdir(authorizedDirectory, { withFileTypes: true });
    const children = entries
      .filter((entry) => entry.isDirectory() || (entry.isFile() && entry.name.endsWith(".md") && entry.name !== "index.md"))
      .sort((left, right) => {
        if (left.isDirectory() !== right.isDirectory()) return left.isDirectory() ? -1 : 1;
        return left.name.localeCompare(right.name);
      })
      .map((entry) => ({ path: path.join(authorizedDirectory, entry.name), name: entry.name, kind: entry.isDirectory() ? "directory" as const : "file" as const }));

    return {
      directoryPath: authorizedDirectory,
      indexPath,
      title: indexDocument?.title || path.basename(authorizedDirectory),
      frontmatter: indexDocument?.frontmatter ?? {},
      indexExists,
      children,
      graphContext: indexDocument ? await new WorkspaceGraph(this.options.getWorkspaceModel()).contextForNote(indexPath) : null,
    };
  }

  private noteRootPaths(): string[] {
    return this.options.getWorkspaceModel().noteRoots.map((root) => root.path);
  }

  private workspaceFiles(): WorkspaceFiles {
    return new WorkspaceFiles(this.noteRootPaths());
  }
}

async function fileExists(targetPath: string): Promise<boolean> {
  return access(targetPath, constants.F_OK).then(
    () => true,
    () => false,
  );
}

function isPathWithin(parentPath: string, candidatePath: string): boolean {
  const relativePath = path.relative(parentPath, candidatePath);
  return relativePath === "" || (!relativePath.startsWith("..") && !path.isAbsolute(relativePath));
}
