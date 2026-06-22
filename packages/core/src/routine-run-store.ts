import { appendFile, mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import path from "node:path";

import type { RoutineDefinition } from "./routine";
import type { RunArtifact, RunArtifactKind, RunRecord, RunTracePacket } from "./run";
import { activityToRunRecord } from "./run";

export interface RoutineRunStoreLayout {
  runtimeRoot: string;
  routinesDir: string;
  runsDir: string;
  artifactsDir: string;
}

export function resolveRoutineRunStoreLayout(runtimeRoot: string): RoutineRunStoreLayout {
  return {
    runtimeRoot,
    routinesDir: path.join(runtimeRoot, "routines"),
    runsDir: path.join(runtimeRoot, "runs"),
    artifactsDir: path.join(runtimeRoot, "artifacts"),
  };
}

export function routineDefinitionPath(layout: RoutineRunStoreLayout, routineId: string): string {
  return path.join(layout.routinesDir, `${safeStoreSegment(routineId)}.json`);
}

export function runRecordPath(layout: RoutineRunStoreLayout, runId: string): string {
  return path.join(layout.runsDir, safeStoreSegment(runId), "run.json");
}

export function runTranscriptPath(layout: RoutineRunStoreLayout, runId: string): string {
  return path.join(layout.runsDir, safeStoreSegment(runId), "transcript.ansi.log");
}

export function runLogPath(layout: RoutineRunStoreLayout, runId: string): string {
  return path.join(layout.runsDir, safeStoreSegment(runId), "run.log");
}

export function runArtifactPath(layout: RoutineRunStoreLayout, runId: string, fileName: string): string {
  return path.join(layout.artifactsDir, safeStoreSegment(runId), safeStoreFileName(fileName));
}

export function runTraceLogPath(layout: RoutineRunStoreLayout, runId: string): string {
  return runArtifactPath(layout, runId, "trace.jsonl");
}

export class RoutineRunStore {
  readonly layout: RoutineRunStoreLayout;

  constructor(runtimeRoot: string) {
    this.layout = resolveRoutineRunStoreLayout(runtimeRoot);
  }

  async writeRoutine(routine: RoutineDefinition): Promise<string> {
    await mkdir(this.layout.routinesDir, { recursive: true });
    const target = routineDefinitionPath(this.layout, routine.id);
    await writeJson(target, routine);
    return target;
  }

  async readRoutine(routineId: string): Promise<RoutineDefinition | null> {
    return readJsonOrNull<RoutineDefinition>(routineDefinitionPath(this.layout, routineId));
  }

  async listRoutines(): Promise<RoutineDefinition[]> {
    const files = await listJsonFiles(this.layout.routinesDir);
    const routines = await Promise.all(files.map((file) => readJsonOrNull<RoutineDefinition>(path.join(this.layout.routinesDir, file))));
    return routines.filter((routine): routine is RoutineDefinition => Boolean(routine));
  }

  async writeRun(run: RunRecord): Promise<string> {
    const target = runRecordPath(this.layout, run.id);
    await mkdir(path.dirname(target), { recursive: true });
    await writeJson(target, run);
    return target;
  }

  async readRun(runId: string): Promise<RunRecord | null> {
    const run = await readJsonOrNull<RunRecord>(runRecordPath(this.layout, runId));
    return run ? activityToRunRecord(run) : null;
  }

  async listRuns(): Promise<RunRecord[]> {
    let entries: string[];
    try {
      const dirents = await readdir(this.layout.runsDir, { withFileTypes: true });
      entries = dirents.filter((entry) => entry.isDirectory()).map((entry) => entry.name).sort();
    } catch (error) {
      if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") {
        return [];
      }
      throw error;
    }
    const runs = await Promise.all(entries.map((entry) => readJsonOrNull<RunRecord>(path.join(this.layout.runsDir, entry, "run.json"))));
    return runs.filter((run): run is RunRecord => Boolean(run)).map((run) => activityToRunRecord(run));
  }

  async updateRun(runId: string, updater: (run: RunRecord) => RunRecord | Promise<RunRecord>): Promise<RunRecord> {
    const existing = await this.readRun(runId);
    if (!existing) {
      throw new Error(`Run record not found: ${runId}`);
    }
    const updated = await updater(existing);
    await this.writeRun(updated);
    return updated;
  }

  async writeArtifact(
    runId: string,
    artifact: Omit<RunArtifact, "runId" | "path"> & { path?: string },
    contents: string | Uint8Array,
    fileName = defaultArtifactFileName(artifact),
  ): Promise<RunArtifact> {
    const run = await this.requireRun(runId);
    const target = runArtifactPath(this.layout, runId, fileName);
    await mkdir(path.dirname(target), { recursive: true });
    await writeFile(target, contents);

    const saved: RunArtifact = {
      ...artifact,
      runId,
      path: artifact.path ?? target,
    };
    await this.writeRun({
      ...run,
      artifacts: replaceById(run.artifacts, saved),
    });
    return saved;
  }

  async appendTrace(runId: string, packet: Omit<RunTracePacket, "runId"> & { runId?: string }): Promise<RunTracePacket> {
    const run = await this.requireRun(runId);
    const saved: RunTracePacket = {
      ...packet,
      runId,
    };
    const target = runTraceLogPath(this.layout, runId);
    await mkdir(path.dirname(target), { recursive: true });
    await appendFile(target, `${JSON.stringify(saved)}\n`, "utf8");
    await this.writeRun({
      ...run,
      tracePackets: [...(run.tracePackets ?? []).filter((existing) => existing.id !== saved.id), saved],
    });
    return saved;
  }

  async readTracePackets(runId: string): Promise<RunTracePacket[]> {
    const target = runTraceLogPath(this.layout, runId);
    try {
      const raw = await readFile(target, "utf8");
      return raw
        .split(/\r?\n/)
        .filter(Boolean)
        .map((line) => JSON.parse(line) as RunTracePacket);
    } catch (error) {
      if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") {
        return [];
      }
      throw error;
    }
  }

  private async requireRun(runId: string): Promise<RunRecord> {
    const run = await this.readRun(runId);
    if (!run) {
      throw new Error(`Run record not found: ${runId}`);
    }
    return run;
  }
}

