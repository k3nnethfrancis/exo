import path from "node:path";
import os from "node:os";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

import { EXO_PLUGIN_MANIFEST_FILE } from "../plugin";
import { RoutineService, routinePluginDirectoriesFromEnv } from "../routine-service";
import type { WorkspaceModel } from "../types";

describe("routine service", () => {
  it("discovers plugin routine templates and instantiates concrete routines", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "exo-routine-service-"));
    try {
      const pluginDir = await writeRoutinePlugin(root);
      const service = new RoutineService({
        workspace: workspace(root),
        runtimeRoot: path.join(root, ".exo"),
        pluginDirectories: [{ path: pluginDir, source: "dev", trust: "trusted" }],
        clock: fixedClock(),
      });

      const templates = await service.listTemplates();
      const routine = await service.createRoutineFromTemplate("graph-health.template", {
        id: "graph-health-weekly",
        scope: {
          workspaceRoot: root,
          noteRootIds: ["note-root-1"],
          projectRootIds: [],
          paths: ["notes"],
        },
      });

      expect(templates.map((template) => template.id)).toEqual(["graph-health.template"]);
      expect(routine).toMatchObject({
        id: "graph-health-weekly",
        title: "Graph Health",
        harnessId: "codex",
        createdAt: "2026-06-16T00:00:00.000Z",
      });
      await expect(service.listRoutines()).resolves.toEqual([routine]);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("does not list or instantiate untrusted workspace routine templates by default", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "exo-routine-service-"));
    try {
      const pluginDir = await writeRoutinePlugin(root);
      const service = new RoutineService({
        workspace: workspace(root),
        runtimeRoot: path.join(root, ".exo"),
        pluginDirectories: [{ path: pluginDir, source: "workspace" }],
        clock: fixedClock(),
      });

      await expect(service.listTemplates()).resolves.toEqual([]);
      await expect(service.createRoutineFromTemplate("graph-health.template", {
        id: "graph-health-weekly",
        scope: {
          workspaceRoot: root,
          noteRootIds: ["note-root-1"],
          projectRootIds: [],
          paths: ["notes"],
        },
      })).rejects.toThrow("Routine template not found: graph-health.template");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("excludes disabled and non-CLI routine template capabilities by default", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "exo-routine-service-"));
    try {
      const pluginDir = await writeRoutinePlugin(root, {
        capabilities: [
          routineTemplateCapability(),
          routineTemplateCapability({ id: "disabled.template", label: "Disabled Template", lifecycle: "disabled" }),
          routineTemplateCapability({ id: "desktop-only.template", label: "Desktop Only", surfaces: ["desktop"] }),
        ],
      });
      const service = new RoutineService({
        workspace: workspace(root),
        runtimeRoot: path.join(root, ".exo"),
        pluginDirectories: [{ path: pluginDir, source: "dev", trust: "trusted" }],
        clock: fixedClock(),
      });

      await expect(service.listTemplates()).resolves.toMatchObject([{ id: "graph-health.template" }]);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("records dry-run artifacts and traces for manual routines", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "exo-routine-service-"));
    try {
      const pluginDir = await writeRoutinePlugin(root);
      const service = new RoutineService({
        workspace: workspace(root),
        runtimeRoot: path.join(root, ".exo"),
        pluginDirectories: [{ path: pluginDir, source: "dev", trust: "trusted" }],
        clock: fixedClock(),
      });
      await service.createRoutineFromTemplate("graph-health.template", {
        id: "graph-health-manual",
        scope: {
          workspaceRoot: root,
          noteRootIds: ["note-root-1"],
          projectRootIds: [],
          paths: ["notes"],
        },
      });

      const { run } = await service.runManualDryRun("graph-health-manual");

      expect(run.status).toBe("succeeded");
      expect(run.artifacts.map((artifact) => artifact.kind).sort()).toEqual(["report", "trace"]);
      await expect(service.listRuns({ routineId: "graph-health-manual" })).resolves.toEqual([run]);
      await expect(service.requireRun(run.id)).resolves.toEqual(run);
      await expect(service.readArtifact(run.id, "dry-run-report")).resolves.toMatchObject({
        artifactId: "dry-run-report",
        contents: expect.stringContaining("# Routine Dry Run"),
      });
      await expect(readFile(run.artifacts[0]!.path, "utf8")).resolves.toContain("# Routine Dry Run");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("rejects missing required skills before invoking the routine host", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "exo-routine-service-"));
    try {
      const pluginDir = await writeRoutinePlugin(root, {
        capabilities: [
          routineTemplateCapability({}, {
            requiredSkills: [{ id: "graph-health", label: "Graph Health", required: true }],
          }),
        ],
      });
      const service = new RoutineService({
        workspace: workspace(root),
        runtimeRoot: path.join(root, ".exo"),
        pluginDirectories: [{ path: pluginDir, source: "dev", trust: "trusted" }],
        clock: fixedClock(),
      });
      await service.createRoutineFromTemplate("graph-health.template", {
        id: "graph-health-manual",
        scope: {
          workspaceRoot: root,
          noteRootIds: ["note-root-1"],
          projectRootIds: [],
          paths: ["notes"],
        },
      });
      let launched = false;

      await expect(service.runManualWithHost("graph-health-manual", {
        execute: async () => {
          launched = true;
          return {};
        },
      }, { harness: { skills: [] } })).rejects.toThrow("missing required harness skills: graph-health");
      expect(launched).toBe(false);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("rejects disallowed permissions and unsupported output policy before invoking the routine host", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "exo-routine-service-"));
    try {
      const pluginDir = await writeRoutinePlugin(root, {
        capabilities: [
          routineTemplateCapability({}, {
            permissions: { permissions: ["workspace:read", "network:access"] },
            outputPolicy: {
              fileChanges: "apply",
              artifacts: "record",
              allowedPaths: [".exo/artifacts"],
            },
          }),
        ],
      });
      const service = new RoutineService({
        workspace: workspace(root),
        runtimeRoot: path.join(root, ".exo"),
        pluginDirectories: [{ path: pluginDir, source: "dev", trust: "trusted" }],
        clock: fixedClock(),
      });
      await service.createRoutineFromTemplate("graph-health.template", {
        id: "unsafe-routine",
        scope: {
          workspaceRoot: root,
          noteRootIds: ["note-root-1"],
          projectRootIds: [],
          paths: ["notes"],
        },
      });
      let launched = false;

      await expect(service.runManualWithHost("unsafe-routine", {
        execute: async () => {
          launched = true;
          return {};
        },
      }, { harness: { skills: [] } })).rejects.toThrow(/disallowed permissions: network:access[\s\S]*unsupported output policy fileChanges=apply/);
      expect(launched).toBe(false);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("dry-runs scheduled routines without rewriting their stored trigger", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "exo-routine-service-"));
    try {
      const pluginDir = await writeRoutinePlugin(root);
      const service = new RoutineService({
        workspace: workspace(root),
        runtimeRoot: path.join(root, ".exo"),
        pluginDirectories: [{ path: pluginDir, source: "dev", trust: "trusted" }],
        clock: fixedClock(),
      });
      const routine = await service.createRoutineFromTemplate("graph-health.template", {
        id: "graph-health-weekly",
        scope: {
          workspaceRoot: root,
          noteRootIds: ["note-root-1"],
          projectRootIds: [],
          paths: ["notes"],
        },
        trigger: { kind: "schedule", schedule: "0 8 * * 1" },
      });

      const { run } = await service.runManualDryRun("graph-health-weekly");

      expect(run.status).toBe("succeeded");
      await expect(service.readRoutine("graph-health-weekly")).resolves.toMatchObject({
        trigger: routine.trigger,
      });
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("resolves plugin directories from explicit and default environment paths", () => {
    const explicit = routinePluginDirectoriesFromEnv("/workspace", { EXO_PLUGIN_DIRS: ["/plugins/a", "/plugins/b"].join(path.delimiter) });
    expect(explicit).toEqual([
      { path: "/plugins/a", source: "dev", trust: "trusted", enabled: true },
      { path: "/plugins/b", source: "dev", trust: "trusted", enabled: true },
    ]);

    expect(routinePluginDirectoriesFromEnv("/workspace", { EXO_PROJECT_ROOT: "/repo/exo", EXO_USER_DATA_PATH: "/user-data" })).toEqual([
      { path: path.join("/repo/exo", "plugins"), source: "built-in", trust: "trusted", enabled: true },
      { path: path.join("/user-data", "plugins"), source: "user", trust: "untrusted", enabled: true },
      { path: path.join("/workspace", ".exo", "plugins"), source: "workspace", trust: "untrusted", enabled: true },
    ]);
  });
});

