import { describe, expect, it } from "vitest";

import { buildPluginInventory, type PluginInventoryItem } from "../plugin-inventory";
import type { DiscoveredPlugin, PluginManifest } from "../plugin";
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
      pluginId: "graph-health.plugin",
      pluginName: "Graph Health",
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
    });
    expect(inventory.counts.untrusted).toBe(3);
    expect(inventory.counts.disabled).toBe(4);
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
