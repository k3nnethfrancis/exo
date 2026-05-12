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
  writeFileSync,
} from "node:fs";
import path from "node:path";

const defaultTranscriptRetentionDays = 14;
const defaultTranscriptMaxTotalBytes = 500 * 1024 * 1024;
const defaultTranscriptMaxFileBytes = 50 * 1024 * 1024;

export class TerminalTranscriptStore {
  private readonly retentionDays = parsePositiveInt(process.env.EXO_TERMINAL_TRANSCRIPT_RETENTION_DAYS) ?? defaultTranscriptRetentionDays;
  private readonly maxTotalBytes =
    (parsePositiveInt(process.env.EXO_TERMINAL_TRANSCRIPT_MAX_TOTAL_MB) ?? 0) * 1024 * 1024 ||
    defaultTranscriptMaxTotalBytes;
  private readonly maxFileBytes =
    (parsePositiveInt(process.env.EXO_TERMINAL_TRANSCRIPT_MAX_FILE_MB) ?? 0) * 1024 * 1024 ||
    defaultTranscriptMaxFileBytes;
  private readonly pendingWrites = new Map<string, { transcriptPath: string; data: string }>();
  private readonly bytesSinceTrim = new Map<string, number>();
  private flushTimer: NodeJS.Timeout | null = null;

  constructor(readonly directory: string) {
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
      const bytesSinceTrim = (this.bytesSinceTrim.get(id) ?? 0) + Buffer.byteLength(pending.data, "utf8");
      if (bytesSinceTrim >= 1024 * 1024) {
        this.trimFile(transcriptPath);
        this.bytesSinceTrim.set(id, 0);
      } else {
        this.bytesSinceTrim.set(id, bytesSinceTrim);
      }
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

  private trimFile(filePath: string): void {
    try {
      const stats = statSync(filePath);
      if (stats.size <= this.maxFileBytes) {
        return;
      }
      const tail = readFileTailBytes(filePath, Math.floor(this.maxFileBytes * 0.8));
      writeFileSync(
        filePath,
        `===== Exo transcript trimmed ${new Date().toISOString()} to enforce per-file retention =====\n${tail}`,
        "utf8",
      );
    } catch (err) {
      console.warn(`[terminal-transcripts] failed to trim transcript ${filePath}:`, err);
    }
  }

  private enforceRetention(): void {
    try {
      const files = listTranscriptFiles(this.directory);
      const now = Date.now();
      const maxAgeMs = this.retentionDays * 24 * 60 * 60 * 1000;
      let survivors = files;

      if (this.retentionDays > 0) {
        for (const file of files) {
          if (now - file.mtimeMs > maxAgeMs) {
            tryUnlink(file.path);
          }
        }
        survivors = listTranscriptFiles(this.directory);
      }

      let total = survivors.reduce((sum, file) => sum + file.size, 0);
      for (const file of survivors.sort((left, right) => left.mtimeMs - right.mtimeMs)) {
        if (total <= this.maxTotalBytes) {
          break;
        }
        tryUnlink(file.path);
        total -= file.size;
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

function readFileTailBytes(filePath: string, bytesToRead: number): string {
  const stats = statSync(filePath);
  const size = Math.min(stats.size, bytesToRead);
  const fd = openSync(filePath, "r");
  try {
    const buffer = Buffer.alloc(size);
    readSync(fd, buffer, 0, size, stats.size - size);
    return buffer.toString("utf8");
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

function parsePositiveInt(value: string | undefined): number | null {
  if (!value) {
    return null;
  }
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}
