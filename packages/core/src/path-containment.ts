import path from "node:path";

type PathFlavor = Pick<typeof path.posix, "isAbsolute" | "relative" | "resolve" | "sep">;

/**
 * Lexical containment only. Filesystem authority, canonical paths, and symlink
 * checks remain owned by WorkspaceFiles.
 */
export function isPathWithinRoot(rootPath: string, targetPath: string, pathFlavor: PathFlavor = path): boolean {
  const relativePath = pathFlavor.relative(pathFlavor.resolve(rootPath), pathFlavor.resolve(targetPath));
  return relativePath === "" || (
    relativePath !== ".."
    && !relativePath.startsWith(`..${pathFlavor.sep}`)
    && !pathFlavor.isAbsolute(relativePath)
  );
}
