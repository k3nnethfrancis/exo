import { execFileSync } from "node:child_process";
import {
  appendFileSync,
  closeSync,
  existsSync,
  mkdirSync,
  openSync,
  readFileSync,
  readSync,
  statSync,
} from "node:fs";
import path from "node:path";

const defaultTranscriptRetentionDays = 0;

interface TerminalTranscriptStoreOptions {
  retentionDays?: number;
}

export class TerminalTranscriptStore {
  private readonly retentionDays: number;
  private readonly pendingWrites = new Map<string, { transcriptPath: string; data: string }>();
  private flushTimer: NodeJS.Timeout | null = null;

  constructor(readonly directory: string, options: TerminalTranscriptStoreOptions = {}) {
    this.retentionDays =
      options.retentionDays ?? parseNonNegativeInt(process.env.EXO_TERMINAL_TRANSCRIPT_RETENTION_DAYS) ?? defaultTranscriptRetentionDays;
    mkdirSync(directory, { recursive: true });
    this.enforceRetention();
  }

  append(id: string, transcriptPath: string, data: string): void {
    if (data.length === 0) {
      return;
    }
    const pending = this.pendingWrites.get(id);
    this.pendingWrites.set(id, {
      transcriptPath,
      data: `${pending?.data ?? ""}${data}`,
    });
    this.scheduleFlush();
  }

  flush(id: string, transcriptPath: string): void {
    const pending = this.pendingWrites.get(id);
    if (!pending) {
      return;
    }
    this.pendingWrites.delete(id);

    try {
      mkdirSync(path.dirname(transcriptPath), { recursive: true });
      appendFileSync(transcriptPath, pending.data, "utf8");
    } catch (err) {
      console.warn(`[terminal-transcripts] failed to append transcript for ${id}:`, err);
    }
  }

  read(transcriptPath: string, tailChars: number): string {
    return readFileTail(transcriptPath, tailChars);
  }

  private scheduleFlush(): void {
    if (this.flushTimer) {
      return;
    }
    this.flushTimer = setTimeout(() => {
      this.flushTimer = null;
      for (const [id, pending] of Array.from(this.pendingWrites.entries())) {
        this.flush(id, pending.transcriptPath);
      }
    }, 100);
  }

  private enforceRetention(): void {
    try {
      const files = listTranscriptFiles(this.directory);
      const now = Date.now();
      const maxAgeMs = this.retentionDays * 24 * 60 * 60 * 1000;

      if (this.retentionDays > 0) {
        for (const file of files) {
          if (now - file.mtimeMs > maxAgeMs) {
            tryUnlink(file.path);
          }
        }
      }
    } catch (err) {
      console.warn("[terminal-transcripts] failed to enforce transcript retention:", err);
    }
  }
}

export function sanitizeTranscriptName(value: string): string {
  return value.replace(/[^a-zA-Z0-9._-]+/g, "-").replace(/^-+|-+$/g, "") || "terminal";
}

function readFileTail(filePath: string, tailChars: number): string {
  if (!existsSync(filePath)) {
    return "";
  }
  if (tailChars <= 0) {
    return readFileSync(filePath, "utf8");
  }

  const stats = statSync(filePath);
  const bytesToRead = Math.min(stats.size, Math.max(tailChars * 4, 4096));
  const fd = openSync(filePath, "r");
  try {
    const buffer = Buffer.alloc(bytesToRead);
    readSync(fd, buffer, 0, bytesToRead, stats.size - bytesToRead);
    return buffer.toString("utf8").slice(-tailChars);
  } finally {
    closeSync(fd);
  }
}

function listTranscriptFiles(directory: string): Array<{ path: string; size: number; mtimeMs: number }> {
  if (!existsSync(directory)) {
    return [];
  }

  return execFileSync("find", [directory, "-type", "f", "-name", "*.ansi.log", "-print0"], {
    encoding: "buffer",
    stdio: ["ignore", "pipe", "ignore"],
  })
    .toString("utf8")
    .split("\0")
    .filter(Boolean)
    .map((filePath) => {
      const stats = statSync(filePath);
      return { path: filePath, size: stats.size, mtimeMs: stats.mtimeMs };
    });
}

function tryUnlink(filePath: string): void {
  try {
    execFileSync("rm", ["-f", filePath], { stdio: "ignore" });
  } catch {
    // best effort
  }
}

function parseNonNegativeInt(value: string | undefined): number | null {
  if (!value) {
    return null;
  }
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
}
