import path from "node:path";
import os from "node:os";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

import {
  resolveRoutineRunStoreLayout,
  routineDefinitionPath,
  RoutineRunStore,
  runArtifactPath,
  runLogPath,
  runRecordPath,
  runTraceLogPath,
  runTranscriptPath,
  safeStoreFileName,
  safeStoreSegment,
} from "../routine-run-store";
import type { RoutineDefinition } from "../routine";
import type { RunRecord } from "../run";

describe("routine run store layout", () => {
  it("resolves canonical .exo routine, run, and artifact paths", () => {
    const layout = resolveRoutineRunStoreLayout("/workspace/.exo");

    expect(layout).toEqual({
      runtimeRoot: "/workspace/.exo",
      routinesDir: path.join("/workspace/.exo", "routines"),
      runsDir: path.join("/workspace/.exo", "runs"),
      artifactsDir: path.join("/workspace/.exo", "artifacts"),
    });
    expect(routineDefinitionPath(layout, "graph-health")).toBe(path.join("/workspace/.exo", "routines", "graph-health.json"));
    expect(runRecordPath(layout, "run-1")).toBe(path.join("/workspace/.exo", "runs", "run-1", "run.json"));
    expect(runTranscriptPath(layout, "run-1")).toBe(path.join("/workspace/.exo", "runs", "run-1", "transcript.ansi.log"));
    expect(runLogPath(layout, "run-1")).toBe(path.join("/workspace/.exo", "runs", "run-1", "run.log"));
    expect(runArtifactPath(layout, "run-1", "report.md")).toBe(path.join("/workspace/.exo", "artifacts", "run-1", "report.md"));
    expect(runTraceLogPath(layout, "run-1")).toBe(path.join("/workspace/.exo", "artifacts", "run-1", "trace.jsonl"));
  });

  it("sanitizes store ids without allowing empty or parent-directory identifiers", () => {
    expect(safeStoreSegment(" Alignment Routine / V0 ")).toBe("Alignment-Routine---V0");
    expect(safeStoreSegment("../../run:1")).toBe("..-..-run-1");
    expect(() => safeStoreSegment("")).toThrow("non-empty identifier");
    expect(() => safeStoreSegment("..")).toThrow("non-empty identifier");
  });

  it("rejects artifact filenames with path separators", () => {
    expect(safeStoreFileName("alignment-report.md")).toBe("alignment-report.md");
    expect(() => safeStoreFileName("../alignment-report.md")).toThrow("path separators");
    expect(() => safeStoreFileName("nested/report.md")).toThrow("path separators");
  });

  it("round-trips routine definitions and run records", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "exo-routine-run-store-"));
    try {
      const store = new RoutineRunStore(path.join(root, ".exo"));
      const routine: RoutineDefinition = {
        id: "graph-health",
        title: "Graph Health",
        prompt: "Audit the graph.",
        harnessId: "codex",
        requiredSkills: [],
        trigger: { kind: "manual" },
        scope: {
          workspaceRoot: root,
          noteRootIds: ["notes"],
          projectRootIds: [],
          paths: ["notes"],
        },
        permissions: {
          permissions: ["workspace:read", "notes:read", "artifacts:write"],
        },
        outputPolicy: {
          fileChanges: "propose",
          artifacts: "record",
          allowedPaths: [path.join(root, ".exo", "artifacts")],
        },
        enabled: true,
        createdAt: "2026-06-14T00:00:00.000Z",
        updatedAt: "2026-06-14T00:00:00.000Z",
      };
      const run: RunRecord = {
        id: "run-1",
        routineId: routine.id,
        harnessId: "codex",
        status: "queued",
        reviewState: "notRequired",
        artifacts: [],
        proposedFileChanges: [],
        errors: [],
      };

      const routinePath = await store.writeRoutine(routine);
      const runPath = await store.writeRun(run);

      expect(routinePath).toBe(path.join(root, ".exo", "routines", "graph-health.json"));
      expect(runPath).toBe(path.join(root, ".exo", "runs", "run-1", "run.json"));
      expect(await store.readRoutine(routine.id)).toEqual(routine);
      expect(await store.readRun(run.id)).toEqual(run);
      expect(await store.listRoutines()).toEqual([routine]);
      expect(await store.listRuns()).toEqual([run]);
      expect(await readFile(routinePath, "utf8")).toContain("\"title\": \"Graph Health\"");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("reads legacy run-shaped JSON without requiring activity fields", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "exo-routine-run-store-"));
    try {
      const store = new RoutineRunStore(path.join(root, ".exo"));
      const target = runRecordPath(store.layout, "legacy-run");
      const legacyRun: RunRecord = {
        id: "legacy-run",
        routineId: "routine-1",
        harnessId: "codex",
        status: "succeeded",
        reviewState: "notRequired",
        artifacts: [],
        proposedFileChanges: [],
        errors: [],
      };
      await mkdir(path.dirname(target), { recursive: true });
      await writeFile(target, `${JSON.stringify(legacyRun, null, 2)}\n`, "utf8");

      await expect(store.readRun("legacy-run")).resolves.toEqual(legacyRun);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("reads activity-shaped JSON through the run compatibility projection", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "exo-routine-run-store-"));
    try {
      const store = new RoutineRunStore(path.join(root, ".exo"));
      const target = runRecordPath(store.layout, "activity-run");
      await mkdir(path.dirname(target), { recursive: true });
      await writeFile(
        target,
        `${JSON.stringify(
          {
            id: "activity-run",
            activityType: "routine.run",
            status: "succeeded",
            reviewRef: { state: "notRequired" },
            actor: { id: "graph-health.plugin", kind: "plugin" },
            harness: { id: "codex", sessionId: "session-1" },
            routine: { id: "graph-health" },
            transcriptRef: { id: "transcript", path: path.join(root, ".exo", "runs", "activity-run", "transcript.ansi.log") },
            logRef: { id: "log", path: path.join(root, ".exo", "runs", "activity-run", "run.log") },
            artifacts: [
              {
                id: "report",
                activityId: "activity-run",
                kind: "report",
                path: path.join(root, ".exo", "artifacts", "activity-run", "report.md"),
                createdAt: "2026-06-14T00:04:00.000Z",
              },
            ],
            errors: [],
          },
          null,
          2,
        )}\n`,
        "utf8",
      );

      await expect(store.readRun("activity-run")).resolves.toMatchObject({
        id: "activity-run",
        routineId: "graph-health",
        harnessId: "codex",
        status: "succeeded",
        reviewState: "notRequired",
        transcriptPath: path.join(root, ".exo", "runs", "activity-run", "transcript.ansi.log"),
        logPath: path.join(root, ".exo", "runs", "activity-run", "run.log"),
        artifacts: [
          {
            id: "report",
            activityId: "activity-run",
            runId: "activity-run",
            kind: "report",
            path: path.join(root, ".exo", "artifacts", "activity-run", "report.md"),
            createdAt: "2026-06-14T00:04:00.000Z",
          },
        ],
        proposedFileChanges: [],
        errors: [],
      });
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("returns empty results for missing store files", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "exo-routine-run-store-"));
    try {
      const store = new RoutineRunStore(path.join(root, ".exo"));

      await expect(store.readRoutine("missing")).resolves.toBeNull();
      await expect(store.readRun("missing")).resolves.toBeNull();
      await expect(store.listRoutines()).resolves.toEqual([]);
      await expect(store.readTracePackets("missing")).resolves.toEqual([]);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("writes artifacts and records them on the run", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "exo-routine-run-store-"));
    try {
      const store = new RoutineRunStore(path.join(root, ".exo"));
      await store.writeRun(baseRun("run-artifacts"));

      const artifact = await store.writeArtifact(
        "run-artifacts",
        {
          id: "alignment-report",
          kind: "report",
          title: "Alignment Report",
          mimeType: "text/markdown",
          createdAt: "2026-06-14T00:01:00.000Z",
        },
        "# Alignment Report\n",
      );
      const run = await store.readRun("run-artifacts");

      expect(artifact.path).toBe(path.join(root, ".exo", "artifacts", "run-artifacts", "alignment-report.md"));
      expect(await readFile(artifact.path, "utf8")).toBe("# Alignment Report\n");
      expect(run?.artifacts).toEqual([artifact]);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("appends trace packets to JSONL and records a trace artifact ref on the run", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "exo-routine-run-store-"));
    try {
      const store = new RoutineRunStore(path.join(root, ".exo"));
      await store.writeRun(baseRun("run-trace"));

      const packet = await store.appendTrace("run-trace", {
        id: "trace-1",
        kind: "decision",
        timestamp: "2026-06-14T00:02:00.000Z",
        actor: "alignment-routine",
        private: true,
        evidence: [
          {
            id: "evidence-1",
            kind: "markdown",
            path: "notes/projects/alignment/protocol.md",
          },
        ],
        payload: {
          autonomyBoundary: "ask",
        },
      });

      expect(packet.runId).toBe("run-trace");
      expect(await store.readTracePackets("run-trace")).toEqual([packet]);
      expect((await store.readRun("run-trace"))?.artifacts).toEqual([
        {
          id: "trace-jsonl",
          activityId: "run-trace",
          runId: "run-trace",
          kind: "trace",
          path: runTraceLogPath(store.layout, "run-trace"),
          title: "Trace JSONL",
          mimeType: "application/jsonl",
          sourceCapabilityId: "alignment-routine",
          createdAt: "2026-06-14T00:02:00.000Z",
        },
      ]);
      expect(await readFile(runTraceLogPath(store.layout, "run-trace"), "utf8")).toBe(`${JSON.stringify(packet)}\n`);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("fails clearly when writing artifacts or traces for missing runs", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "exo-routine-run-store-"));
    try {
      const store = new RoutineRunStore(path.join(root, ".exo"));

      await expect(
        store.writeArtifact(
          "missing",
          {
            id: "report",
            kind: "report",
            createdAt: "2026-06-14T00:00:00.000Z",
          },
          "report",
        ),
      ).rejects.toThrow("Run record not found: missing");
      await expect(
        store.appendTrace("missing", {
          id: "trace-1",
          kind: "event",
          timestamp: "2026-06-14T00:00:00.000Z",
          actor: "test",
          private: false,
          evidence: [],
          payload: {},
        }),
      ).rejects.toThrow("Run record not found: missing");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});

function baseRun(id: string): RunRecord {
  return {
    id,
    routineId: "routine-1",
    harnessId: "codex",
    status: "queued",
    reviewState: "notRequired",
    artifacts: [],
    proposedFileChanges: [],
    errors: [],
  };
}
