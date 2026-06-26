import { describe, expect, it } from "vitest";

import type { PluginInventory } from "../plugin-inventory";
import { planProfilePreview } from "../profile-plan";
import type { ProfileDefinition } from "../profile";

const profile: ProfileDefinition = {
  id: "test.profile",
  label: "Test Profile",
  description: "Exercises every profile plan section.",
  lifecycle: "experimental",
  recommendedPlugins: [
    { id: "ready.plugin", required: true, reason: "Ready dependency." },
    { id: "missing-required.plugin", required: true },
    { id: "missing-optional.plugin", required: false },
    { id: "disabled.plugin", required: true },
    { id: "untrusted.plugin", required: true },
  ],
  metadataSchemas: [
    {
      id: "note",
      label: "Note",
      scope: { paths: ["notes/**/*.md"] },
      frontmatter: { type: { type: "string", required: false } },
      tags: ["note"],
    },
  ],
  contextTemplates: [
    { id: "context", label: "Context", target: "AGENTS.md", templatePath: "templates/AGENTS.md" },
  ],
  instructionTemplates: [
    { id: "instructions", label: "Instructions", target: "CLAUDE.md", templatePath: "templates/CLAUDE.md" },
  ],
  mcpConfigTemplates: [{ id: "mcp", label: "MCP", target: ".mcp.json", templatePath: "templates/mcp.json" }],
  skills: [
    {
      id: "graph-skill",
      label: "Graph Skill",
      harnesses: ["claude", "codex"],
      sourcePath: "skills/graph",
      required: true,
    },
  ],
  routineTemplateIds: ["graph-health.template"],
  graphViews: [{ id: "default", label: "Default Graph", pluginId: "graph.plugin", viewId: "default" }],
  analyzerSettings: [{ analyzerId: "graph-health.analyzer", settings: { orphanThresholdDays: 30 } }],
  reviewPolicy: { fileChanges: "propose", requireHumanReview: true, allowedPaths: ["notes/**"] },
  outputPolicy: { fileChanges: "propose", artifacts: "record", allowedPaths: [".exo/artifacts/**"] },
};

describe("profile plan preview", () => {
  it("produces preview actions for all profile sections", () => {
    const preview = planProfilePreview(profile, inventory());

    expect(preview).toMatchObject({
      mode: "preview",
      writeCapable: false,
      profile: { id: "test.profile", label: "Test Profile" },
    });
    expect(preview.actions.map((action) => action.kind)).toEqual([
      "pluginRecommendation",
      "pluginRecommendation",
      "pluginRecommendation",
      "pluginRecommendation",
      "pluginRecommendation",
      "metadataSchema",
      "contextTemplate",
      "instructionTemplate",
      "mcpConfigTemplate",
      "skill",
      "routineTemplate",
      "graphView",
      "analyzerSetting",
      "reviewPolicy",
      "outputPolicy",
    ]);
    expect(preview.summary).toMatchObject({
      totalActions: 15,
      readyPluginRecommendations: 1,
    });
  });

  it("reports required missing plugins as blockers and optional missing plugins as warnings", () => {
    const preview = planProfilePreview(profile, inventory());

    expect(preview.blockers).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ actionId: "missing-required.plugin", severity: "blocker" }),
      ]),
    );
    expect(preview.warnings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ actionId: "missing-optional.plugin", severity: "warning" }),
      ]),
    );
  });

  it("does not mark untrusted or disabled recommended plugins as ready", () => {
    const preview = planProfilePreview(profile, inventory());

    expect(pluginStatus(preview, "ready.plugin")).toBe("ready");
    expect(pluginStatus(preview, "disabled.plugin")).toBe("disabled");
    expect(pluginStatus(preview, "untrusted.plugin")).toBe("untrusted");
    expect(preview.blockers).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ actionId: "disabled.plugin" }),
        expect.objectContaining({ actionId: "untrusted.plugin" }),
      ]),
    );
  });

  it("keeps templates, skills, and routines non-mutating and preview-only", () => {
    const preview = planProfilePreview(profile, inventory());
    const contextTemplate = action(preview, "contextTemplate", "context");
    const instructionTemplate = action(preview, "instructionTemplate", "instructions");
    const mcpConfigTemplate = action(preview, "mcpConfigTemplate", "mcp");
    const skill = action(preview, "skill", "graph-skill");
    const routine = action(preview, "routineTemplate", "graph-health.template");

    for (const candidate of [contextTemplate, instructionTemplate, mcpConfigTemplate, skill, routine]) {
      expect(candidate.effect).toMatchObject({ previewOnly: true, mutates: false });
    }
    expect(contextTemplate.effect.wouldWrite).toContain("AGENTS.md");
    expect(instructionTemplate.effect.wouldWrite).toContain("CLAUDE.md");
    expect(mcpConfigTemplate.effect.wouldWrite).toContain(".mcp.json");
    expect(mcpConfigTemplate.effect.wouldMutateMcpConfig).toContain("explicit confirmation");
    expect(skill.effect.wouldInstallSkills).toContain("graph-skill");
    expect(routine.effect.wouldScheduleRoutines).toContain("graph-health.template");
  });

  it("explicitly disables all mutation in the safety object", () => {
    expect(planProfilePreview(profile, inventory()).safety).toEqual({
      writesEnabled: false,
      pluginEnableEnabled: false,
      skillInstallEnabled: false,
      routineSchedulingEnabled: false,
      mcpConfigMutationEnabled: false,
    });
  });

  it("accepts plain data and does not require referenced files to exist", () => {
    const plainProfile: ProfileDefinition = JSON.parse(JSON.stringify(profile));
    plainProfile.contextTemplates = [
      {
        id: "missing-file",
        label: "Missing file",
        target: "AGENTS.md",
        templatePath: "templates/this-file-does-not-exist.md",
      },
    ];

    const preview = planProfilePreview(plainProfile, JSON.parse(JSON.stringify(inventory())));

    expect(action(preview, "contextTemplate", "missing-file").effect.wouldWrite).toContain(
      "templates/this-file-does-not-exist.md",
    );
  });
});

