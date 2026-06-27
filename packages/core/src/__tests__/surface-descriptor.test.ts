import { describe, expect, it } from "vitest";

import type { AgentHarnessDetection, ManagedAgentKind, PluginInventoryItem } from "../index";
import {
  buildCoreToolSurfaceDescriptors,
  launchableToolSurfaceHarnesses,
  toolSurfaceDescriptorsFromInventory,
} from "../surface-descriptor";

function harness(id: ManagedAgentKind, launchable: boolean, overrides: Partial<AgentHarnessDetection> = {}): AgentHarnessDetection {
  return {
    id,
    adapterId: id === "claude" ? "claude-code" : id,
    family: id === "claude" ? "claude-code" : id,
    label: id,
    productName: id,
    enabled: true,
    configured: launchable,
    detected: launchable,
    launchable,
    status: launchable ? "configured" : "not-found",
    statusLabel: launchable ? "Configured" : "Not found",
    ...overrides,
  };
}

describe("tool surface descriptors", () => {
  it("describes current right-rail actions without exposing dead harness launchers", () => {
    const descriptors = buildCoreToolSurfaceDescriptors({
      terminalCollapsed: false,
      harnesses: [
        harness("shell", true),
        harness("claude", true),
        harness("codex", false),
        harness("pi", true),
        harness("hermes", true, { visible: false }),
      ],
    });

    expect(descriptors.map((descriptor) => descriptor.testId)).toEqual([
      "terminal-collapse",
      "launch-shell",
      "launch-claude",
      "launch-pi",
      "open-agent-config",
      "open-plugin-manager",
      "swap-side-panes",
    ]);
    expect(descriptors.find((descriptor) => descriptor.id === "launch-claude")).toMatchObject({
      owner: "officialPlugin",
      capabilityId: "claude",
      action: { type: "terminal.launch", terminalKind: "claude" },
    });
  });

  it("uses the same launchability filter as the terminal dock", () => {
    expect(
      launchableToolSurfaceHarnesses([
        harness("shell", true),
        harness("codex", false),
        harness("pi", true),
        harness("hermes", true, { visible: false }),
      ]).map((candidate) => candidate.id),
    ).toEqual(["pi"]);
  });

  it("turns trusted desktop routine and graph capabilities into future tool descriptors", () => {
    const descriptors = toolSurfaceDescriptorsFromInventory([
      inventoryItem("graph-health.template", "routineTemplate", "official"),
      inventoryItem("default-graph.view", "graphVisualization", "local"),
      inventoryItem("blocked.template", "routineTemplate", "local", { trust: "untrusted" }),
      inventoryItem("cli-only.view", "graphVisualization", "local", { surfaces: ["cli"] }),
    ]);

    expect(descriptors).toMatchObject([
      {
        id: "graph-health.template",
        owner: "officialPlugin",
        action: { type: "routineTemplate.open", routineTemplateId: "graph-health.template" },
      },
      {
        id: "default-graph.view",
        owner: "localPlugin",
        action: { type: "graphVisualization.open", graphVisualizationId: "default-graph.view" },
      },
    ]);
  });
});

function inventoryItem(
  id: string,
  kind: PluginInventoryItem["kind"],
  distribution: PluginInventoryItem["distribution"],
  overrides: Partial<PluginInventoryItem> = {},
): PluginInventoryItem {
  return {
    id,
    label: id,
    description: `${id} description`,
    kind,
    categoryId: String(kind),
    categoryLabel: String(kind),
    source: distribution === "official" ? "bundled" : "localManifest",
    sourceLabel: distribution,
    distribution,
    distributionLabel: distribution,
    lifecycle: "built-in",
    owner: "test",
    surfaces: ["desktop"],
    permissions: [],
    enabled: true,
    trust: "trusted",
    status: "available",
    statusLabel: "Available",
    pluginId: distribution === "official" ? undefined : `${id}.plugin`,
    ...overrides,
  };
}
