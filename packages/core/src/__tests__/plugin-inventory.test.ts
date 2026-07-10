import { describe, expect, it } from "vitest";

import { buildPluginInventory, type PluginInventoryItem } from "../plugin-inventory";
import type { DiscoveredPlugin, PluginManifest } from "../plugin";
import { updatePluginSettingsStore, emptyPluginSettingsStore } from "../plugin-settings";
import { emptyPluginPermissionStore, grantPluginPermissions } from "../plugin-permissions";

const graphHealthManifest: PluginManifest = {
  id: "graph-health.plugin",
  name: "Graph Health",
  version: "0.1.0",
  exoApiVersion: "0.1",
  description: "Graph health checks.",
  capabilities: [
    {
      id: "graph-health.search",
      kind: "core:searchProvider",
      label: "Graph Health",
      description: "Audit graph health.",
      lifecycle: "experimental",
      owner: "graph-health.plugin",
      surfaces: ["desktop", "cli"],
      permissions: ["workspace:read", "notes:read", "artifacts:write"],
    },
    {
      id: "graph-health.view",
      kind: "exo.graph:visualization",
      label: "Graph Health View",
      description: "Visualizes graph-health snapshots.",
      lifecycle: "experimental",
      owner: "graph-health.plugin",
      surfaces: ["desktop"],
      permissions: ["workspace:read", "notes:read"],
      compatibility: {
        graphDataVersion: "0.1",
        hostSurface: "editorPane",
      },
    },
  ],
  permissions: ["workspace:read", "notes:read", "artifacts:write"],
  surfaces: ["desktop", "cli"],
};

const futureKindManifest: PluginManifest = {
  ...graphHealthManifest,
  id: "future-kind.plugin",
  name: "Future Kind",
  capabilities: [
    {
      id: "future-kind.widget",
      kind: "exo.future:widget",
      label: "Future Widget",
      description: "Future Exo widget.",
      lifecycle: "experimental",
      owner: "future-kind.plugin",
      surfaces: ["desktop"],
      permissions: [],
      status: "unsupported-kind",
      statusNotes: ["Capability kind exo.future:widget is not supported by this Exo version."],
    },
    {
      ...graphHealthManifest.capabilities[0]!,
      id: "future-kind.search",
      owner: "future-kind.plugin",
    },
  ],
};

