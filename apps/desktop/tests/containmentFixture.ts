import { mkdir, readdir, rm, symlink, writeFile } from "node:fs/promises";
import path from "node:path";

export const CONTAINMENT_FIXTURE_SHAPE = {
  directoryCount: 613,
  markdownCount: 1_567,
  maxDepth: 9,
} as const;

export interface ContainmentFixturePaths {
  authorizedRoot: string;
  outsideRoot: string;
  retiredRoot: string;
  outsideNote: string;
  retiredNote: string;
  symlinkDirectory: string;
  symlinkFile: string;
  sourceNote: string;
  pathShapeDirectory: string;
  pathShapeNote: string;
}

/**
 * Builds a disposable corpus with the aggregate Markdown count and nesting
 * depth of the dogfood vault, but with generated identities and bodies only.
 * Directory entries are never copied and symlinks are created only as traps.
 */
export async function createContainmentFixture(workspaceRoot: string): Promise<ContainmentFixturePaths> {
  await rm(workspaceRoot, { recursive: true, force: true });
  const authorizedRoot = path.join(workspaceRoot, "authorized-root");
  const outsideRoot = path.join(workspaceRoot, "outside-root");
  const retiredRoot = path.join(workspaceRoot, "retired-root");
  await Promise.all([
    mkdir(authorizedRoot, { recursive: true }),
    mkdir(outsideRoot, { recursive: true }),
    mkdir(retiredRoot, { recursive: true }),
  ]);

  const directories: string[] = [];
  let chain = authorizedRoot;
  const nestedSegments = [
    "space rich",
    "日本語",
    "punctuation [draft] + comma,",
    `long-segment-${"x".repeat(72)}`,
    "depth-05",
    "depth-06",
    "depth-07",
    "depth-08",
    "depth-09",
  ];
  for (let depth = 1; depth <= CONTAINMENT_FIXTURE_SHAPE.maxDepth; depth += 1) {
    chain = path.join(chain, nestedSegments[depth - 1]!);
    await mkdir(chain);
    directories.push(chain);
  }
  for (let index = directories.length; index < CONTAINMENT_FIXTURE_SHAPE.directoryCount; index += 1) {
    const directory = path.join(authorizedRoot, `collection-${String(index).padStart(3, "0")}`);
    await mkdir(directory);
    directories.push(directory);
  }

  const writes: Promise<void>[] = [];
  const pathShapeDirectory = chain;
  const pathShapeNote = path.join(pathShapeDirectory, "Résumé + 研究 (draft).md");
  for (let index = 0; index < CONTAINMENT_FIXTURE_SHAPE.markdownCount; index += 1) {
    const directory = index === 0 ? authorizedRoot : index === 1 ? pathShapeDirectory : directories[index % directories.length]!;
    const notePath = index === 1
      ? pathShapeNote
      : path.join(directory, `synthetic-note-${String(index).padStart(4, "0")}.md`);
    const previous = index > 0 ? `\n\n[[synthetic-note-${String(index - 1).padStart(4, "0")}]]\n` : "\n";
    writes.push(writeFile(notePath, `# Synthetic Note ${index}${previous}`, "utf8"));
  }
  await Promise.all(writes);

  const outsideNote = path.join(outsideRoot, "outside-note.md");
  const retiredNote = path.join(retiredRoot, "retired-note.md");
  await Promise.all([
    writeFile(outsideNote, "# Outside Synthetic Note\n", "utf8"),
    writeFile(retiredNote, "# Retired Synthetic Note\n", "utf8"),
  ]);
  const symlinkDirectory = path.join(authorizedRoot, "linked-outside");
  const symlinkFile = path.join(authorizedRoot, "linked-outside-note.md");
  await symlink(outsideRoot, symlinkDirectory);
  await symlink(outsideNote, symlinkFile);

  return {
    authorizedRoot,
    outsideRoot,
    retiredRoot,
    outsideNote,
    retiredNote,
    symlinkDirectory,
    symlinkFile,
    sourceNote: path.join(authorizedRoot, "synthetic-note-0000.md"),
    pathShapeDirectory,
    pathShapeNote,
  };
}

export async function measureContainmentFixture(rootPath: string): Promise<{
  directoryCount: number;
  markdownCount: number;
  maxDepth: number;
  symlinkCount: number;
}> {
  const result = { directoryCount: 0, markdownCount: 0, maxDepth: 0, symlinkCount: 0 };
  const pending: Array<{ directory: string; depth: number }> = [{ directory: rootPath, depth: 0 }];
  while (pending.length > 0) {
    const current = pending.pop()!;
    result.maxDepth = Math.max(result.maxDepth, current.depth);
    for (const entry of await readdir(current.directory, { withFileTypes: true })) {
      if (entry.isSymbolicLink()) {
        result.symlinkCount += 1;
      } else if (entry.isDirectory()) {
        result.directoryCount += 1;
        pending.push({ directory: path.join(current.directory, entry.name), depth: current.depth + 1 });
      } else if (entry.isFile() && entry.name.endsWith(".md")) {
        result.markdownCount += 1;
      }
    }
  }
  return result;
}
