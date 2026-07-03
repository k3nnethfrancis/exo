import { describe, expect, it } from "vitest";

import type { CapabilityMetadata } from "../capabilities";
import { profileFromCapability, profilesFromPlugin } from "../profile";
import type { DiscoveredPlugin, PluginManifest } from "../plugin";

const profileCapability: CapabilityMetadata = {
  id: "shoshin.profile",
  kind: "core:profile",
  label: "Shoshin Profile",
  description: "Shoshin exograph conventions.",
  lifecycle: "experimental",
  owner: "shoshin-profile.plugin",
  surfaces: ["desktop", "cli"],
  permissions: ["workspace:read", "notes:read"],
  compatibility: {
    profile: {
      recommendedPlugins: [
        {
          id: "graph-health.plugin",
          required: false,
          reason: "Graph maintenance reports.",
        },
      ],
      metadataSchemas: [
        {
          id: "note",
          label: "Note",
          scope: { paths: ["notes/**/*.md"] },
          frontmatter: {
            type: { type: "string", required: false },
            confidence: { type: "string", required: false },
          },
          tags: ["research", "project"],
        },
      ],
      contextTemplates: [
        {
          id: "agents",
          label: "AGENTS.md",
          target: "AGENTS.md",
          templatePath: "templates/AGENTS.md",
        },
      ],
      instructionTemplates: [
        {
          id: "claude",
          label: "CLAUDE.md",
          target: "CLAUDE.md",
          templatePath: "templates/CLAUDE.md",
        },
      ],
      mcpConfigTemplates: [
        {
          id: "claude-mcp",
          label: "Claude MCP config",
          target: ".mcp.json",
          templatePath: "templates/mcp.json",
        },
      ],
      skills: [
        {
          id: "graph-evolve",
          label: "Graph Evolve",
          harnesses: ["claude", "codex"],
          sourcePath: "skills/graph-evolve",
          required: false,
        },
      ],
      routineTemplateIds: ["graph-health.template"],
      graphViews: [
        {
          id: "default",
          label: "Default Graph",
          pluginId: "default-graph.plugin",
          viewId: "default",
        },
      ],
      analyzerSettings: [
        {
          analyzerId: "graph-health.analyzer",
          settings: { orphanThresholdDays: 30 },
        },
      ],
      reviewPolicy: {
        fileChanges: "propose",
        requireHumanReview: true,
        allowedPaths: ["notes/**", "projects/**"],
      },
      outputPolicy: {
        fileChanges: "propose",
        artifacts: "record",
        allowedPaths: [".exo/artifacts/**"],
      },
    },
  },
};

describe("profile capability metadata", () => {
  it("extracts a profile definition from capability compatibility metadata", () => {
    const profile = profileFromCapability(profileCapability);

    expect(profile).toMatchObject({
      id: "shoshin.profile",
      label: "Shoshin Profile",
      lifecycle: "experimental",
      recommendedPlugins: [{ id: "graph-health.plugin", required: false }],
      routineTemplateIds: ["graph-health.template"],
      sourceCapabilityId: "shoshin.profile",
    });
    expect(profile?.metadataSchemas[0]?.frontmatter.type).toEqual({ type: "string", required: false });
    expect(profile?.contextTemplates[0]?.templatePath).toBe("templates/AGENTS.md");
    expect(profile?.skills[0]?.harnesses).toEqual(["claude", "codex"]);
    expect(profile?.reviewPolicy?.fileChanges).toBe("propose");
    expect(profile?.outputPolicy?.artifacts).toBe("record");
  });

  it("returns null for non-profile capabilities", () => {
    expect(profileFromCapability({ ...profileCapability, kind: "core:routineTemplate" })).toBeNull();
  });

  it("filters profiles by disabled lifecycle and surface", () => {
    const plugin = discovered({
      capabilities: [
        profileCapability,
        {
          ...profileCapability,
          id: "disabled.profile",
          lifecycle: "disabled",
        },
      ],
    });

    expect(profilesFromPlugin(plugin).map((profile) => profile.id)).toEqual(["shoshin.profile"]);
    expect(profilesFromPlugin(plugin, { includeDisabled: true }).map((profile) => profile.id)).toEqual([
      "shoshin.profile",
      "disabled.profile",
    ]);
    expect(profilesFromPlugin(plugin, { surface: "mcp" })).toEqual([]);
    expect(profilesFromPlugin(plugin, { surface: "desktop" }).map((profile) => profile.sourcePluginId)).toEqual([
      "shoshin-profile.plugin",
    ]);
  });

  it("rejects missing profile payloads", () => {
    expect(() => profileFromCapability({ ...profileCapability, compatibility: undefined })).toThrow(
      "must define compatibility.profile",
    );
  });

  it("rejects unsafe profile reference paths", () => {
    expect(() =>
      profileFromCapability({
        ...profileCapability,
        compatibility: {
          profile: {
            contextTemplates: [{ id: "bad", label: "Bad", templatePath: "../outside.md" }],
          },
        },
      }),
    ).toThrow("without traversal");

    expect(() =>
      profileFromCapability({
        ...profileCapability,
        compatibility: {
          profile: {
            skills: [{ id: "bad", label: "Bad", sourcePath: "/tmp/skill" }],
          },
        },
      }),
    ).toThrow("must be a relative");
  });
});

function discovered(overrides: Partial<PluginManifest> = {}): DiscoveredPlugin {
  const manifest: PluginManifest = {
    id: "shoshin-profile.plugin",
    name: "Shoshin Profile",
    version: "0.1.0",
    exoApiVersion: "0.1",
    capabilities: [profileCapability],
    permissions: ["workspace:read", "notes:read"],
    surfaces: ["desktop", "cli"],
    ...overrides,
  };
  return {
    manifest,
    manifestPath: "/plugins/shoshin-profile/exo.plugin.json",
    rootDirectory: "/plugins/shoshin-profile",
    source: "dev",
    trust: "trusted",
    enabled: true,
    manifestHash: "hash-shoshin-profile",
  };
}
