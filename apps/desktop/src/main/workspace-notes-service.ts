import { access, readdir, realpath, stat } from "node:fs/promises";
import { constants } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

import {
  createWorkspaceFile,
  listFiles,
  listMarkdownFiles,
  readWorkspaceDocument,
  type SearchResult,
  type FolderOverview,
  type GraphConceptDetail,
  type GraphViewBundle,
  type WorkspaceSearchResults,
  WorkspaceFiles,
  WorkspaceGraph,
  type WorkspaceGraphContext,
  type WorkspaceModel,
} from "@exo/core";
import type { WorkspaceChangeEvent } from "./workspace-watchers";
import type { DerivedIndexClient } from "./derived-index-process";

export interface WorkspaceNotesServiceOptions {
  getWorkspaceModel: () => WorkspaceModel;
  getRuntimeRoot?: () => string;
  derivedIndex?: DerivedIndexClient;
}

export class WorkspaceNotesService {
  private graph: WorkspaceGraph | null = null;
  private graphModelKey: string | null = null;
  private readonly folderOverviewCache = new Map<string, FolderOverview>();
  private noteFileCache: string[] | null = null;
  private readonly imageFileCache = new Map<string, Promise<string[]>>();

  constructor(private readonly options: WorkspaceNotesServiceOptions) {}

  invalidateDerivedState(): void {
    this.graph?.invalidate();
    if (this.options.derivedIndex && this.options.getRuntimeRoot) {
      void this.options.derivedIndex
        .graphInvalidate(this.options.getWorkspaceModel(), this.options.getRuntimeRoot())
        .catch((error) => console.warn("[exo] derived graph invalidation failed", error));
    }
    this.folderOverviewCache.clear();
    this.noteFileCache = null;
    this.imageFileCache.clear();
  }

  async handleWorkspaceChange(event: WorkspaceChangeEvent): Promise<void> {
    if (!event.filePath) {
      this.folderOverviewCache.clear();
      this.noteFileCache = null;
      this.imageFileCache.clear();
      if (this.options.derivedIndex && this.options.getRuntimeRoot) {
        await this.options.derivedIndex.graphInvalidate(this.options.getWorkspaceModel(), this.options.getRuntimeRoot());
      } else {
        this.graph?.invalidate();
      }
      return;
    }

    const changedPath = path.resolve(event.filePath);
    this.invalidateFolderOverviewsForPath(changedPath);
    this.noteFileCache = null;
    this.imageFileCache.clear();
    if (/\.md$/i.test(changedPath)) {
      if (this.options.derivedIndex && this.options.getRuntimeRoot) {
        await this.options.derivedIndex.graphRefresh(this.options.getWorkspaceModel(), this.options.getRuntimeRoot(), changedPath);
      } else {
        await this.graph?.refreshFile(changedPath);
      }
    }
  }

  async searchFilenames(query: string): Promise<WorkspaceSearchResults> {
    const normalizedQuery = query.trim().toLowerCase();
    if (!normalizedQuery) {
      return { notes: [], tags: [] };
    }

    const model = this.options.getWorkspaceModel();
    const files = this.noteFileCache ?? await listMarkdownFiles(this.noteRootPaths());
    this.noteFileCache = files;
    const notes = files
      .map((filePath) => {
        const root = model.noteRoots.find((candidate) => isPathWithin(candidate.path, filePath));
        const relativePath = root ? path.relative(root.path, filePath) : path.basename(filePath);
        const title = path.basename(filePath, path.extname(filePath));
        const normalizedTitle = title.toLowerCase();
        const normalizedPath = relativePath.toLowerCase();
        if (!normalizedTitle.includes(normalizedQuery) && !normalizedPath.includes(normalizedQuery)) {
          return null;
        }
        return {
          filePath,
          title,
          snippet: relativePath,
          kind: "note" as const,
          rank: normalizedTitle === normalizedQuery ? 0 : normalizedTitle.startsWith(normalizedQuery) ? 1 : 2,
        };
      })
      .filter((entry): entry is NonNullable<typeof entry> => entry !== null)
      .sort((left, right) => left.rank - right.rank || left.snippet.localeCompare(right.snippet))
      .slice(0, 30)
      .map(({ rank: _rank, ...result }) => result);

    return { notes, tags: [] };
  }

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