function inventory(): PluginInventory {
  return {
    generatedAt: "2026-06-26T00:00:00.000Z",
    items: [
      item({
        id: "ready.capability",
        pluginId: "ready.plugin",
        pluginName: "Ready Plugin",
        status: "available",
        statusLabel: "Available",
        enabled: true,
        trust: "trusted",
      }),
      item({
        id: "disabled.capability",
        pluginId: "disabled.plugin",
        pluginName: "Disabled Plugin",
        status: "disabled",
        statusLabel: "Disabled",
        enabled: false,
        trust: "trusted",
      }),
      item({
        id: "untrusted.capability",
        pluginId: "untrusted.plugin",
        pluginName: "Untrusted Plugin",
        status: "review-required",
        statusLabel: "Review required",
        enabled: true,
        trust: "untrusted",
      }),
    ],
    errors: [],
    counts: {
      total: 3,
      core: 0,
      bundled: 0,
      localManifest: 3,
      disabled: 1,
      untrusted: 1,
    },
  };
}

function item(overrides: Partial<PluginInventory["items"][number]>): PluginInventory["items"][number] {
  return {
    id: "plugin.capability",
    label: "Plugin Capability",
    description: "Capability",
    kind: "routineTemplate",
    categoryId: "routineTemplate",
    categoryLabel: "Routine templates",
    source: "localManifest",
    sourceLabel: "Developer manifest",
    lifecycle: "experimental",
    owner: "plugin",
    surfaces: ["desktop"],
    permissions: ["workspace:read"],
    enabled: true,
    trust: "trusted",
    status: "available",
    statusLabel: "Available",
    ...overrides,
  };
}

function pluginStatus(preview: ReturnType<typeof planProfilePreview>, id: string): string | undefined {
  const candidate = preview.actions.find(
    (previewAction) => previewAction.kind === "pluginRecommendation" && previewAction.id === id,
  );
  return candidate?.kind === "pluginRecommendation" ? candidate.pluginStatus : undefined;
}

function action(
  preview: ReturnType<typeof planProfilePreview>,
  kind: ReturnType<typeof planProfilePreview>["actions"][number]["kind"],
  id: string,
): ReturnType<typeof planProfilePreview>["actions"][number] {
  const candidate = preview.actions.find((previewAction) => previewAction.kind === kind && previewAction.id === id);
  expect(candidate).toBeTruthy();
  return candidate!;
}
