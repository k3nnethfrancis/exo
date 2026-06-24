import path from "node:path";
import { stat } from "node:fs/promises";
import { fileURLToPath, pathToFileURL } from "node:url";

import type { ExoOpenPreviewResponse, WorkspaceSettings } from "@exo/core";

export async function resolvePreviewTarget(target: string, settings: WorkspaceSettings): Promise<ExoOpenPreviewResponse> {
  const trimmed = target.trim();
  if (!trimmed) {
    throw new Error("Preview target cannot be empty.");
  }

  const parsedUrl = parsePreviewUrl(trimmed);
  if (parsedUrl) {
    if (parsedUrl.protocol === "http:" || parsedUrl.protocol === "https:") {
      return { ok: true, url: parsedUrl.toString(), source: "url" };
    }
    if (parsedUrl.protocol === "file:") {
      return resolveLocalPreviewPath(fileURLToPath(parsedUrl), settings);
    }
    throw new Error("Preview URL must use http, https, or file.");
  }

  const candidatePath = path.isAbsolute(trimmed)
    ? trimmed
    : path.resolve(settings.workspaceRoot, trimmed);
  return resolveLocalPreviewPath(candidatePath, settings);
}

async function resolveLocalPreviewPath(filePath: string, settings: WorkspaceSettings): Promise<ExoOpenPreviewResponse> {
  const resolvedPath = path.resolve(filePath);
  const allowedRoots = [
    settings.workspaceRoot,
    ...settings.noteRoots,
    ...settings.projectRoots,
  ].map((rootPath) => path.resolve(rootPath));

  if (!allowedRoots.some((rootPath) => isPathWithin(rootPath, resolvedPath))) {
    throw new Error("Local preview files must be inside the workspace, note roots, or project roots.");
  }

  if (![".html", ".htm"].includes(path.extname(resolvedPath).toLowerCase())) {
    throw new Error("Local preview files must be .html or .htm files.");
  }

  const fileStat = await stat(resolvedPath);
  if (!fileStat.isFile()) {
    throw new Error("Local preview target must be an existing file.");
  }

  return { ok: true, url: pathToFileURL(resolvedPath).toString(), source: "file" };
}

function parsePreviewUrl(target: string): URL | null {
  if (!/^[a-z][a-z0-9+.-]*:/i.test(target)) {
    return null;
  }
  try {
    return new URL(target);
  } catch {
    throw new Error("Preview target is not a valid URL.");
  }
}

function isPathWithin(parentPath: string, targetPath: string): boolean {
  const relative = path.relative(parentPath, targetPath);
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}