describe("plugin inventory", () => {
  it("includes core, official capability, and developer manifest rows", () => {
    const inventory = buildPluginInventory({
      now: "2026-06-25T00:00:00.000Z",
      plugins: [discovered(graphHealthManifest, "trusted")],
    });

    expect(inventory.generatedAt).toBe("2026-06-25T00:00:00.000Z");
    expect(find(inventory.items, "core.markdown-graph")).toMatchObject({
      source: "core",
      distribution: "core",
      categoryLabel: "Core",
      statusLabel: "Built in",
    });
    expect(find(inventory.items, "qmd")).toMatchObject({
      source: "bundled",
      sourceLabel: "Official plugin",
      distribution: "official",
      categoryLabel: "Search providers",
      trust: "trusted",
    });
    expect(find(inventory.items, "graph-health.search")).toMatchObject({
      source: "localManifest",
      distribution: "developer",
      categoryLabel: "Search providers",
      permissionGrants: {
        requested: ["artifacts:write", "notes:read", "workspace:read"],
        granted: [],
        missing: ["artifacts:write", "notes:read", "workspace:read"],
        status: "none",
      },
      pluginId: "graph-health.plugin",
      pluginName: "Graph Health",
      runtime: {
        executableLoading: "disabled",
        canLoadEntrypoints: false,
        canGrantPermissions: false,
        reason: expect.stringContaining("arbitrary plugin entrypoint execution is disabled"),
      },
    });
    expect(find(inventory.items, "graph-health.view")).toMatchObject({
      source: "localManifest",
      categoryLabel: "Graph visualizations",
    });
    expect(inventory.counts).toMatchObject({
      core: 4,
      bundled: 1,
      localManifest: 2,
      official: 1,
      developer: 2,
      local: 0,
      total: 7,
    });
  });

  it("attaches provider-neutral readiness metadata to official search providers", () => {
    const inventory = buildPluginInventory({
      readinessByCapabilityId: {
        qmd: {
          state: "indexing",
          label: "Embeddings needed",
          detail: "12 documents still need embeddings.",
          metrics: [
            { label: "Mode", value: "hybrid" },
            { label: "Documents", value: 42 },
          ],
        },
      },
    });

    expect(find(inventory.items, "qmd")).toMatchObject({
      readiness: {
        state: "indexing",
        label: "Embeddings needed",
        detail: "12 documents still need embeddings.",
        metrics: [
          { label: "Mode", value: "hybrid" },
          { label: "Documents", value: 42 },
        ],
      },
    });
  });

  it("keeps untrusted and disabled manifests inspectable", () => {
    const inventory = buildPluginInventory({
      plugins: [
        discovered(graphHealthManifest, "untrusted"),
        discovered({
          ...graphHealthManifest,
          id: "disabled.plugin",
          capabilities: [{ ...graphHealthManifest.capabilities[0]!, id: "disabled.search", lifecycle: "disabled" }],
        }, "trusted", false),
      ],
    });

    expect(find(inventory.items, "graph-health.search")).toMatchObject({
      enabled: false,
      trust: "untrusted",
      statusLabel: "Review required",
    });
    expect(find(inventory.items, "disabled.search")).toMatchObject({
      enabled: false,
      trust: "trusted",
      statusLabel: "Disabled",
      permissionGrants: {
        requested: ["artifacts:write", "notes:read", "workspace:read"],
        granted: [],
        status: "inactive",
      },
    });
    expect(inventory.counts.untrusted).toBe(2);
    expect(inventory.counts.disabled).toBe(3);
  });

  it("surfaces unsupported capability kinds without activating them", () => {
    const inventory = buildPluginInventory({
      plugins: [discovered(futureKindManifest, "trusted")],
    });

    expect(find(inventory.items, "future-kind.widget")).toMatchObject({
      categoryLabel: "Unsupported capability kind",
      enabled: false,
      status: "unsupported-kind",
      statusLabel: "Not supported by this Exo version",
      permissionGrants: {
        requested: [],
        granted: [],
        missing: [],
        status: "inactive",
      },
      runtime: {
        statusNotes: ["Capability kind exo.future:widget is not supported by this Exo version."],
      },
    });
    expect(find(inventory.items, "future-kind.search")).toMatchObject({
      enabled: true,
      status: "available",
      statusLabel: "Available",
    });
  });

  it("applies persisted local plugin state to manifest rows", () => {
    const plugin = discovered(graphHealthManifest, "untrusted");
    const inventory = buildPluginInventory({
      plugins: [plugin],
      pluginStateStore: {
        version: 1,
        plugins: [
          {
            pluginId: plugin.manifest.id,
            source: plugin.source,
            rootDirectory: plugin.rootDirectory,
            manifestPath: plugin.manifestPath,
            manifestHash: plugin.manifestHash,
            trust: "trusted",
            enabled: false,
            reviewedAt: "2026-06-27T00:00:00.000Z",
          },
        ],
      },
    });

    expect(find(inventory.items, "graph-health.search")).toMatchObject({
      trust: "trusted",
      enabled: false,
      statusLabel: "Disabled",
    });
    expect(inventory.counts.untrusted).toBe(0);
  });

  it("includes plugin settings summaries on local manifest rows", () => {
    const plugin = discovered({
      ...graphHealthManifest,
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
    }, "trusted");
    const pluginSettingsStore = updatePluginSettingsStore(emptyPluginSettingsStore(), plugin, { mode: "careful" });

    const inventory = buildPluginInventory({
      plugins: [{ ...plugin, manifestHash: "hash-changed" }],
      pluginSettingsStore,
    });

    expect(find(inventory.items, "graph-health.search").settings).toEqual({
      hasSettings: true,
      fieldCount: 2,
      configuredCount: 1,
      reviewRequired: true,
      configReviewRequired: true,
      validationErrors: [],
    });
  });

  it("includes granted permission summaries without activating untrusted rows", () => {
    const plugin = discovered(graphHealthManifest, "trusted");
    const pluginPermissionStore = grantPluginPermissions(
      emptyPluginPermissionStore(),
      plugin,
      ["workspace:read", "notes:read"],
      "2026-06-27T00:00:00.000Z",
    );

    const trustedInventory = buildPluginInventory({
      plugins: [plugin],
      pluginPermissionStore,
    });
    const untrustedInventory = buildPluginInventory({
      plugins: [{ ...plugin, trust: "untrusted" }],
      pluginPermissionStore,
    });

    expect(find(trustedInventory.items, "graph-health.search").permissionGrants).toEqual({
      requested: ["artifacts:write", "notes:read", "workspace:read"],
      granted: ["notes:read", "workspace:read"],
      missing: ["artifacts:write"],
      status: "partial",
    });
    expect(find(untrustedInventory.items, "graph-health.search").permissionGrants).toEqual({
      requested: ["artifacts:write", "notes:read", "workspace:read"],
      granted: [],
      missing: ["artifacts:write", "notes:read", "workspace:read"],
      status: "inactive",
    });
  });
});

function discovered(manifest: PluginManifest, trust: DiscoveredPlugin["trust"], enabled = true): DiscoveredPlugin {
  return {
    manifest,
    manifestPath: `/plugins/${manifest.id}/exo.plugin.json`,
    rootDirectory: `/plugins/${manifest.id}`,
    source: "dev",
    trust,
    enabled,
    manifestHash: `hash-${manifest.id}`,
  };
}

function find(items: PluginInventoryItem[], id: string): PluginInventoryItem {
  const item = items.find((candidate) => candidate.id === id);
  expect(item).toBeTruthy();
  return item!;
}
