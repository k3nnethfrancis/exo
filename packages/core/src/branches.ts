import { mkdir } from "node:fs/promises";
import path from "node:path";

import type { BranchCreateResult, BranchEntry, BranchFamily, NoteDocument } from "./types";
import { listMarkdownFiles } from "./workspace";
import { readWorkspaceDocument, saveWorkspaceDocument } from "./notes";

interface ParsedBranchPath {
  baseName: string;
  path: number[];
}

export async function createBranchFile(
  filePath: string,
  document: NoteDocument,
  noteRootPaths: string[],
  source = "branch",
): Promise<BranchCreateResult> {
  if (document.kind !== "markdown") {
    throw new Error("Only markdown notes can create branches.");
  }

  const containingRoot = findContainingRoot(filePath, noteRootPaths);
  if (!containingRoot) {
    throw new Error(`File is not inside an attached note root: ${filePath}`);
  }

  const relativePath = path.relative(containingRoot, filePath);
  const parsed = parseBranchRelativePath(relativePath);
  if (!parsed) {
    throw new Error(`Could not parse branch family for: ${relativePath}`);
  }

  const existingFiles = await listMarkdownFiles([containingRoot]);
  const existingRelativePaths = existingFiles.map((candidate) => path.relative(containingRoot, candidate));
  const branchRelativePath = nextBranchRelativePath(relativePath, existingRelativePaths);
  const branchFilePath = path.join(containingRoot, branchRelativePath);

  await mkdir(path.dirname(branchFilePath), { recursive: true });
  await saveWorkspaceDocument(
    branchFilePath,
    {
      ...document.frontmatter,
      branch_parent: relativePath,
      branch_source: source,
      branch_created: new Date().toISOString(),
    },
    document.body,
  );

  return {
    branchFilePath,
    family: await getBranchFamily(branchFilePath, noteRootPaths),
  };
}

export async function getBranchFamily(filePath: string, noteRootPaths: string[]): Promise<BranchFamily> {
  const containingRoot = findContainingRoot(filePath, noteRootPaths);
  if (!containingRoot) {
    throw new Error(`File is not inside an attached note root: ${filePath}`);
  }

  const relativePath = path.relative(containingRoot, filePath);
  const parsed = parseBranchRelativePath(relativePath);
  if (!parsed) {
    throw new Error(`Could not parse branch family for: ${relativePath}`);
  }

  const noteFiles = await listMarkdownFiles([containingRoot]);
  const familyPaths = noteFiles.filter((candidate) => {
    const candidateRelativePath = path.relative(containingRoot, candidate);
    const candidateParsed = parseBranchRelativePath(candidateRelativePath);
    return candidateParsed?.baseName === parsed.baseName;
  });

  const members = await Promise.all(
    familyPaths.map(async (candidate) => {
      const relativeCandidatePath = path.relative(containingRoot, candidate);
      const candidateParsed = parseBranchRelativePath(relativeCandidatePath);
      if (!candidateParsed) {
        throw new Error(`Could not parse branch member: ${relativeCandidatePath}`);
      }

      const document = await readWorkspaceDocument(candidate);
      return {
        filePath: candidate,
        relativePath: relativeCandidatePath,
        title: document.title,
        path: candidateParsed.path,
        isRoot: candidateParsed.path.length === 0,
      } satisfies BranchEntry;
    }),
  );

  const sortedMembers = members.sort(compareBranchEntries);
  const rootMember = sortedMembers.find((member) => member.isRoot);
  if (!rootMember) {
    throw new Error(`Missing root note for branch family: ${parsed.baseName}`);
  }

  return {
    baseName: parsed.baseName,
    rootFilePath: rootMember.filePath,
    currentFilePath: filePath,
    currentPath: parsed.path,
    members: sortedMembers,
    tree: visualizeBranchTree(sortedMembers),
  };
}

export async function listBranchFamilies(noteRootPaths: string[]): Promise<BranchFamily[]> {
  const noteFiles = await listMarkdownFiles(noteRootPaths);
  const grouped = new Map<string, string>();

  for (const filePath of noteFiles) {
    const containingRoot = findContainingRoot(filePath, noteRootPaths);
    if (!containingRoot) {
      continue;
    }

    const relativePath = path.relative(containingRoot, filePath);
    const parsed = parseBranchRelativePath(relativePath);
    if (!parsed || parsed.path.length === 0) {
      continue;
    }

    const key = `${containingRoot}::${parsed.baseName}`;
    if (!grouped.has(key)) {
      grouped.set(key, path.join(containingRoot, `${parsed.baseName}.md`));
    }
  }

  const families = await Promise.all(Array.from(grouped.values()).map((rootPath) => getBranchFamily(rootPath, noteRootPaths)));
  return families.sort((left, right) => left.baseName.localeCompare(right.baseName));
}