async function writeRoutinePlugin(root: string, options: { capabilities?: unknown[] } = {}): Promise<string> {
  const pluginsRoot = path.join(root, "plugins");
  const pluginRoot = path.join(pluginsRoot, "graph-health");
  await mkdir(pluginRoot, { recursive: true });
  await writeFile(
    path.join(pluginRoot, EXO_PLUGIN_MANIFEST_FILE),
    JSON.stringify(
      {
        id: "graph-health.plugin",
        name: "Graph Health Plugin",
        version: "0.1.0",
        exoApiVersion: "0.1",
        capabilities: options.capabilities ?? [routineTemplateCapability()],
        permissions: ["workspace:read", "notes:read", "artifacts:write"],
        surfaces: ["cli", "desktop"],
      },
      null,
      2,
    ),
    "utf8",
  );
  return pluginsRoot;
}

function routineTemplateCapability(overrides: Record<string, unknown> = {}, templateOverrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: "graph-health.template",
    kind: "core:routineTemplate",
    label: "Graph Health",
    description: "Audit graph structure and write a report.",
    lifecycle: "experimental",
    owner: "graph-health.plugin",
    surfaces: ["cli", "desktop"],
    permissions: ["workspace:read", "notes:read", "artifacts:write"],
    compatibility: {
      routineTemplate: {
        prompt: "Audit the selected exograph and write a graph health report.",
        harnessId: "codex",
        requiredSkills: [],
        trigger: { kind: "manual" },
        permissions: { permissions: ["workspace:read", "notes:read", "artifacts:write"] },
        outputPolicy: {
          fileChanges: "propose",
          artifacts: "record",
          allowedPaths: [".exo/artifacts"],
        },
        ...templateOverrides,
      },
    },
    ...overrides,
  };
}

function workspace(root: string): WorkspaceModel {
  return {
    workspaceRoot: root,
    defaultTerminalCwd: root,
    noteRoots: [{ id: "note-root-1", label: "notes", path: path.join(root, "notes"), kind: "notes" }],
    projectRoots: [],
    indexedRoots: [],
    indexing: { enabled: false, mode: "off", backend: "qmd" },
    attachedWorkcells: [],
  };
}

function fixedClock() {
  const values = [
    "2026-06-16T00:00:00.000Z",
    "2026-06-16T00:00:01.000Z",
    "2026-06-16T00:00:02.000Z",
    "2026-06-16T00:00:03.000Z",
  ];
  return () => values.shift() ?? "2026-06-16T00:00:04.000Z";
}