  /**
   * Produces a renderer-safe URL for an attachment referenced by a Markdown
   * note. The renderer never turns a Markdown target into a file URL itself:
   * this method verifies both source and target through WorkspaceFiles first.
   */
  async resolveMarkdownImage(sourceFilePath: string, target: string, lookupByFilename = false): Promise<{ url: string }> {
    const files = this.workspaceFiles();
    const sourcePath = await files.existing(sourceFilePath);
    const normalizedTarget = normalizeMarkdownImageTarget(target);
    const imagePath = await this.resolveMarkdownImagePath(files, sourcePath, normalizedTarget, lookupByFilename);
    // Point the renderer at the canonical path that WorkspaceFiles authorized,
    // rather than leaving a later file: load to follow a mutable symlink.
    const canonicalImagePath = await realpath(imagePath);
    const fileStat = await stat(canonicalImagePath);
    if (!fileStat.isFile()) {
      throw new Error("Markdown image target must be an existing file.");
    }
    return { url: pathToFileURL(canonicalImagePath).toString() };
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
    if (this.options.derivedIndex && this.options.getRuntimeRoot) {
      return this.options.derivedIndex.graphContext(
        this.options.getWorkspaceModel(),
        this.options.getRuntimeRoot(),
        authorizedPath,
      );
    }
    return this.workspaceGraph().contextForNote(authorizedPath);
  }

  async getGraphView(profileId?: string | null): Promise<GraphViewBundle> {
    if (this.options.derivedIndex && this.options.getRuntimeRoot) {
      return this.options.derivedIndex.graphView(
        this.options.getWorkspaceModel(),
        this.options.getRuntimeRoot(),
        profileId,
      );
    }
    return this.workspaceGraph().graphView(profileId);
  }

  async getGraphConceptDetail(conceptId: string, sourceSnapshotId: string, profileId?: string | null): Promise<GraphConceptDetail | null> {
    if (this.options.derivedIndex && this.options.getRuntimeRoot) {
      return this.options.derivedIndex.graphConceptDetail(
        this.options.getWorkspaceModel(),
        this.options.getRuntimeRoot(),
        conceptId,
        sourceSnapshotId,
        profileId,
      );
    }
    return this.workspaceGraph().graphConceptDetail(conceptId, sourceSnapshotId, profileId);
  }

  async getFolderOverview(directoryPath: string): Promise<FolderOverview> {
    const files = this.workspaceFiles();
    const authorizedDirectory = await files.existing(directoryPath);
    const cached = this.folderOverviewCache.get(authorizedDirectory);
    if (cached) {
      return cached;
    }
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

    const overview: FolderOverview = {
      directoryPath: authorizedDirectory,
      indexPath,
      title: indexDocument?.title || path.basename(authorizedDirectory),
      frontmatter: indexDocument?.frontmatter ?? {},
      indexExists,
      children,
      graphContext: null,
    };
    this.folderOverviewCache.set(authorizedDirectory, overview);
    return overview;
  }

  private workspaceGraph(): WorkspaceGraph {
    const model = this.options.getWorkspaceModel();
    const modelKey = model.noteRoots
      .map((root) => `${root.id}:${path.resolve(root.path)}`)
      .sort()
      .join("\n");
    if (!this.graph || this.graphModelKey !== modelKey) {
      this.graph = new WorkspaceGraph(model);
      this.graphModelKey = modelKey;
      this.folderOverviewCache.clear();
      this.noteFileCache = null;
    }
    return this.graph;
  }

  private invalidateFolderOverviewsForPath(changedPath: string): void {
    const parentPath = path.dirname(changedPath);
    for (const cachedPath of this.folderOverviewCache.keys()) {
      if (
        cachedPath === changedPath
        || cachedPath === parentPath
        || isPathWithin(changedPath, cachedPath)
      ) {
        this.folderOverviewCache.delete(cachedPath);
      }
    }
  }

  private noteRootPaths(): string[] {
    return this.options.getWorkspaceModel().noteRoots.map((root) => root.path);
  }

  private workspaceFiles(): WorkspaceFiles {
    return new WorkspaceFiles(this.noteRootPaths());
  }

