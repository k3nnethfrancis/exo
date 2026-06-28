import { describe, expect, it } from "vitest";

import { buildPluginInventory, type PluginInventoryItem } from "../plugin-inventory";
import type { DiscoveredPlugin, PluginManifest } from "../plugin";
import { updatePluginSettingsStore, emptyPluginSettingsStore } from "../plugin-settings";
import { emptyPluginPermissionStore, grantPluginPermissions } from "../plugin-permissions";
import type { AgentHarnessDetection } from "../types";

const graphHealthManifest: PluginManifest = {
  id: "graph-health.plugin",
  name: "Graph Health",
  version: "0.1.0",
  exoApiVersion: "0.1",
  description: "Graph health checks.",
  capabilities: [
    {
      id: "graph-health.template",
      kind: "routineTemplate",
      label: "Graph Health",
      description: "Audit graph health.",
      lifecycle: "experimental",
      owner: "graph-health.plugin",
      surfaces: ["desktop", "cli"],
      permissions: ["workspace:read", "notes:read", "artifacts:write"],
    },
    {
      id: "shoshin.profile",
      kind: "profile",
      label: "Shoshin Profile",
      description: "Shoshin graph conventions.",
      lifecycle: "experimental",
      owner: "graph-health.plugin",
      surfaces: ["desktop", "cli"],
      permissions: ["workspace:read", "notes:read"],
      compatibility: {
        profile: {
          recommendedPlugins: [{ id: "graph-health.plugin", required: false }],
        },
      },
    },
    {
      id: "graph-health.view",
      kind: "graphVisualization",
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
    expect(find(inventory.items, "graph-health.template")).toMatchObject({
      source: "localManifest",
      distribution: "developer",
      categoryLabel: "Routine templates",
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
    expect(find(inventory.items, "shoshin.profile")).toMatchObject({
      source: "localManifest",
      categoryLabel: "Profiles",
    });
    expect(find(inventory.items, "graph-health.view")).toMatchObject({
      source: "localManifest",
      categoryLabel: "Graph visualizations",
    });
    expect(inventory.counts).toMatchObject({
      core: 5,
      bundled: 6,
      localManifest: 3,
      official: 6,
      developer: 3,
      local: 0,
      total: 14,
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

  it("enriches official harnesses with live readiness metadata", () => {
    const inventory = buildPluginInventory({
      harnesses: [
        {
          id: "pi",
          adapterId: "pi",
          family: "pi",
          label: "Pi",
          productName: "GA Pi",
          enabled: true,
          configured: false,
          detected: false,
          launchable: false,
          status: "missing-dependency",
          statusLabel: "Missing dependency",
          dependencies: [
            {
              id: "llama-cpp",
              kind: "inference-backend",
              label: "llama.cpp",
              required: true,
              configured: true,
              detected: false,
              satisfied: false,
              statusLabel: "Not running",
            },
          ],
        },
      ] satisfies AgentHarnessDetection[],
    });

    expect(find(inventory.items, "pi")).toMatchObject({
      status: "missing-dependency",
      statusLabel: "Missing dependency",
      enabled: true,
      dependencies: [
        {
          id: "llama-cpp",
          status: "missing",
          statusLabel: "Not running",
        },
      ],
    });
  });

  it("keeps untrusted and disabled manifests inspectable", () => {
    const inventory = buildPluginInventory({
      plugins: [
        discovered(graphHealthManifest, "untrusted"),
        discovered({
          ...graphHealthManifest,
          id: "disabled.plugin",
          capabilities: [{ ...graphHealthManifest.capabilities[0]!, id: "disabled.template", lifecycle: "disabled" }],
        }, "trusted", false),
      ],
    });

    expect(find(inventory.items, "graph-health.template")).toMatchObject({
      enabled: false,
      trust: "untrusted",
      statusLabel: "Review required",
    });
    expect(find(inventory.items, "disabled.template")).toMatchObject({
      enabled: false,
      trust: "trusted",
      statusLabel: "Disabled",
      permissionGrants: {
        requested: ["artifacts:write", "notes:read", "workspace:read"],
        granted: [],
        status: "inactive",
      },
    });
    expect(inventory.counts.untrusted).toBe(3);
    expect(inventory.counts.disabled).toBe(4);
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

    expect(find(inventory.items, "graph-health.template")).toMatchObject({
      trust: "trusted",
      enabled: false,
      statusLabel: "Disabled",
    });
    expect(find(inventory.items, "shoshin.profile")).toMatchObject({
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

    expect(find(inventory.items, "graph-health.template").settings).toEqual({
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

    expect(find(trustedInventory.items, "graph-health.template").permissionGrants).toEqual({
      requested: ["artifacts:write", "notes:read", "workspace:read"],
      granted: ["notes:read", "workspace:read"],
      missing: ["artifacts:write"],
      status: "partial",
    });
    expect(find(untrustedInventory.items, "graph-health.template").permissionGrants).toEqual({
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
