import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";

import { applyPluginStateAction, readManagedPluginSettings, updateManagedPluginSettings } from "../plugin-management";
import { readPluginSettingsStore } from "../plugin-settings";
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

  it("updates settings for a trusted enabled local plugin", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "exo-plugin-management-"));
    try {
      const pluginsRoot = await writePlugin(root, "workspace-tools.plugin", "workspace-tools.profile", true);

      const result = await updateManagedPluginSettings({
        workspaceRoot: root,
        runtimeRoot: path.join(root, ".exo"),
        pluginId: "workspace-tools.plugin",
        env: { EXO_PLUGIN_DIRS: pluginsRoot },
        values: { mode: "careful", enabled: false },
        now: () => "2026-06-27T00:00:00.000Z",
      });

      expect(result).toMatchObject({
        pluginId: "workspace-tools.plugin",
        settings: {
          configuredCount: 2,
          values: { mode: "careful", enabled: false },
          reviewRequired: false,
        },
      });
      await expect(readPluginSettingsStore(path.join(root, ".exo"))).resolves.toMatchObject({
        plugins: [expect.objectContaining({
          pluginId: "workspace-tools.plugin",
          values: { mode: "careful", enabled: false },
          updatedAt: "2026-06-27T00:00:00.000Z",
        })],
      });
      await expect(readManagedPluginSettings({
        workspaceRoot: root,
        runtimeRoot: path.join(root, ".exo"),
        pluginId: "workspace-tools.plugin",
        env: { EXO_PLUGIN_DIRS: pluginsRoot },
      })).resolves.toMatchObject({
        pluginId: "workspace-tools.plugin",
        settings: {
          values: { mode: "careful", enabled: false },
        },
      });
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("rejects settings updates for untrusted, disabled, or schema-less plugins", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "exo-plugin-management-"));
    try {
      const trustedRoot = await writePlugin(path.join(root, "trusted"), "trusted.plugin", "trusted.profile", true);
      const noSchemaRoot = await writePlugin(path.join(root, "no-schema"), "no-schema.plugin", "no-schema.profile", false);
      await writePlugin(root, "untrusted.plugin", "untrusted.profile", true);

      await expect(updateManagedPluginSettings({
        workspaceRoot: root,
        runtimeRoot: path.join(root, ".exo"),
        pluginId: "untrusted.plugin",
        env: { EXO_USER_DATA_PATH: root },
        values: { mode: "careful" },
      })).rejects.toThrow("trusted and enabled");

      await applyPluginStateAction({
        workspaceRoot: root,
        runtimeRoot: path.join(root, ".exo"),
        pluginId: "trusted.plugin",
        action: "disable",
        env: { EXO_PLUGIN_DIRS: trustedRoot },
      });
      await expect(updateManagedPluginSettings({
        workspaceRoot: root,
        runtimeRoot: path.join(root, ".exo"),
        pluginId: "trusted.plugin",
        env: { EXO_PLUGIN_DIRS: trustedRoot },
        values: { mode: "careful" },
      })).rejects.toThrow("trusted and enabled");

      await expect(updateManagedPluginSettings({
        workspaceRoot: root,
        runtimeRoot: path.join(root, ".exo"),
        pluginId: "no-schema.plugin",
        env: { EXO_PLUGIN_DIRS: noSchemaRoot },
        values: { mode: "careful" },
      })).rejects.toThrow("does not declare settings");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});

async function writePlugin(root: string, pluginId: string, capabilityId: string, withSettings = false): Promise<string> {
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
        kind: "core:profile",
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
    ...(withSettings ? {
      settingsSchema: {
        version: 1,
        fields: [
          { id: "enabled", type: "boolean", label: "Enabled", default: true },
          {
            id: "mode",
            type: "select",
            label: "Mode",
            options: [
              { value: "fast", label: "Fast" },
              { value: "careful", label: "Careful" },
            ],
            default: "fast",
          },
        ],
      },
    } : {}),
  }, null, 2), "utf8");
  return pluginsRoot;
}
