import { rename, stat } from "node:fs/promises";
import path from "node:path";

import { WORKSPACE_RUNTIME_DIRECTORY } from "@stem/core";

export { WORKSPACE_RUNTIME_DIRECTORY };

// Kept only for a one-way upgrade. New code must never create this directory.
const LEGACY_WORKSPACE_RUNTIME_DIRECTORY = ".stem";

export type RuntimeRootMigration =
  | { status: "not-needed" | "already-current" | "explicit-root" }
  | { status: "migrated"; from: string; to: string }
  | { status: "deferred"; from: string; to: string; error: string };

export function runtimeRootForWorkspace(workspaceRoot: string, env: NodeJS.ProcessEnv = process.env): string {
  return env.EXO_RUNTIME_ROOT ?? env.STEM_RUNTIME_ROOT ?? path.join(workspaceRoot, WORKSPACE_RUNTIME_DIRECTORY);
}

/**
 * Moves the legacy runtime directory before any service reads it. The move is
 * within one Workspace, so rename is atomic. When both directories exist we
 * preserve them and let the current directory win rather than guessing how to
 * merge review evidence or an index.
 */
export async function migrateLegacyWorkspaceRuntime(
  workspaceRoot: string,
  env: NodeJS.ProcessEnv = process.env,
): Promise<RuntimeRootMigration> {
  if (env.EXO_RUNTIME_ROOT ?? env.STEM_RUNTIME_ROOT) return { status: "explicit-root" };

  const current = path.join(workspaceRoot, WORKSPACE_RUNTIME_DIRECTORY);
  if (await isDirectory(current)) return { status: "already-current" };

  const legacy = path.join(workspaceRoot, LEGACY_WORKSPACE_RUNTIME_DIRECTORY);
  if (!(await isDirectory(legacy))) return { status: "not-needed" };

  try {
    await rename(legacy, current);
    return { status: "migrated", from: legacy, to: current };
  } catch (error) {
    return {
      status: "deferred",
      from: legacy,
      to: current,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

async function isDirectory(target: string): Promise<boolean> {
  try {
    return (await stat(target)).isDirectory();
  } catch {
    return false;
  }
}
