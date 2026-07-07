import { describe, expect, it } from "vitest";

import type { CapabilityMetadata } from "../capabilities";
import type { DiscoveredPlugin } from "../plugin";
import {
  instantiateRoutineTemplate,
  routineTemplateFromCapability,
  routineTemplatesFromPlugin,
  type RoutineTemplateDefinition,
} from "../routine-template";

const templateCapability: CapabilityMetadata = {
  id: "graph-health.template",
  kind: "core:routineTemplate",
  label: "Graph Health",
  description: "Audit graph structure and write a review artifact.",
  lifecycle: "experimental",
  owner: "example.plugin",
  surfaces: ["desktop", "cli"],
  permissions: ["workspace:read", "notes:read", "artifacts:write"],
  compatibility: {
    routineTemplate: {
      prompt: "Audit the selected exograph and write a graph health report.",
      harnessId: "codex",
      requiredSkills: [{ id: "graph-health", label: "Graph Health", required: true }],
      trigger: { kind: "manual" },
      permissions: {
        permissions: ["workspace:read", "notes:read", "artifacts:write"],
      },
      outputPolicy: {
        fileChanges: "propose",
        artifacts: "record",
        allowedPaths: [".exo/artifacts"],
      },
    },
  },
};

const templatePayload = templateCapability.compatibility!.routineTemplate as Record<string, unknown>;

