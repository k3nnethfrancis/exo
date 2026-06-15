import path from "node:path";
import os from "node:os";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { describe, expect, it } from "vitest";

import {
  resolveRoutineRunStoreLayout,
  routineDefinitionPath,
  RoutineRunStore,
  runArtifactPath,
  runLogPath,
  runRecordPath,
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
  });

  it("sanitizes store ids without allowing empty or parent-directory identifiers", () => {
    expect(safeStoreSegment(" Guardian Angel / V0 ")).toBe("Guardian-Angel---V0");
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
      expect(await readFile(routinePath, "utf8")).toContain("\"title\": \"Graph Health\"");
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
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
