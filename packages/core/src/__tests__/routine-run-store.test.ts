import path from "node:path";
import { describe, expect, it } from "vitest";

import {
  resolveRoutineRunStoreLayout,
  routineDefinitionPath,
  runArtifactPath,
  runLogPath,
  runRecordPath,
  runTranscriptPath,
  safeStoreFileName,
  safeStoreSegment,
} from "../routine-run-store";

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
});
