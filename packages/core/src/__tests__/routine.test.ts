import { describe, expect, it } from "vitest";

import type { AgentHarness } from "../agent-harness";
import { missingRequiredHarnessSkills, normalizeRoutineDefinition, type RoutineDefinition } from "../routine";

const baseRoutine: RoutineDefinition = {
  id: "routine-1",
  title: "Graph Health",
  prompt: "Run the graph health check and write a report.",
  harnessId: "codex",
  execution: { kind: "agentPrompt", prompt: "Run the graph health check and write a report.", harnessId: "codex" },
  requiredSkills: [
    { id: "graph-health", label: "Graph Health", required: true },
    { id: "optional-style", label: "Optional Style", required: false },
  ],
  trigger: { kind: "manual" },
  scope: {
    workspaceRoot: "/tmp/exo",
    noteRootIds: ["notes"],
    projectRootIds: [],
    paths: [],
  },
  permissions: {
    permissions: ["workspace:read", "notes:read", "artifacts:write"],
  },
  outputPolicy: {
    fileChanges: "propose",
    artifacts: "record",
    allowedPaths: ["/tmp/exo/.exo/artifacts"],
  },
  enabled: true,
  createdAt: "2026-06-14T00:00:00.000Z",
  updatedAt: "2026-06-14T00:00:00.000Z",
};

describe("routine contracts", () => {
  it("reports missing required harness skills", () => {
    expect(missingRequiredHarnessSkills(baseRoutine, harnessWithSkills([]))).toEqual([
      { id: "graph-health", label: "Graph Health", required: true },
    ]);
  });

  it("ignores optional missing skills and disabled harness skills", () => {
    expect(
      missingRequiredHarnessSkills(
        baseRoutine,
        harnessWithSkills([
          { id: "graph-health", label: "Graph Health", source: "filesystem", enabled: false },
          { id: "optional-style", label: "Optional Style", source: "filesystem", enabled: false },
        ]),
      ),
    ).toEqual([{ id: "graph-health", label: "Graph Health", required: true }]);
  });

  it("accepts enabled matching harness skills", () => {
    expect(
      missingRequiredHarnessSkills(
        baseRoutine,
        harnessWithSkills([{ id: "graph-health", label: "Graph Health", source: "filesystem", enabled: true }]),
      ),
    ).toEqual([]);
  });

  it("normalizes legacy prompt routines to agentPrompt execution", () => {
    const { execution: _execution, ...legacyRoutine } = baseRoutine;

    expect(normalizeRoutineDefinition(legacyRoutine).execution).toEqual({
      kind: "agentPrompt",
      prompt: "Run the graph health check and write a report.",
      harnessId: "codex",
    });
  });
});

function harnessWithSkills(skills: AgentHarness["skills"]): Pick<AgentHarness, "skills"> {
  return { skills };
}
