import path from "node:path";
import os from "node:os";
import { mkdtemp, rm } from "node:fs/promises";
import { describe, expect, it } from "vitest";

import { EXO_PLUGIN_MANIFEST_FILE, validatePluginManifest, type DiscoveredPlugin, type PluginManifest } from "../plugin";
import {
  emptyPluginPermissionStore,
  grantPluginPermissions,
  hasGrantedCapabilityPermission,
  hasGrantedPluginPermission,
  normalizePluginPermission,
  parsePluginPermission,
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
      id: "permissions.graph",
      kind: "exo.graph:visualization",
      label: "Permissions Graph",
      description: "Requests graph permissions.",
      lifecycle: "experimental",
      owner: "permissions.plugin",
      surfaces: ["cli"],
      permissions: ["workspace:read", "notes:propose:root:shoshin-codex", "artifacts:write"],
    },
    {
      id: "permissions.disabled",
      kind: "exo.graph:visualization",
      label: "Disabled Graph",
      description: "Disabled capability.",
      lifecycle: "disabled",
      owner: "permissions.plugin",
      surfaces: ["cli"],
      permissions: ["workspace:read"],
    },
  ],
  permissions: ["workspace:read", "projects:read:path:projects/exo"],
  surfaces: ["cli"],
};

describe("plugin permissions", () => {
  it("parses and normalizes scoped permission strings", () => {
    expect(normalizePluginPermission("notes:propose:root:shoshin-codex")).toBe("notes:propose:root:shoshin-codex");
    expect(parsePluginPermission("projects:read:path:projects/exo")).toMatchObject({
      permission: "projects:read:path:projects/exo",
      resource: "projects",
      action: "read",
      scope: { kind: "path", workspaceRelativePrefix: "projects/exo" },
      compatibilityStatus: "current",
    });
    expect(parsePluginPermission("agents:launch:harness:core.claude")).toMatchObject({
      permission: "agents:launch:harness:core.claude",
      resource: "agents",
      action: "launch",
      scope: { kind: "harness", harnessId: "core.claude" },
    });
    expect(() => normalizePluginPermission("notes:read:root:shoshin:extra")).toThrow("<resource>:<action>");
    expect(() => normalizePluginPermission("projects:read:path:../outside")).toThrow("workspace-relative prefix");
  });

  it("describes propose separately from direct write", () => {
    expect(parsePluginPermission("notes:propose:root:shoshin-codex")).toMatchObject({
      action: "propose",
      actionMetadata: {
        label: "Suggest changes",
        reviewCopy: "The plugin drafts edits; nothing is written until you review and accept.",
        risk: "reviewed-write",
      },
    });
    expect(parsePluginPermission("notes:write")).toMatchObject({
      action: "write",
      compatibilityStatus: "broad-write",
      breadthCopy: "Can edit any file in your vault, without review.",
      actionMetadata: {
        label: "Edit files directly",
        reviewCopy: "Changes are applied immediately, without review.",
        risk: "direct-write",
      },
    });
  });

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
      requestedPermissions: ["artifacts:write", "notes:propose:root:shoshin-codex", "projects:read:path:projects/exo", "workspace:read"],
      grantedPermissions: ["workspace:read"],
      missingPermissions: ["artifacts:write", "notes:propose:root:shoshin-codex", "projects:read:path:projects/exo"],
      status: "partial",
    });
    expect(resolveCapabilityPermissionGrants(plugin, "permissions.graph", store)).toMatchObject({
      capabilityId: "permissions.graph",
      requestedPermissions: ["artifacts:write", "notes:propose:root:shoshin-codex", "workspace:read"],
      grantedPermissions: ["workspace:read"],
      missingPermissions: ["artifacts:write", "notes:propose:root:shoshin-codex"],
      status: "partial",
    });
    expect(hasGrantedPluginPermission(plugin, store, "workspace:read")).toBe(true);
    expect(hasGrantedCapabilityPermission(plugin, "permissions.graph", store, "artifacts:write")).toBe(false);
  });

  it("records revocations and recomputes effective grants", () => {
    const plugin = discovered("hash-a", "trusted");
    const granted = grantPluginPermissions(
      emptyPluginPermissionStore(),
      plugin,
      ["workspace:read", "artifacts:write", "notes:propose:root:shoshin-codex"],
      "2026-06-27T00:00:00.000Z",
    );
    const revoked = revokePluginPermissions(granted, plugin, ["workspace:read"], "2026-06-27T01:00:00.000Z", "User revoked access");

    expect(resolvePluginPermissionGrants(plugin, revoked)).toMatchObject({
      grantedPermissions: ["artifacts:write", "notes:propose:root:shoshin-codex"],
      missingPermissions: ["projects:read:path:projects/exo", "workspace:read"],
      status: "partial",
    });
    expect(revoked.plugins[0]?.decisions).toEqual([
      { permission: "artifacts:write", action: "grant", decidedAt: "2026-06-27T00:00:00.000Z" },
      { permission: "notes:propose:root:shoshin-codex", action: "grant", decidedAt: "2026-06-27T00:00:00.000Z" },
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
      grantPluginPermissions(emptyPluginPermissionStore(), discovered("hash-a", "trusted"), ["notes:propose:root:other-root"]),
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

  it("does not grant permissions through unsupported capability kinds", () => {
    const plugin = discovered("hash-a", "trusted", true, validatePluginManifest({
      ...manifest,
      capabilities: [
        ...manifest.capabilities,
        {
          id: "permissions.future",
          kind: "exo.future:widget",
          label: "Future Widget",
          description: "Unsupported future capability.",
          lifecycle: "experimental",
          owner: "permissions.plugin",
          surfaces: ["cli"],
          permissions: ["network:access"],
        },
      ],
    }));

    const store = grantPluginPermissions(emptyPluginPermissionStore(), plugin, ["workspace:read"]);

    expect(resolveCapabilityPermissionGrants(plugin, "permissions.future", store)).toMatchObject({
      active: false,
      requestedPermissions: [],
      grantedPermissions: [],
      missingPermissions: [],
      status: "inactive",
    });
    expect(() => grantPluginPermissions(emptyPluginPermissionStore(), plugin, ["network:access"])).toThrow(
      "Cannot grant permissions not requested",
    );
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

function discovered(
  manifestHash: string,
  trust: DiscoveredPlugin["trust"],
  enabled = true,
  discoveredManifest: PluginManifest = manifest,
): DiscoveredPlugin {
  return {
    manifest: discoveredManifest,
    manifestPath: `/workspace/.exo/plugins/permissions/${EXO_PLUGIN_MANIFEST_FILE}`,
    rootDirectory: "/workspace/.exo/plugins/permissions",
    source: "workspace",
    trust,
    enabled,
    manifestHash,
  };
}
