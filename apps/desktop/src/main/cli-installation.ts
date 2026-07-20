import { constants, existsSync } from "node:fs";
import { access, lstat, readFile, readlink } from "node:fs/promises";
import path from "node:path";

import type { CliInstallationStatus } from "../shared/api";
import { commandEnvironment } from "./command-environment";

const LEGACY_SHIM_MARKER = "packages/cli/dist/index.cjs";

export interface InspectCliInstallationOptions {
  env?: NodeJS.ProcessEnv;
  sourceProjectRoot?: string;
}

/**
 * Return only a real source checkout that can supply the repo-backed CLI.
 * Packaged Resources is not a source checkout. Require the actual launcher and
 * installer instead of inferring source identity from an unrelated directory.
 */
export function findSourceProjectRoot(candidates: string[]): string | undefined {
  return candidates.find((candidate) =>
    existsSync(path.join(candidate, "package.json"))
    && existsSync(path.join(candidate, "bin", "exo"))
    && existsSync(path.join(candidate, "scripts", "install-local")),
  );
}

/**
 * Classify the first executable `exo` visible to the desktop app. This is
 * deliberately diagnostic only: installation remains an explicit shell step.
 */
export async function inspectCliInstallation(
  { env = process.env, sourceProjectRoot }: InspectCliInstallationOptions = {},
): Promise<CliInstallationStatus> {
  const sourcePath = sourceProjectRoot ? path.join(sourceProjectRoot, "bin", "exo") : undefined;
  const installCommand = sourceProjectRoot ? `cd ${shellQuote(sourceProjectRoot)} && ./scripts/install-local` : undefined;
  const commandPath = await findExecutable("exo", commandEnvironment(env).PATH);

  if (!commandPath) {
    return sourcePath ? { state: "missing", sourcePath, installCommand } : { state: "unavailable" };
  }

  const common = { commandPath, ...(sourcePath ? { sourcePath, installCommand } : {}) };
  if (!sourcePath) return { state: "unavailable", ...common };

  try {
    const entry = await lstat(commandPath);
    if (!entry.isSymbolicLink()) return { state: "non-exo", ...common };

    const linkTarget = await readlink(commandPath);
    const resolvedTarget = path.resolve(path.dirname(commandPath), linkTarget);
    if (path.resolve(sourcePath) === resolvedTarget) return { state: "current", ...common };

    try {
      const content = await readFile(resolvedTarget, "utf8");
      if (content.includes(LEGACY_SHIM_MARKER)) return { state: "legacy-exo", ...common };
    } catch {
      if (linkTarget.endsWith("/bin/exo") || linkTarget === "bin/exo") return { state: "legacy-exo", ...common };
    }
    return { state: "non-exo", ...common };
  } catch {
    return { state: "unavailable", ...common };
  }
}

async function findExecutable(name: string, pathValue: string | undefined): Promise<string | undefined> {
  for (const directory of (pathValue ?? "").split(path.delimiter).filter(Boolean)) {
    const candidate = path.join(directory, name);
    try {
      if ((await lstat(candidate)).isSymbolicLink()) return candidate;
      await access(candidate, constants.X_OK);
      return candidate;
    } catch {
      // Keep looking: a PATH entry may contain a non-executable file.
    }
  }
  return undefined;
}

function shellQuote(value: string): string {
  return `'${value.replaceAll("'", "'\\\"'\\\"'")}'`;
}