  private async resolveMarkdownImagePath(files: WorkspaceFiles, sourcePath: string, target: string, lookupByFilename: boolean): Promise<string> {
    if (!target.startsWith("/")) {
      try {
        return await files.existing(path.resolve(path.dirname(sourcePath), target));
      } catch (error) {
        if (!lookupByFilename || target !== path.basename(target) || !isMissingPathError(error)) {
          throw error;
        }
        return this.resolveMarkdownImageByFilename(files, sourcePath, target);
      }
    }

    const sourceRoot = this.sourceNoteRoot(sourcePath);

    const relativeTarget = target.replace(/^\/+/, "");
    const noteRootCandidate = path.resolve(sourceRoot, relativeTarget);
    if (!isPathWithin(sourceRoot, noteRootCandidate)) {
      throw new Error("Refusing to access a path outside configured note roots.");
    }

    // Site-authored Markdown often uses `/images/...` relative to a content
    // tree nested inside the Note Root. Prefer the nearest source ancestor that
    // contains the target, while retaining the Note Root as the final fallback.
    let ancestorPath = path.dirname(sourcePath);
    let missingError: unknown;
    while (isPathWithin(sourceRoot, ancestorPath)) {
      try {
        const candidatePath = await files.existing(path.resolve(ancestorPath, relativeTarget));
        if ((await stat(await realpath(candidatePath))).isFile()) {
          return candidatePath;
        }
      } catch (error) {
        if (!isMissingPathError(error)) {
          throw error;
        }
        missingError = error;
      }
      if (ancestorPath === sourceRoot) {
        break;
      }
      ancestorPath = path.dirname(ancestorPath);
    }
    throw missingError ?? new Error("Markdown image target does not exist.");
  }

  private sourceNoteRoot(sourcePath: string): string {
    const sourceRoot = this.options.getWorkspaceModel().noteRoots
      .map((root) => path.resolve(root.path))
      .filter((rootPath) => isPathWithin(rootPath, sourcePath))
      .sort((left, right) => right.length - left.length)[0];
    if (!sourceRoot) {
      throw new Error("Source note is outside configured note roots.");
    }
    return sourceRoot;
  }

  private async resolveMarkdownImageByFilename(files: WorkspaceFiles, sourcePath: string, target: string): Promise<string> {
    const sourceDirectory = path.dirname(sourcePath);
    const candidates = (await this.imageFilesInRoot(this.sourceNoteRoot(sourcePath)))
      .filter((candidatePath) => path.basename(candidatePath) === target)
      .sort((left, right) => imageSearchDistance(sourceDirectory, left) - imageSearchDistance(sourceDirectory, right));

    for (const candidate of candidates) {
      try {
        const authorizedPath = await files.existing(candidate);
        if ((await stat(await realpath(authorizedPath))).isFile()) {
          return authorizedPath;
        }
      } catch {
        // Ignore stale or symlinked-outside candidates and continue looking
        // within the configured Note Root.
      }
    }
    throw new Error(`Markdown image target does not exist: ${target}`);
  }

  private imageFilesInRoot(rootPath: string): Promise<string[]> {
    const cached = this.imageFileCache.get(rootPath);
    if (cached) {
      return cached;
    }
    const files = listFiles([rootPath]);
    this.imageFileCache.set(rootPath, files);
    return files;
  }
}

function normalizeMarkdownImageTarget(target: string): string {
  const normalized = target.trim();
  if (!normalized) {
    throw new Error("Markdown image target cannot be empty.");
  }
  if (/^[a-z][a-z0-9+.-]*:/i.test(normalized) || normalized.startsWith("//")) {
    throw new Error("Remote Markdown images are not enabled in this workspace.");
  }
  try {
    return decodeURIComponent(normalized);
  } catch {
    throw new Error("Markdown image target has invalid URL encoding.");
  }
}

function isMissingPathError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error && (error.code === "ENOENT" || error.code === "ENOTDIR");
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

function imageSearchDistance(sourceDirectory: string, candidatePath: string): number {
  const segments = path.relative(sourceDirectory, candidatePath).split(path.sep);
  return segments.filter((segment) => segment === "..").length * 1_000 + segments.length;
}
