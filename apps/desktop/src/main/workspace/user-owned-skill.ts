import { createHash } from "node:crypto";
import { constants } from "node:fs";
import { lstat, mkdir, open, realpath, writeFile } from "node:fs/promises";
import path from "node:path";

const SKILL_DIRECTORY = "skills";
const MAX_SKILL_BYTES = 128 * 1024;

export interface UserOwnedSkill {
  id: string;
  label: string;
  path: string;
  revision: string;
  source: string;
}

/**
 * Installs Stem's initial instructions once, then treats the Markdown file as
 * user-owned configuration. Existing bytes are read and fingerprinted but
 * never rewritten.
 */
export async function ensureUserOwnedSkill(input: {
  noteRoot: string;
  id: string;
  label: string;
  source: string;
}): Promise<UserOwnedSkill> {
  const resolvedRoot = path.resolve(input.noteRoot);
  const rootInfo = await lstat(resolvedRoot);
  if (!rootInfo.isDirectory() || rootInfo.isSymbolicLink()) {
    throw new Error("The Note Root must be a real directory before installing a Skill.");
  }
  const directory = path.join(resolvedRoot, SKILL_DIRECTORY);
  try {
    const directoryInfo = await lstat(directory);
    if (!directoryInfo.isDirectory() || directoryInfo.isSymbolicLink()) {
      throw new Error("The Skills path must be a real directory.");
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    await mkdir(directory);
  }
  const [realRoot, realDirectory] = await Promise.all([realpath(resolvedRoot), realpath(directory)]);
  if (realDirectory !== path.join(realRoot, SKILL_DIRECTORY)) {
    throw new Error("The Skills path escapes the selected Note Root.");
  }

  const skillPath = path.join(directory, `${input.id}.md`);
  let source: string;
  try {
    const handle = await open(skillPath, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
    try {
      const info = await handle.stat();
      if (!info.isFile() || info.size > MAX_SKILL_BYTES) {
        throw new Error("The user-owned Skill is not a bounded regular file.");
      }
      source = await handle.readFile("utf8");
    } finally {
      await handle.close();
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    source = input.source;
    await writeFile(skillPath, source, { encoding: "utf8", mode: 0o600, flag: "wx" });
  }

  return {
    id: input.id,
    label: input.label,
    path: skillPath,
    revision: createHash("sha256").update(source).digest("hex"),
    source,
  };
}
