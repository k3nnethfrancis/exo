import { describe, expect, it } from "vitest";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import path from "node:path";
import os from "node:os";

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
      projectKnowledgeSync: [
        {
          id: "project-control-files",
          label: "Project control files",
          description: "Canonical project-local Markdown control files mapped into an exograph.",
          scope: {
            projectRoots: ["projects/*"],
            exographRoots: ["notes/projects"],
            paths: ["**/*.md"],
          },
          canonicalFiles: [
            {
              id: "issues",
              label: "Issues",
              category: "tracker",
              names: ["issues.md"],
              patterns: [],
              targetPath: "issues.md",
            },
            {
              id: "plans-and-specs",
              label: "Plans and specs",
              category: "planning",
              names: ["roadmap.md", "tasks.md", "AGENTS.md", "CLAUDE.md"],
              patterns: ["plans/**/*.md", "specs/**/*.md"],
            },
          ],
          relationship: {
            mode: "proposal",
            targetPrefix: "projects",
          },
          conflictPolicy: {
            onDivergence: "proposeMerge",
            requireBaseHash: true,
            compareRemoteState: true,
          },
          reviewPolicy: {
            requireHumanReview: true,
            proposalRequired: true,
            allowedTargets: ["notes/projects/**", ".exo/artifacts/**"],
          },
          remote: {
            provider: "github",
            owner: "example",
            repo: "project",
            branch: "main",
            issueLabels: ["exo-sync"],
            pullRequestLabels: ["knowledge-sync"],
          },
        },
      ],
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
    expect(profile?.projectKnowledgeSync[0]).toMatchObject({
      id: "project-control-files",
      relationship: { mode: "proposal", targetPrefix: "projects" },
      conflictPolicy: { onDivergence: "proposeMerge", compareRemoteState: true },
      remote: { provider: "github", owner: "example", repo: "project" },
    });
    expect(profile?.projectKnowledgeSync[0]?.canonicalFiles[1]?.patterns).toEqual(["plans/**/*.md", "specs/**/*.md"]);
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

  it("rejects unsafe project knowledge sync paths and patterns", () => {
    expect(() =>
      profileFromCapability({
        ...profileCapability,
        compatibility: {
          profile: {
            projectKnowledgeSync: [
              {
                id: "bad",
                label: "Bad",
                canonicalFiles: [{ id: "plans", names: [], patterns: ["../plans/**/*.md"] }],
              },
            ],
          },
        },
      }),
    ).toThrow("without traversal");

    expect(() =>
      profileFromCapability({
        ...profileCapability,
        compatibility: {
          profile: {
            projectKnowledgeSync: [
              {
                id: "bad",
                label: "Bad",
                canonicalFiles: [{ id: "issues", names: ["/tmp/issues.md"], patterns: [] }],
              },
            ],
          },
        },
      }),
    ).toThrow("without traversal");
  });

  it("normalizes project knowledge sync string metadata before validating paths", () => {
    const profile = profileFromCapability({
      ...profileCapability,
      compatibility: {
        profile: {
          projectKnowledgeSync: [
            {
              id: " padded-sync ",
              label: " Padded Sync ",
              scope: {
                projectRoots: [" projects/* "],
                exographRoots: [" notes/projects "],
                paths: [" **/*.md "],
              },
              canonicalFiles: [
                {
                  id: " agents ",
                  names: [" AGENTS.md "],
                  patterns: [],
                  targetPath: " contexts/AGENTS.md ",
                },
              ],
            },
          ],
        },
      },
    });

    expect(profile?.projectKnowledgeSync[0]).toMatchObject({
      id: "padded-sync",
      label: "Padded Sync",
      scope: {
        projectRoots: ["projects/*"],
        exographRoots: ["notes/projects"],
        paths: ["**/*.md"],
      },
      canonicalFiles: [{ id: "agents", names: ["AGENTS.md"], targetPath: "contexts/AGENTS.md" }],
    });
  });

  it("keeps project knowledge sync relationship modes as inert metadata", () => {
    const root = mkdtempSync(path.join(os.tmpdir(), "exo-project-knowledge-sync-"));
    try {
      const profile = profileFromCapability({
        ...profileCapability,
        compatibility: {
          profile: {
            projectKnowledgeSync: [
              {
                id: "local-links",
                label: "Local links",
                scope: { projectRoots: ["projects/*"] },
                canonicalFiles: [{ id: "agents", names: ["AGENTS.md"], patterns: [] }],
                relationship: { mode: "symlink", targetPrefix: ".exo/project-knowledge" },
                reviewPolicy: { requireHumanReview: true, proposalRequired: true },
              },
            ],
          },
        },
      });

      expect(profile?.projectKnowledgeSync[0]?.relationship.mode).toBe("symlink");
      expect(existsSync(path.join(root, ".exo"))).toBe(false);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
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
