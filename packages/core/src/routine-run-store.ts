import path from "node:path";

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