export function parseBranchRelativePath(relativePath: string): ParsedBranchPath | null {
  if (!relativePath.endsWith(".md") && !relativePath.endsWith(".markdown")) {
    return null;
  }

  const normalized = relativePath.replace(/\\/g, "/");
  if (normalized.includes("-looms/")) {
    const [prefix, branchFile] = normalized.split("-looms/");
    if (!branchFile) {
      return null;
    }

    const branchStem = branchFile.replace(/\.(md|markdown)$/i, "");
    const branchSegments = branchStem.split(".").filter(Boolean);
    const branchPath: number[] = [];
    for (const segment of branchSegments) {
      const parsed = Number.parseInt(segment, 10);
      if (!Number.isInteger(parsed)) {
        return null;
      }
      branchPath.push(parsed);
    }

    return {
      baseName: prefix,
      path: branchPath,
    };
  }

  return {
    baseName: normalized.replace(/\.(md|markdown)$/i, ""),
    path: [],
  };
}

export function branchRelativePath(baseName: string, branchPath: number[]): string {
  if (branchPath.length === 0) {
    return `${baseName}.md`;
  }

  return `${baseName}-looms/${branchPath.join(".")}.md`;
}

export function nextBranchRelativePath(parentRelativePath: string, existingRelativePaths: string[]): string {
  const parsedParent = parseBranchRelativePath(parentRelativePath);
  if (!parsedParent) {
    throw new Error(`Could not parse branch parent: ${parentRelativePath}`);
  }

  let maxChild = 0;
  for (const candidate of existingRelativePaths) {
    const parsed = parseBranchRelativePath(candidate);
    if (!parsed || parsed.baseName !== parsedParent.baseName) {
      continue;
    }

    if (parsed.path.length !== parsedParent.path.length + 1) {
      continue;
    }

    const parentPath = parsed.path.slice(0, -1);
    if (!pathsEqual(parentPath, parsedParent.path)) {
      continue;
    }

    maxChild = Math.max(maxChild, parsed.path.at(-1) ?? 0);
  }

  return branchRelativePath(parsedParent.baseName, [...parsedParent.path, maxChild + 1]);
}

function findContainingRoot(filePath: string, noteRootPaths: string[]): string | null {
  for (const candidate of noteRootPaths) {
    const relativePath = path.relative(candidate, filePath);
    if (relativePath && !relativePath.startsWith("..") && !path.isAbsolute(relativePath)) {
      return candidate;
    }
    if (relativePath === "") {
      return candidate;
    }
  }

  return null;
}

function compareBranchEntries(left: BranchEntry, right: BranchEntry): number {
  if (left.path.length !== right.path.length) {
    return left.path.length - right.path.length;
  }

  for (let index = 0; index < Math.min(left.path.length, right.path.length); index += 1) {
    if (left.path[index] !== right.path[index]) {
      return left.path[index] - right.path[index];
    }
  }

  return left.relativePath.localeCompare(right.relativePath);
}

function visualizeBranchTree(members: BranchEntry[]): string {
  const root = members.find((member) => member.isRoot);
  if (!root) {
    return "";
  }

  const childMap = new Map<string, BranchEntry[]>();
  for (const member of members) {
    const parentPath = member.path.slice(0, -1);
    const parentKey = member.path.length === 0 || parentPath.length === 0 ? "__root__" : parentPath.join(".");
    const existing = childMap.get(parentKey) ?? [];
    existing.push(member);
    childMap.set(parentKey, existing.sort(compareBranchEntries));
  }

  const lines = [path.basename(root.relativePath)];

  function walk(parentPath: number[], prefix: string): void {
    const key = parentPath.length === 0 ? "__root__" : parentPath.join(".");
    const children = (childMap.get(key) ?? []).filter((entry) => !pathsEqual(entry.path, parentPath));
    children.forEach((child, index) => {
      const connector = index === children.length - 1 ? "└─ " : "├─ ";
      lines.push(`${prefix}${connector}${branchEntryLabel(child)}`);
      const nextPrefix = `${prefix}${index === children.length - 1 ? "   " : "│  "}`;
      walk(child.path, nextPrefix);
    });
  }

  walk([], "");
  return lines.join("\n");
}

function branchEntryLabel(entry: BranchEntry): string {
  if (entry.isRoot) {
    return path.basename(entry.relativePath);
  }

  return path.basename(entry.relativePath);
}

function pathsEqual(left: number[], right: number[]): boolean {
  if (left.length !== right.length) {
    return false;
  }

  return left.every((value, index) => value === right[index]);
}