export function safeStoreSegment(value: string): string {
  const trimmed = value.trim();
  if (!trimmed || trimmed === "." || trimmed === "..") {
    throw new Error("Store id segment must be a non-empty identifier.");
  }

  return trimmed.replace(/[^A-Za-z0-9_.-]/g, "-").replace(/^\.+$/, "-");
}

export function safeStoreFileName(value: string): string {
  if (value.includes("/") || value.includes("\\")) {
    throw new Error("Store filename must not contain path separators.");
  }
  const segment = safeStoreSegment(value);
  return segment;
}

async function writeJson(pathname: string, value: unknown): Promise<void> {
  await writeFile(pathname, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

async function readJsonOrNull<T>(pathname: string): Promise<T | null> {
  try {
    return JSON.parse(await readFile(pathname, "utf8")) as T;
  } catch (error) {
    if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") {
      return null;
    }
    throw error;
  }
}

async function listJsonFiles(directory: string): Promise<string[]> {
  try {
    const entries = await readdir(directory, { withFileTypes: true });
    return entries
      .filter((entry) => entry.isFile() && entry.name.endsWith(".json"))
      .map((entry) => entry.name)
      .sort();
  } catch (error) {
    if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") {
      return [];
    }
    throw error;
  }
}

function replaceById<T extends { id: string }>(values: T[], value: T): T[] {
  const withoutExisting = values.filter((existing) => existing.id !== value.id);
  return [...withoutExisting, value];
}

function defaultArtifactFileName(artifact: Pick<RunArtifact, "id" | "kind" | "mimeType">): string {
  return `${safeStoreSegment(artifact.id)}${extensionForArtifact(artifact.kind, artifact.mimeType)}`;
}

function extensionForArtifact(kind: RunArtifactKind, mimeType?: string): string {
  if (mimeType === "application/json" || kind === "evaluation") {
    return ".json";
  }
  if (mimeType === "application/jsonl" || kind === "jsonl" || kind === "trace" || kind === "dataset") {
    return ".jsonl";
  }
  if (mimeType === "text/markdown" || kind === "report" || kind === "fileChange") {
    return ".md";
  }
  if (kind === "transcript") {
    return ".ansi.log";
  }
  if (kind === "log") {
    return ".log";
  }
  return ".artifact";
}
