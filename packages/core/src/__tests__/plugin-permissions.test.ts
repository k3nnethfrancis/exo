import path from "node:path";
import os from "node:os";
import { mkdtemp, rm } from "node:fs/promises";
import { describe, expect, it } from "vitest";

import { EXO_PLUGIN_MANIFEST_FILE, type DiscoveredPlugin, type PluginManifest } from "../plugin";
import {
  emptyPluginPermissionStore,
  grantPluginPermissions,
  hasGrantedCapabilityPermission,
  hasGrantedPluginPermission,
  pluginPermissionIdentity,
  pluginPermissionKey,
  readPluginPermissionStore,
  resolveCapabilityPermissionGrants,
  resolvePluginPermissionGrants,
  revokePluginPermissions,
  validatePluginPermissionStore,
  writePluginPermissionStore,
} from "../plugin-permissions";

const manifest: PluginManifest = {
  id: "permissions.plugin",
  name: "Permissions Plugin",
  version: "0.1.0",
  exoApiVersion: "0.1",
  capabilities: [
    {
      id: "permissions.template",
      kind: "core:routineTemplate",
      label: "Permissions Template",
      description: "Requests routine permissions.",
      lifecycle: "experimental",
      owner: "permissions.plugin",
      surfaces: ["cli"],
      permissions: ["workspace:read", "artifacts:write"],
    },
    {
      id: "permissions.disabled",
      kind: "core:routineTemplate",
      label: "Disabled Template",
      description: "Disabled capability.",
      lifecycle: "disabled",
      owner: "permissions.plugin",
      surfaces: ["cli"],
      permissions: ["workspace:read"],
    },
  ],
  permissions: ["workspace:read"],
  surfaces: ["cli"],
};

describe("plugin permissions", () => {
  it("keys grants by plugin id, source, root path, manifest path, and manifest hash", () => {
    const plugin = discovered("hash-a", "trusted");
    const identity = pluginPermissionIdentity(plugin);

    expect(pluginPermissionKey(identity)).not.toBe(pluginPermissionKey({ ...identity, manifestHash: "hash-b" }));
    expect(pluginPermissionKey(identity)).not.toBe(pluginPermissionKey({ ...identity, manifestPath: "/other/exo.plugin.json" }));
    expect(pluginPermissionKey(identity)).not.toBe(pluginPermissionKey({ ...identity, rootDirectory: "/other" }));
    expect(pluginPermissionKey(identity)).not.toBe(pluginPermissionKey({ ...identity, source: "user" }));
    expect(pluginPermissionKey(identity)).not.toBe(pluginPermissionKey({ ...identity, pluginId: "other.plugin" }));
  });

  it("distinguishes requested permissions from granted permissions", () => {
    const plugin = discovered("hash-a", "trusted");
    const store = grantPluginPermissions(
      emptyPluginPermissionStore(),
      plugin,
      ["workspace:read"],
      "2026-06-27T00:00:00.000Z",
    );

    expect(resolvePluginPermissionGrants(plugin, store)).toMatchObject({
      active: true,
      requestedPermissions: ["artifacts:write", "workspace:read"],
      grantedPermissions: ["workspace:read"],
      missingPermissions: ["artifacts:write"],
      status: "partial",
    });
    expect(resolveCapabilityPermissionGrants(plugin, "permissions.template", store)).toMatchObject({
      capabilityId: "permissions.template",
      requestedPermissions: ["artifacts:write", "workspace:read"],
      grantedPermissions: ["workspace:read"],
      missingPermissions: ["artifacts:write"],
      status: "partial",
    });
    expect(hasGrantedPluginPermission(plugin, store, "workspace:read")).toBe(true);
    expect(hasGrantedCapabilityPermission(plugin, "permissions.template", store, "artifacts:write")).toBe(false);
  });

  it("records revocations and recomputes effective grants", () => {
    const plugin = discovered("hash-a", "trusted");
    const granted = grantPluginPermissions(
      emptyPluginPermissionStore(),
      plugin,
      ["workspace:read", "artifacts:write"],
      "2026-06-27T00:00:00.000Z",
    );
    const revoked = revokePluginPermissions(granted, plugin, ["workspace:read"], "2026-06-27T01:00:00.000Z", "User revoked access");

    expect(resolvePluginPermissionGrants(plugin, revoked)).toMatchObject({
      grantedPermissions: ["artifacts:write"],
      missingPermissions: ["workspace:read"],
      status: "partial",
    });
    expect(revoked.plugins[0]?.decisions).toEqual([
      { permission: "artifacts:write", action: "grant", decidedAt: "2026-06-27T00:00:00.000Z" },
      { permission: "workspace:read", action: "grant", decidedAt: "2026-06-27T00:00:00.000Z" },
      { permission: "workspace:read", action: "revoke", decidedAt: "2026-06-27T01:00:00.000Z", reason: "User revoked access" },
    ]);
  });

  it("does not consider untrusted, disabled, stale, or disabled-capability grants active", () => {
    const trusted = discovered("hash-a", "trusted");
    const store = grantPluginPermissions(emptyPluginPermissionStore(), trusted, ["workspace:read", "artifacts:write"]);

    expect(resolvePluginPermissionGrants(discovered("hash-a", "untrusted"), store)).toMatchObject({
      active: false,
      grantedPermissions: [],
      status: "inactive",
    });
    expect(resolvePluginPermissionGrants(discovered("hash-a", "trusted", false), store)).toMatchObject({
      active: false,
      grantedPermissions: [],
      status: "inactive",
    });
    expect(resolvePluginPermissionGrants(discovered("hash-b", "trusted"), store)).toMatchObject({
      active: true,
      grantedPermissions: [],
      status: "none",
      record: undefined,
    });
    expect(resolveCapabilityPermissionGrants(trusted, "permissions.disabled", store)).toMatchObject({
      active: false,
      grantedPermissions: [],
      status: "inactive",
    });
  });

  it("rejects grants that were not requested by the manifest or inactive plugins", () => {
    expect(() =>
      grantPluginPermissions(emptyPluginPermissionStore(), discovered("hash-a", "trusted"), ["network:access"]),
    ).toThrow("Cannot grant permissions not requested");
    expect(() =>
      grantPluginPermissions(emptyPluginPermissionStore(), discovered("hash-a", "untrusted"), ["workspace:read"]),
    ).toThrow("Cannot grant permissions to inactive plugin");
    expect(() =>
      validatePluginPermissionStore({
        version: 1,
        plugins: [
          {
            ...pluginPermissionIdentity(discovered("hash-a", "trusted")),
            decisions: [{ permission: "filesystem:all", action: "grant", decidedAt: "now" }],
          },
        ],
      }),
    ).toThrow("unsupported value");
  });

  it("round-trips plugin-permissions.json", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "exo-plugin-permissions-"));
    try {
      const plugin = discovered("hash-a", "trusted");
      const store = grantPluginPermissions(emptyPluginPermissionStore(), plugin, ["workspace:read"]);

      await writePluginPermissionStore(root, store);

      await expect(readPluginPermissionStore(root)).resolves.toEqual(store);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});

function discovered(manifestHash: string, trust: DiscoveredPlugin["trust"], enabled = true): DiscoveredPlugin {
  return {
    manifest,
    manifestPath: `/workspace/.exo/plugins/permissions/${EXO_PLUGIN_MANIFEST_FILE}`,
    rootDirectory: "/workspace/.exo/plugins/permissions",
    source: "workspace",
    trust,
    enabled,
    manifestHash,
  };
}
