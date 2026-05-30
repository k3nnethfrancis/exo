import { execFile } from "node:child_process";
import path from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export class ProjectReviewService {
  async getGitStatus(rootPath: string) {
    try {
      const [{ stdout: branchStdout }, { stdout: statusStdout }, { stdout: diffStdout }] = await Promise.all([
        execFileAsync("git", ["-C", rootPath, "branch", "--show-current"]),
        execFileAsync("git", ["-C", rootPath, "status", "--porcelain", "--", "."]),
        execFileAsync("git", ["-C", rootPath, "diff", "--unified=0", "HEAD", "--", "."]).catch(() => ({ stdout: "" })),
      ]);
      const firstChangedLines = parseGitDiffFirstChangedLines(diffStdout);

      return {
        rootPath,
        branch: branchStdout.trim() || null,
        dirty: statusStdout.trim().length > 0,
        changes: parseGitStatusChanges(rootPath, statusStdout, firstChangedLines),
      };
    } catch {
      return null;
    }
  }
}

export function parseGitStatusChanges(rootPath: string, output: string, firstChangedLines: Map<string, number>) {
  return output
    .split(/\r?\n/)
    .map((line) => line.trimEnd())
    .filter(Boolean)
    .map((line) => {
      const status = line.slice(0, 2).trim() || "??";
      const rawPath = line.slice(3).trim();
      const filePath = rawPath.includes(" -> ") ? rawPath.split(" -> ").at(-1) ?? rawPath : rawPath;
      return {
        path: filePath,
        absolutePath: path.resolve(rootPath, filePath),
        status,
        firstChangedLine: firstChangedLines.get(filePath) ?? (status === "??" ? 1 : null),
      };
    });
}

export function parseGitDiffFirstChangedLines(output: string): Map<string, number> {
  const linesByPath = new Map<string, number>();
  let currentPath: string | null = null;

  for (const line of output.split(/\r?\n/)) {
    if (line.startsWith("+++ b/")) {
      currentPath = line.slice("+++ b/".length);
      continue;
    }
    if (!currentPath || !line.startsWith("@@")) {
      continue;
    }
    const match = /\+(\d+)(?:,(\d+))?/.exec(line);
    if (!match) {
      continue;
    }
    const startLine = Number(match[1]);
    const lineCount = match[2] === undefined ? 1 : Number(match[2]);
    if (lineCount <= 0 || linesByPath.has(currentPath)) {
      continue;
    }
    linesByPath.set(currentPath, startLine);
  }

  return linesByPath;
}