describe("routine template contracts", () => {
  it("extracts routine templates from routineTemplate capabilities", () => {
    const template = routineTemplateFromCapability(templateCapability);

    expect(template).toEqual({
      id: "graph-health.template",
      title: "Graph Health",
      description: "Audit graph structure and write a review artifact.",
      prompt: "Audit the selected exograph and write a graph health report.",
      harnessId: "codex",
      execution: { kind: "agentPrompt", prompt: "Audit the selected exograph and write a graph health report.", harnessId: "codex" },
      requiredSkills: [{ id: "graph-health", label: "Graph Health", required: true }],
      trigger: { kind: "manual" },
      permissions: {
        permissions: ["workspace:read", "notes:read", "artifacts:write"],
      },
      outputPolicy: {
        fileChanges: "propose",
        artifacts: "record",
        allowedPaths: [".exo/artifacts"],
      },
      sourceCapabilityId: "graph-health.template",
    });
  });

  it("returns null for non-routine capabilities", () => {
    expect(
      routineTemplateFromCapability({
        ...templateCapability,
        id: "qmd",
        kind: "core:searchProvider",
      }),
    ).toBeNull();
  });

  it("extracts templates from discovered plugins with source metadata", () => {
    expect(routineTemplatesFromPlugin(discoveredPlugin()).map(({ sourceCapabilityId, sourcePluginId }) => ({ sourceCapabilityId, sourcePluginId }))).toEqual([
      {
        sourceCapabilityId: "graph-health.template",
        sourcePluginId: "example.plugin",
      },
    ]);
  });

  it("filters disabled and wrong-surface template capabilities", () => {
    expect(
      routineTemplatesFromPlugin(discoveredPlugin([
        templateCapability,
        { ...templateCapability, id: "disabled.template", label: "Disabled", lifecycle: "disabled" },
        { ...templateCapability, id: "internal.template", label: "Internal", surfaces: ["internal"] },
      ]), { surface: "cli" }).map((template) => template.id),
    ).toEqual(["graph-health.template"]);
  });

  it("instantiates concrete user routines from templates", () => {
    const routine = instantiateRoutineTemplate(routineTemplateFromCapability(templateCapability)!, {
      id: "graph-health-weekly",
      scope: {
        workspaceRoot: "/workspace",
        noteRootIds: ["notes"],
        projectRootIds: [],
        paths: ["notes"],
      },
      trigger: { kind: "schedule", schedule: "0 8 * * 1", timezone: "America/Los_Angeles" },
      now: "2026-06-15T00:00:00.000Z",
    });

    expect(routine).toMatchObject({
      id: "graph-health-weekly",
      title: "Graph Health",
      prompt: "Audit the selected exograph and write a graph health report.",
      harnessId: "codex",
      execution: { kind: "agentPrompt", prompt: "Audit the selected exograph and write a graph health report.", harnessId: "codex" },
      trigger: { kind: "schedule", schedule: "0 8 * * 1", timezone: "America/Los_Angeles" },
      enabled: true,
      createdAt: "2026-06-15T00:00:00.000Z",
      updatedAt: "2026-06-15T00:00:00.000Z",
    });
  });

  it("allows explicit overrides during instantiation", () => {
    const routine = instantiateRoutineTemplate(baseTemplate(), {
      id: "custom",
      title: "Custom Review",
      prompt: "Use the custom prompt.",
      harnessId: "claude",
      enabled: false,
      scope: {
        workspaceRoot: "/workspace",
        noteRootIds: [],
        projectRootIds: ["exo"],
        paths: ["projects/exo"],
      },
      outputPolicy: {
        fileChanges: "none",
        artifacts: "record",
        allowedPaths: [".exo/artifacts/custom"],
      },
      now: "2026-06-15T00:00:00.000Z",
    });

    expect(routine).toMatchObject({
      id: "custom",
      title: "Custom Review",
      prompt: "Use the custom prompt.",
      harnessId: "claude",
      execution: { kind: "agentPrompt", prompt: "Use the custom prompt.", harnessId: "claude" },
      enabled: false,
      outputPolicy: {
        fileChanges: "none",
        artifacts: "record",
        allowedPaths: [".exo/artifacts/custom"],
      },
    });
  });

  it("fails clearly when routine template capabilities omit template payloads", () => {
    expect(() =>
      routineTemplateFromCapability({
        ...templateCapability,
        compatibility: {},
      }),
    ).toThrow("must define compatibility.routineTemplate");
  });

  it("defaults legacy routine templates to agentPrompt execution", () => {
    const template = routineTemplateFromCapability({
      ...templateCapability,
      compatibility: {
        routineTemplate: {
          ...templatePayload,
          execution: undefined,
        },
      },
    });

    expect(template?.execution).toEqual({
      kind: "agentPrompt",
      prompt: "Audit the selected exograph and write a graph health report.",
      harnessId: "codex",
    });
  });

  it("parses shellCommand execution metadata without making it runnable", () => {
    const template = routineTemplateFromCapability({
      ...templateCapability,
      compatibility: {
        routineTemplate: {
          ...templatePayload,
          execution: {
            kind: "shellCommand",
            command: "pnpm",
            args: ["test"],
            cwd: "/workspace",
          },
        },
      },
    });

    expect(template?.execution).toEqual({
      kind: "shellCommand",
      command: "pnpm",
      args: ["test"],
      cwd: "/workspace",
    });
  });

  it("fails clearly on malformed routine template policies", () => {
    expect(() =>
      routineTemplateFromCapability({
        ...templateCapability,
        compatibility: {
          routineTemplate: {
            ...templatePayload,
            outputPolicy: {
              fileChanges: "rewrite",
              artifacts: "record",
              allowedPaths: [".exo/artifacts"],
            },
          },
        },
      }),
    ).toThrow("outputPolicy.fileChanges is unsupported");
    expect(() =>
      routineTemplateFromCapability({
        ...templateCapability,
        compatibility: {
          routineTemplate: {
            ...templatePayload,
            permissions: {
              permissions: ["workspace:read", "filesystem:all"],
            },
          },
        },
      }),
    ).toThrow("permissions.permissions contains unsupported value");
  });
});

function baseTemplate(): RoutineTemplateDefinition {
  return routineTemplateFromCapability(templateCapability)!;
}

function discoveredPlugin(capabilities: CapabilityMetadata[] = [templateCapability]): DiscoveredPlugin {
  return {
    manifest: {
      id: "example.plugin",
      name: "Example Plugin",
      version: "0.1.0",
      exoApiVersion: "0.1",
      capabilities,
      permissions: ["workspace:read", "notes:read", "artifacts:write"],
      surfaces: ["desktop", "cli"],
    },
    manifestPath: "/plugins/example/exo.plugin.json",
    rootDirectory: "/plugins/example",
    source: "dev",
    trust: "trusted",
    enabled: true,
    manifestHash: "hash-example",
  };
}
