import path from "node:path";
import os from "node:os";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { describe, expect, it } from "vitest";

import { RoutineExecutor, type RoutineExecutionHost } from "../routine-executor";
import { RoutineRunStore } from "../routine-run-store";
import type { RoutineDefinition } from "../routine";

const routine: RoutineDefinition = {
  id: "guardian-angel-smoke",
  title: "Guardian Angel Smoke",
  prompt: "Run a small GA smoke workflow.",
  harnessId: "codex",
  requiredSkills: [],
  trigger: { kind: "manual" },
  scope: {
    workspaceRoot: "/workspace",
    noteRootIds: [],
    projectRootIds: [],
    paths: [],
  },
  permissions: {
    permissions: ["workspace:read", "notes:read", "artifacts:write"],
  },
  outputPolicy: {
    fileChanges: "propose",
    artifacts: "record",
    allowedPaths: ["/workspace/.exo/artifacts"],
  },
  enabled: true,
  createdAt: "2026-06-14T00:00:00.000Z",
  updatedAt: "2026-06-14T00:00:00.000Z",
};

describe("routine executor", () => {
  it("runs a manual routine through a host and records artifacts and traces", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "exo-routine-executor-"));
    try {
      const store = new RoutineRunStore(path.join(root, ".exo"));
      const host: RoutineExecutionHost = {
        execute: async (_routine, run) => ({
          artifacts: [
            {
              artifact: {
                id: "report",
                kind: "report",
                title: "GA Report",
                mimeType: "text/markdown",
                createdAt: "2026-06-14T00:01:00.000Z",
              },
              contents: "# GA Report\n",
            },
          ],
          tracePackets: [
            {
              id: "trace-1",
              kind: "decision",
              timestamp: "2026-06-14T00:02:00.000Z",
              actor: "guardian-angel",
              private: true,
              evidence: [],
              payload: { runId: run.id },
            },
          ],
        }),
      };
      const executor = new RoutineExecutor(store, host, fixedRunIds("run-1"), fixedClock());

      const run = await executor.runManual(routine);

      expect(run).toMatchObject({
        id: "run-1",
        routineId: routine.id,
        harnessId: "codex",
        status: "succeeded",
        reviewState: "notRequired",
        startedAt: "2026-06-14T00:00:00.000Z",
        completedAt: "2026-06-14T00:00:01.000Z",
      });
      expect(run.artifacts).toHaveLength(1);
      expect(run.tracePackets).toHaveLength(1);
      expect(await readFile(run.artifacts[0]!.path, "utf8")).toBe("# GA Report\n");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("marks routine results as pending review when requested", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "exo-routine-executor-"));
    try {
      const store = new RoutineRunStore(path.join(root, ".exo"));
      const executor = new RoutineExecutor(
        store,
        {
          execute: async () => ({
            proposedFileChanges: ["notes/projects/guardian-angel/proposal.md"],
            needsReview: true,
          }),
        },
        fixedRunIds("run-review"),
        fixedClock(),
      );

      const run = await executor.runManual(routine);

      expect(run.status).toBe("needsReview");
      expect(run.reviewState).toBe("pending");
      expect(run.proposedFileChanges).toEqual(["notes/projects/guardian-angel/proposal.md"]);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("records host failures on the run record", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "exo-routine-executor-"));
    try {
      const store = new RoutineRunStore(path.join(root, ".exo"));
      const executor = new RoutineExecutor(
        store,
        {
          execute: async () => {
            throw new Error("harness failed");
          },
        },
        fixedRunIds("run-failed"),
        fixedClock(),
      );

      const run = await executor.runManual(routine);

      expect(run.status).toBe("failed");
      expect(run.errors).toEqual([{ message: "harness failed" }]);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("rejects disabled and non-manual routines before creating a run", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "exo-routine-executor-"));
    try {
      const store = new RoutineRunStore(path.join(root, ".exo"));
      const executor = new RoutineExecutor(
        store,
        {
          execute: async () => ({}),
        },
        fixedRunIds("run-unused"),
        fixedClock(),
      );

      await expect(executor.runManual({ ...routine, enabled: false })).rejects.toThrow("Routine is disabled");
      await expect(executor.runManual({ ...routine, trigger: { kind: "schedule", schedule: "0 8 * * *" } })).rejects.toThrow(
        "Routine is not manual-triggered",
      );
      await expect(store.readRun("run-unused")).resolves.toBeNull();
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});

function fixedRunIds(id: string) {
  return {
    createRunId: () => id,
  };
}

function fixedClock() {
  const values = ["2026-06-14T00:00:00.000Z", "2026-06-14T00:00:01.000Z", "2026-06-14T00:00:02.000Z"];
  return () => values.shift() ?? "2026-06-14T00:00:03.000Z";
}
