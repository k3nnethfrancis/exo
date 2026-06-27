import { mkdir, mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";

import { EXO_PLUGIN_MANIFEST_FILE, type DiscoveredPlugin, type PluginManifest } from "../plugin";
import {
  emptyPluginSettingsStore,
  readPluginSettingsStore,
  resetPluginSettingsStore,
  resolvePluginSettings,
  updatePluginSettingsStore,
  writePluginSettingsStore,
} from "../plugin-settings";

const manifest: PluginManifest = {
  id: "settings.plugin",
  name: "Settings Plugin",
  version: "0.1.0",
  exoApiVersion: "0.1",
  capabilities: [
    {
      id: "settings.profile",
      kind: "profile",
      label: "Settings Profile",
      description: "Profile with settings.",
      lifecycle: "experimental",
      owner: "settings.plugin",
      surfaces: ["desktop"],
      permissions: ["workspace:read"],
    },
  ],
  permissions: ["workspace:read"],
  surfaces: ["desktop"],
  settingsSchema: {
    version: 1,
    fields: [
      { id: "enabled", type: "boolean", label: "Enabled", default: true },
      { id: "label", type: "string", label: "Label", default: "Default" },
      { id: "limit", type: "number", label: "Limit", default: 2 },
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
};

describe("plugin settings", () => {
  it("resolves defaults before user configuration", () => {
    expect(resolvePluginSettings(discovered("hash-a"), emptyPluginSettingsStore())).toMatchObject({
      hasSettings: true,
      fieldCount: 4,
      configuredCount: 0,
      values: {
        enabled: true,
        label: "Default",
        limit: 2,
        mode: "fast",
      },
      reviewRequired: false,
      validationErrors: [],
    });
  });

  it("applies user overrides and rejects invalid values", () => {
    const plugin = discovered("hash-a");
    const store = updatePluginSettingsStore(emptyPluginSettingsStore(), plugin, {
      enabled: false,
      label: "Custom",
      limit: 8,
      mode: "careful",
    }, "2026-06-27T00:00:00.000Z");

    expect(resolvePluginSettings(plugin, store)).toMatchObject({
      configuredCount: 4,
      values: {
        enabled: false,
        label: "Custom",
        limit: 8,
        mode: "careful",
      },
      record: expect.objectContaining({ manifestHash: "hash-a" }),
    });
    expect(() => updatePluginSettingsStore(store, plugin, { enabled: "false" })).toThrow("enabled must be a boolean");
    expect(() => updatePluginSettingsStore(store, plugin, { mode: "unknown" })).toThrow("mode must match one of its select options");
    expect(() => updatePluginSettingsStore(store, plugin, { missing: true })).toThrow("Unknown plugin setting field");
  });

  it("preserves configuration across manifest hash changes and marks review required", () => {
    const store = updatePluginSettingsStore(emptyPluginSettingsStore(), discovered("hash-a"), { label: "Custom" });

    expect(resolvePluginSettings(discovered("hash-b"), store)).toMatchObject({
      configuredCount: 1,
      values: { label: "Custom" },
      reviewRequired: true,
      configReviewRequired: true,
    });
  });

  it("resets values back to defaults", () => {
    const plugin = discovered("hash-a");
    const configured = updatePluginSettingsStore(emptyPluginSettingsStore(), plugin, { label: "Custom", enabled: false });
    const reset = resetPluginSettingsStore(configured, plugin, "2026-06-27T00:00:00.000Z");

    expect(resolvePluginSettings(plugin, reset)).toMatchObject({
      configuredCount: 0,
      values: {
        enabled: true,
        label: "Default",
      },
      record: expect.objectContaining({ values: {}, updatedAt: "2026-06-27T00:00:00.000Z" }),
    });
  });

  it("roundtrips through plugin-settings.json", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "exo-plugin-settings-"));
    try {
      await mkdir(path.join(root, ".exo"));
      const plugin = discovered("hash-a");
      const store = updatePluginSettingsStore(emptyPluginSettingsStore(), plugin, { label: "Disk" });

      await writePluginSettingsStore(path.join(root, ".exo"), store);

      await expect(readPluginSettingsStore(path.join(root, ".exo"))).resolves.toEqual(store);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});

function discovered(manifestHash: string): DiscoveredPlugin {
  return {
    manifest,
    manifestPath: `/plugins/settings/${EXO_PLUGIN_MANIFEST_FILE}`,
    rootDirectory: "/plugins/settings",
    source: "workspace",
    trust: "trusted",
    enabled: true,
    manifestHash,
  };
}
