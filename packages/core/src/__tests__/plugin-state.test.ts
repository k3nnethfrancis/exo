import path from "node:path";
import os from "node:os";
import { mkdtemp, rm } from "node:fs/promises";
import { describe, expect, it } from "vitest";

import { EXO_PLUGIN_MANIFEST_FILE, type DiscoveredPlugin, type PluginManifest } from "../plugin";
import {
  applyPluginState,
  emptyPluginStateStore,
  hashPluginManifest,
  pluginStateIdentity,
  pluginStateKey,
  readPluginStateStore,
  resolvePluginState,
  upsertPluginStateRecord,
  writePluginStateStore,
} from "../plugin-state";

const manifest: PluginManifest = {
  id: "workspace.plugin",
  name: "Workspace Plugin",
  version: "0.1.0",
  exoApiVersion: "0.1",
  capabilities: [
    {
      id: "workspace.template",
      kind: "routineTemplate",
      label: "Workspace Template",
      description: "Workspace-owned routine template.",
      lifecycle: "experimental",
      owner: "workspace.plugin",
      surfaces: ["cli"],
      permissions: ["workspace:read"],
    },
  ],
  permissions: ["workspace:read"],
  surfaces: ["cli"],
};

describe("plugin state", () => {
  it("keys local policy by plugin id, source, root path, manifest path, and manifest hash", () => {
    const plugin = discovered("hash-a");
    const identity = pluginStateIdentity(plugin);

    expect(pluginStateKey(identity)).not.toBe(pluginStateKey({ ...identity, manifestHash: "hash-b" }));
    expect(pluginStateKey(identity)).not.toBe(pluginStateKey({ ...identity, manifestPath: "/other/exo.plugin.json" }));
    expect(pluginStateKey(identity)).not.toBe(pluginStateKey({ ...identity, rootDirectory: "/other" }));
    expect(pluginStateKey(identity)).not.toBe(pluginStateKey({ ...identity, source: "user" }));
    expect(pluginStateKey(identity)).not.toBe(pluginStateKey({ ...identity, pluginId: "other.plugin" }));
  });

  it("does not let a workspace manifest self-trust without matching local machine policy", () => {
    const plugin = discovered("hash-a");
    const state = resolvePluginState(plugin, emptyPluginStateStore());

    expect(state).toMatchObject({
      trust: "untrusted",
      enabled: true,
      reviewRequired: true,
      status: "review-required",
    });
  });

  it("applies matching local policy but resets changed manifests to review-required", () => {
    const plugin = discovered("hash-a");
    const trustedStore = {
      version: 1 as const,
      plugins: [
        {
          ...pluginStateIdentity(plugin),
          trust: "trusted" as const,
          enabled: true,
          reviewedAt: "2026-06-26T00:00:00.000Z",
        },
      ],
    };

    expect(applyPluginState(plugin, trustedStore)).toMatchObject({ trust: "trusted", enabled: true });
    expect(resolvePluginState(discovered("hash-b"), trustedStore)).toMatchObject({
      trust: "untrusted",
      enabled: true,
      reviewRequired: true,
      status: "review-required",
    });
  });

  it("round-trips local policy store on disk", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "exo-plugin-state-"));
    try {
      const plugin = discovered(hashPluginManifest(JSON.stringify(manifest)));
      const store = {
        version: 1 as const,
        plugins: [{ ...pluginStateIdentity(plugin), trust: "trusted" as const, enabled: false }],
      };

      await writePluginStateStore(root, store);

      await expect(readPluginStateStore(root)).resolves.toEqual(store);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("upserts local policy by exact manifest identity", () => {
    const plugin = discovered("hash-a");
    const store = upsertPluginStateRecord(emptyPluginStateStore(), plugin, {
      trust: "trusted",
      enabled: true,
      reviewedAt: "2026-06-27T00:00:00.000Z",
    });

    expect(resolvePluginState(plugin, store)).toMatchObject({
      trust: "trusted",
      enabled: true,
      reviewRequired: false,
      status: "available",
    });
    expect(resolvePluginState(discovered("hash-b"), store)).toMatchObject({
      trust: "untrusted",
      enabled: true,
      reviewRequired: true,
      status: "review-required",
    });

    const disabledStore = upsertPluginStateRecord(store, plugin, { enabled: false });
    expect(resolvePluginState(plugin, disabledStore).record).toMatchObject({
      reviewedAt: "2026-06-27T00:00:00.000Z",
      enabled: false,
    });
  });
});

function discovered(manifestHash: string): DiscoveredPlugin {
  return {
    manifest,
    manifestPath: `/workspace/.exo/plugins/workspace/${EXO_PLUGIN_MANIFEST_FILE}`,
    rootDirectory: "/workspace/.exo/plugins/workspace",
    source: "workspace",
    trust: "untrusted",
    enabled: true,
    manifestHash,
  };
}
