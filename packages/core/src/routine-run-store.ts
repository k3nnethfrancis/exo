import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import path from "node:path";

import type { RoutineDefinition } from "./routine";
import type { RunRecord } from "./run";

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
    return readJsonOrNull<RunRecord>(runRecordPath(this.layout, runId));
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
