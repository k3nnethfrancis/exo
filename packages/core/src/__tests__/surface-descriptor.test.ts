import { describe, expect, it } from "vitest";

import type { PluginInventoryItem } from "../index";
import {
  buildCoreWebViewerDescriptor,
  buildCoreToolSurfaceDescriptors,
  buildSafePluginPanelDescriptor,
  coreWebViewerToolMetadata,
  toolSurfaceDescriptorsFromInventory,
} from "../surface-descriptor";

describe("tool surface descriptors", () => {
  it("describes core right-rail actions without harness launchers", () => {
    const descriptors = buildCoreToolSurfaceDescriptors({
      terminalCollapsed: false,
    });

    expect(descriptors.map((descriptor) => descriptor.testId)).toEqual([
      "terminal-collapse",
      "launch-shell",
      "swap-side-panes",
    ]);
    expect(descriptors.find((descriptor) => descriptor.id === "launch-shell")).toMatchObject({
      owner: "core",
      capabilityId: "shell",
      action: { type: "terminal.launch", terminalKind: "shell" },
    });
  });

  it("does not expose plugin capability tool descriptors before host contracts exist", () => {
    const descriptors = toolSurfaceDescriptorsFromInventory([
      inventoryItem("search.plugin", "core:searchProvider", "official"),
      inventoryItem("blocked.graph", "exo.graph:visualization", "local", { trust: "untrusted" }),
    ]);

    expect(descriptors).toEqual([]);
  });

  it("describes plugin-produced local apps through core web viewer requests", () => {
    const descriptor = buildCoreWebViewerDescriptor({
      id: "eval-dashboard.open",
      label: "Eval dashboard",
      title: "Open generated eval dashboard",
      owner: "localPlugin",
      capabilityId: "eval-dashboard.app",
      pluginId: "eval-dashboard.plugin",
      request: {
        target: ".exo/artifacts/run-1/dashboard.html",
        targetKind: "artifact",
        sourcePluginId: "eval-dashboard.plugin",
        sourceCapabilityId: "eval-dashboard.app",
      },
    });

    expect(descriptor).toMatchObject({
      kind: "toolDockPane",
      owner: "localPlugin",
      action: {
        type: "webViewer.open",
        request: {
          target: ".exo/artifacts/run-1/dashboard.html",
          targetKind: "artifact",
        },
      },
      webViewer: coreWebViewerToolMetadata(),
    });
  });

  it("keeps native plugin panel descriptors metadata-only and policy gated", () => {
    expect(
      buildSafePluginPanelDescriptor({
        id: "blocked.panel",
        label: "Blocked",
        title: "Blocked panel",
        panelId: "blocked.panel",
        owner: "localPlugin",
        enabled: true,
        trusted: false,
        desktopSurface: true,
      }),
    ).toBeUndefined();

    expect(
      buildSafePluginPanelDescriptor({
        id: "safe.panel",
        label: "Safe",
        title: "Safe panel",
        panelId: "safe.panel",
        owner: "officialPlugin",
        capabilityId: "safe.panel",
        pluginId: "safe.plugin",
        enabled: true,
        trusted: true,
        desktopSurface: true,
      }),
    ).toMatchObject({
      kind: "pluginPanel",
      action: { type: "pluginPanel.open", panelId: "safe.panel" },
      pluginPanel: {
        contractVersion: "0.1",
        hostKind: "coreRendererPanel",
        rendererEntrypointLoading: "disabled",
      },
    });
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
