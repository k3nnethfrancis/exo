import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";

import { copyProfileToWorkspacePlugin } from "../profile-copy";
import { readPluginStateStore } from "../plugin-state";
import { readProfileStateStore } from "../profile-state";

describe("profile copy", () => {
  it("creates a trusted workspace-local metadata profile and makes it active", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "exo-profile-copy-"));
    try {
      const sourceRoot = path.join(root, "source");
      await writeProfilePlugin(sourceRoot, "source-profile.plugin", "source-profile.profile");

      const result = await copyProfileToWorkspacePlugin({
        workspaceRoot: root,
        runtimeRoot: path.join(root, ".exo"),
        sourceProfile: {
          profileId: "source-profile.profile",
          capabilityId: "source-profile.profile",
          pluginId: "source-profile.plugin",
          source: "built-in",
          manifestPath: path.join(sourceRoot, "plugins", "source-profile", "exo.plugin.json"),
          rootDirectory: path.join(sourceRoot, "plugins", "source-profile"),
        },
        env: { EXO_PROJECT_ROOT: sourceRoot },
        now: () => "2026-06-28T12:00:00.000Z",
      });

      expect(result.identity).toMatchObject({
        profileId: "source-profile.profile-copy.profile",
        capabilityId: "source-profile.profile-copy.profile",
        pluginId: "source-profile.profile-copy.plugin",
        source: "workspace",
      });
      expect(result.rootDirectory).toBe(path.join(root, ".exo", "plugins", "source-profile.profile-copy"));

      const manifest = JSON.parse(await readFile(result.manifestPath, "utf8"));
      expect(manifest).toMatchObject({
        id: "source-profile.profile-copy.plugin",
        name: "Source Profile Copy",
        capabilities: [
          {
            id: "source-profile.profile-copy.profile",
            kind: "core:profile",
            owner: "source-profile.profile-copy.plugin",
            compatibility: {
              profile: {
                id: "source-profile.profile-copy.profile",
                label: "Source Profile Copy",
                recommendedPlugins: [{ id: "qmd", required: false }],
              },
            },
          },
        ],
      });
      expect(manifest.entrypoints).toBeUndefined();

      await expect(readPluginStateStore(path.join(root, ".exo"))).resolves.toMatchObject({
        plugins: [
          expect.objectContaining({
            pluginId: "source-profile.profile-copy.plugin",
            trust: "trusted",
            enabled: true,
            reviewedAt: "2026-06-28T12:00:00.000Z",
          }),
        ],
      });
      await expect(readProfileStateStore(path.join(root, ".exo"))).resolves.toMatchObject({
        activeProfile: result.identity,
        reviewRequired: true,
        updatedAt: "2026-06-28T12:00:00.000Z",
      });
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("chooses a unique workspace plugin folder for repeated copies", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "exo-profile-copy-repeat-"));
    try {
      const sourceRoot = path.join(root, "source");
      await writeProfilePlugin(sourceRoot, "source-profile.plugin", "source-profile.profile");
      const sourceProfile = {
        profileId: "source-profile.profile",
        capabilityId: "source-profile.profile",
        pluginId: "source-profile.plugin",
        source: "built-in" as const,
        manifestPath: path.join(sourceRoot, "plugins", "source-profile", "exo.plugin.json"),
        rootDirectory: path.join(sourceRoot, "plugins", "source-profile"),
      };

      const first = await copyProfileToWorkspacePlugin({
        workspaceRoot: root,
        runtimeRoot: path.join(root, ".exo"),
        sourceProfile,
        env: { EXO_PROJECT_ROOT: sourceRoot },
      });
      const second = await copyProfileToWorkspacePlugin({
        workspaceRoot: root,
        runtimeRoot: path.join(root, ".exo"),
        sourceProfile,
        env: { EXO_PROJECT_ROOT: sourceRoot },
      });

      expect(first.rootDirectory).toBe(path.join(root, ".exo", "plugins", "source-profile.profile-copy"));
      expect(second.rootDirectory).toBe(path.join(root, ".exo", "plugins", "source-profile.profile-copy-2"));
      expect(second.identity.profileId).toBe("source-profile.profile-copy-2.profile");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("fails clearly when the source profile is not discovered", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "exo-profile-copy-missing-"));
    try {
      await expect(copyProfileToWorkspacePlugin({
        workspaceRoot: root,
        runtimeRoot: path.join(root, ".exo"),
        sourceProfile: {
          profileId: "missing",
          capabilityId: "missing.profile",
        },
        env: {},
      })).rejects.toThrow("Source profile not found: missing.profile");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});

async function writeProfilePlugin(sourceRoot: string, pluginId: string, capabilityId: string): Promise<void> {
  const pluginRoot = path.join(sourceRoot, "plugins", "source-profile");
  await mkdir(pluginRoot, { recursive: true });
  await writeFile(path.join(pluginRoot, "exo.plugin.json"), `${JSON.stringify({
    id: pluginId,
    name: "Source Profile",
    version: "0.1.0",
    exoApiVersion: "0.1",
    description: "Source profile for copy tests.",
    capabilities: [
      {
        id: capabilityId,
        kind: "core:profile",
        label: "Source Profile",
        description: "Source profile capability.",
        lifecycle: "experimental",
        owner: pluginId,
        surfaces: ["desktop"],
        permissions: ["workspace:read", "notes:read"],
        compatibility: {
          profile: {
            id: capabilityId,
            label: "Source Profile",
            description: "Source profile payload.",
            recommendedPlugins: [{ id: "qmd", required: false }],
            metadataSchemas: [],
            contextTemplates: [],
            instructionTemplates: [],
            mcpConfigTemplates: [],
            skills: [],
            routineTemplateIds: [],
            graphViews: [],
            analyzerSettings: [],
          },
        },
      },
    ],
    permissions: ["workspace:read", "notes:read"],
    surfaces: ["desktop"],
  }, null, 2)}\n`, "utf8");
}
