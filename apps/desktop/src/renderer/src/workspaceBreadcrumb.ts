export interface WorkspaceBreadcrumbSegment {
  kind: "folder" | "file";
  label: string;
  path: string;
}

/**
 * Builds a typed path relative to the owning notes root. Folder and file
 * identity remains explicit so chrome never implies that a note is a folder.
 */
export function workspaceBreadcrumb(filePath: string, noteRoots: readonly string[]): WorkspaceBreadcrumbSegment[] {
  const normalizedFilePath = normalizePath(filePath);
  const root = noteRoots.map(normalizePath).find((candidate) => normalizedFilePath === candidate || normalizedFilePath.startsWith(`${candidate}/`));
  const relativePath = root ? normalizedFilePath.slice(root.length).replace(/^\/+/, "") : normalizedFilePath;
  const parts = relativePath.split("/").filter(Boolean);

  if (parts.length === 0) {
    return [{ kind: "file", label: displayFileName(filePath), path: filePath }];
  }

  return parts.map((part, index) => {
    const isFile = index === parts.length - 1;
    const segmentPath = root
      ? [root, ...parts.slice(0, index + 1)].join("/")
      : parts.slice(0, index + 1).join("/");
    return {
      kind: isFile ? "file" : "folder",
      label: isFile ? displayFileName(part) : part,
      path: segmentPath,
    };
  });
}

function displayFileName(filePath: string): string {
  return normalizePath(filePath).split("/").at(-1)?.replace(/\.[^.]+$/, "") ?? filePath;
}

function normalizePath(value: string): string {
  return value.replaceAll("\\", "/").replace(/\/$/, "");
}
