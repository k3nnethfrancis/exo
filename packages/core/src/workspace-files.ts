import { realpath } from "node:fs/promises";
import path from "node:path";

const OUTSIDE_NOTE_ROOTS_MESSAGE = "Refusing to access a path outside configured note roots.";

export class WorkspaceFiles {
  private readonly noteRoots: string[];

  constructor(noteRoots: readonly string[]) {
    this.noteRoots = noteRoots.map((rootPath) => path.resolve(rootPath));
  }

  async existing(targetPath: string): Promise<string> {
    const resolvedPath = this.absolutePath(targetPath);
    const candidateRoots = this.candidateRoots(resolvedPath);
    const canonicalPath = await realpath(resolvedPath);
    await assertWithinCanonicalRoot(candidateRoots, canonicalPath);
    return resolvedPath;
  }

  async writable(targetPath: string): Promise<string> {
    const resolvedPath = this.absolutePath(targetPath);
    if (this.noteRoots.includes(resolvedPath)) {
      throw new Error("Refusing to mutate a configured note root itself.");
    }
    const candidateRoots = this.candidateRoots(resolvedPath);
    const canonicalAncestor = await nearestExistingRealPath(resolvedPath);
    await assertWithinCanonicalRoot(candidateRoots, canonicalAncestor);
    return resolvedPath;
  }

  private candidateRoots(targetPath: string): string[] {
    const candidateRoots = this.noteRoots.filter((rootPath) => isPathWithin(rootPath, targetPath));
    if (candidateRoots.length === 0) {
      throw new Error(OUTSIDE_NOTE_ROOTS_MESSAGE);
    }
    return candidateRoots;
  }

  private absolutePath(targetPath: string): string {
    if (!path.isAbsolute(targetPath)) {
      throw new Error("Workspace paths must be absolute.");
    }
    return path.resolve(targetPath);
  }
}

async function assertWithinCanonicalRoot(rootPaths: readonly string[], canonicalPath: string): Promise<void> {
  for (const rootPath of rootPaths) {
    try {
      if (isPathWithin(await realpath(rootPath), canonicalPath)) {
        return;
      }
    } catch (error) {
      if (!isMissingPathError(error)) {
        throw error;
      }
    }
  }
  throw new Error(OUTSIDE_NOTE_ROOTS_MESSAGE);
}

async function nearestExistingRealPath(targetPath: string): Promise<string> {
  let candidatePath = targetPath;
  while (true) {
    try {
      return await realpath(candidatePath);
    } catch (error) {
      if (!isMissingPathError(error)) {
        throw error;
      }
      const parentPath = path.dirname(candidatePath);
      if (parentPath === candidatePath) {
        throw error;
      }
      candidatePath = parentPath;
    }
  }
}

function isMissingPathError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error && (error.code === "ENOENT" || error.code === "ENOTDIR");
}

function isPathWithin(parentPath: string, candidatePath: string): boolean {
  const relativePath = path.relative(parentPath, candidatePath);
  return relativePath === "" || (!relativePath.startsWith("..") && !path.isAbsolute(relativePath));
}
