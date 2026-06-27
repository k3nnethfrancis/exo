import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";

import { applyPluginStateAction } from "../plugin-management";
import { readPluginStateStore } from "../plugin-state";

describe("plugin management", () => {
  it("trusts a local plugin by capability id", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "exo-plugin-management-"));
    try {
      const pluginsRoot = await writePlugin(root, "workspace-tools.plugin", "workspace-tools.profile");

      const result = await applyPluginStateAction({
        workspaceRoot: root,
        runtimeRoot: path.join(root, ".exo"),
        pluginId: "workspace-tools.profile",
        action: "trust",
        env: { EXO_PLUGIN_DIRS: pluginsRoot },
        now: () => "2026-06-27T00:00:00.000Z",
      });

      expect(result).toMatchObject({
        action: "trust",
        pluginId: "workspace-tools.plugin",
        capabilityIds: ["workspace-tools.profile"],
        state: { trust: "trusted", enabled: true, reviewRequired: false, status: "available" },
      });
      await expect(readPluginStateStore(path.join(root, ".exo"))).resolves.toMatchObject({
        plugins: [expect.objectContaining({
          pluginId: "workspace-tools.plugin",
          trust: "trusted",
          enabled: true,
          reviewedAt: "2026-06-27T00:00:00.000Z",
        })],
      });
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("disables a local plugin by plugin id", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "exo-plugin-management-"));
    try {
      const pluginsRoot = await writePlugin(root, "workspace-tools.plugin", "workspace-tools.profile");

      const result = await applyPluginStateAction({
        workspaceRoot: root,
        runtimeRoot: path.join(root, ".exo"),
        pluginId: "workspace-tools.plugin",
        action: "disable",
        env: { EXO_PLUGIN_DIRS: pluginsRoot },
      });

      expect(result).toMatchObject({
        action: "disable",
        pluginId: "workspace-tools.plugin",
        state: { enabled: false, reviewRequired: false, status: "disabled" },
      });
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("keeps official repository manifests read-only for this phase", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "exo-plugin-management-"));
    try {
      const sourceRoot = path.join(root, "source");
      await writePlugin(sourceRoot, "official.plugin", "official.profile");

      await expect(applyPluginStateAction({
        workspaceRoot: root,
        runtimeRoot: path.join(root, ".exo"),
        pluginId: "official.plugin",
        action: "disable",
        env: { EXO_PROJECT_ROOT: sourceRoot },
      })).rejects.toThrow("Official plugin manifests are read-only");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});

async function writePlugin(root: string, pluginId: string, capabilityId: string): Promise<string> {
  const pluginsRoot = path.join(root, "plugins");
  const pluginRoot = path.join(pluginsRoot, pluginId.replace(/\.plugin$/, ""));
  await mkdir(pluginRoot, { recursive: true });
  await writeFile(path.join(pluginRoot, "exo.plugin.json"), JSON.stringify({
    id: pluginId,
    name: "Workspace Tools",
    version: "0.1.0",
    exoApiVersion: "0.1",
    capabilities: [
      {
        id: capabilityId,
        kind: "profile",
        label: "Workspace Tools",
        description: "Workspace profile capability.",
        lifecycle: "experimental",
        owner: pluginId,
        surfaces: ["desktop", "cli"],
        permissions: ["workspace:read"],
      },
    ],
    permissions: ["workspace:read"],
    surfaces: ["desktop", "cli"],
  }, null, 2), "utf8");
  return pluginsRoot;
}
