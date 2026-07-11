import { mkdir, open, readdir, rm, stat } from "node:fs/promises";
import path from "node:path";

const FOLDER_INDEX_NAME = "index.md";
const IGNORED_FOLDER_NAMES = new Set([
  ".git",
  ".exo",
  ".exo-dev",
  ".next",
  ".nuxt",
  ".turbo",
  ".venv",
  "build",
  "coverage",
  "dist",
  "node_modules",
  "target",
]);

export interface FolderIndexResult {
  directoryPath: string;
  indexPath: string;
  created: boolean;
}

export interface FolderIndexStatus {
  folderCount: number;
  indexedCount: number;
  missingIndexPaths: string[];
}

export async function createFolderWithIndex(directoryPath: string): Promise<FolderIndexResult> {
  await mkdir(directoryPath);
  try {
    const result = await ensureFolderIndex(directoryPath);
    return { ...result, created: true };
  } catch (error) {
    await rm(directoryPath, { recursive: true, force: true });
    throw error;
  }
}

export async function ensureFolderIndex(directoryPath: string): Promise<FolderIndexResult> {
  const indexPath = path.join(directoryPath, FOLDER_INDEX_NAME);
  const title = path.basename(path.resolve(directoryPath));
  let handle;
  try {
    handle = await open(indexPath, "wx");
  } catch (error) {
    if (!isAlreadyExistsError(error)) {
      throw error;
    }
    const indexStat = await stat(indexPath);
    if (!indexStat.isFile()) {
      throw new Error(`Folder index path is not a file: ${indexPath}`);
    }
    return { directoryPath, indexPath, created: false };
  }

  try {
    await handle.writeFile(`# ${title}\n`, "utf8");
  } catch (error) {
    await handle.close();
    await rm(indexPath, { force: true });
    throw error;
  }
  await handle.close();
  return { directoryPath, indexPath, created: true };
}

export async function inspectFolderIndexes(noteRoots: readonly string[]): Promise<FolderIndexStatus> {
  const missingIndexPaths: string[] = [];
  let folderCount = 0;
  let indexedCount = 0;

  async function visit(directoryPath: string): Promise<void> {
    const entries = await sortedEntries(directoryPath);
    const hasIndex = entries.some((entry) => entry.isFile() && entry.name === FOLDER_INDEX_NAME);
    folderCount += 1;
    if (hasIndex) {
      indexedCount += 1;
    } else {
      missingIndexPaths.push(path.join(directoryPath, FOLDER_INDEX_NAME));
    }

    for (const entry of entries) {
      if (!entry.isDirectory() || entry.name.startsWith(".") || IGNORED_FOLDER_NAMES.has(entry.name)) {
        continue;
      }
      await visit(path.join(directoryPath, entry.name));
    }
  }

  for (const noteRoot of noteRoots) {
    const entries = await sortedEntries(noteRoot);
    for (const entry of entries) {
      if (!entry.isDirectory() || entry.name.startsWith(".") || IGNORED_FOLDER_NAMES.has(entry.name)) {
        continue;
      }
      await visit(path.join(noteRoot, entry.name));
    }
  }

  return { folderCount, indexedCount, missingIndexPaths };
}

async function sortedEntries(directoryPath: string) {
  return (await readdir(directoryPath, { withFileTypes: true }))
    .sort((left, right) => left.name.localeCompare(right.name));
}

function isAlreadyExistsError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error && error.code === "EEXIST";
}
