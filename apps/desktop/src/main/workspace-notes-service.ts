import { access } from "node:fs/promises";
import { constants } from "node:fs";
import path from "node:path";

import {
  createWorkspaceFile,
  getBranchFamily,
  getNoteKnowledge,
  listMarkdownFiles,
  readWorkspaceDocument,
  type WorkspaceModel,
} from "@exo/core";

export interface WorkspaceNotesServiceOptions {
  getWorkspaceModel: () => WorkspaceModel;
}

export class WorkspaceNotesService {
  constructor(private readonly options: WorkspaceNotesServiceOptions) {}

  async resolveTarget(sourceFilePath: string, target: string): Promise<string | null> {
    if (/^https?:\/\//.test(target)) {
      return null;
    }

    const relativeCandidate = target.endsWith(".md")
      ? path.resolve(path.dirname(sourceFilePath), target)
      : path.resolve(path.dirname(sourceFilePath), `${target}.md`);

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
    const normalizedTarget = target.replace(/^\/+/, "").replace(/\.md$/i, "");
    const nextPath = normalizedTarget.includes("/")
      ? path.join(noteRoot?.path ?? path.dirname(sourceFilePath), `${normalizedTarget}.md`)
      : path.join(path.dirname(sourceFilePath), `${normalizedTarget}.md`);

    await createWorkspaceFile(nextPath, "");
    return nextPath;
  }

  async suggestTargets(sourceFilePath: string, query: string) {
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

  getKnowledge(filePath: string) {
    return getNoteKnowledge(filePath, this.noteRootPaths());
  }

  getBranchFamily(filePath: string) {
    return getBranchFamily(filePath, this.noteRootPaths());
  }

  private noteRootPaths(): string[] {
    return this.options.getWorkspaceModel().noteRoots.map((root) => root.path);
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
