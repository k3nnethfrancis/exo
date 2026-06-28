import { describe, expect, it } from "vitest";

import type { AgentHarnessDetection, ManagedAgentKind, PluginInventoryItem } from "../index";
import {
  buildCoreWebViewerDescriptor,
  buildCoreToolSurfaceDescriptors,
  buildSafePluginPanelDescriptor,
  coreWebViewerToolMetadata,
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
        graphVisualization: {
          data: {
            snapshotVersion: "0.1",
            acceptedNodeKinds: ["note", "tag", "external", "unresolved"],
            acceptedEdgeKinds: ["wikilink", "markdownLink", "hasTag"],
          },
          surface: {
            hostSurface: "editorPane",
            renderMode: "3d",
            preferredPlacement: "editorGrid",
          },
        },
      },
    ]);
  });

  it("attaches core web viewer endpoint metadata to web-preview graph descriptors", () => {
    const descriptors = toolSurfaceDescriptorsFromInventory([
      inventoryItem("web-graph.view", "graphVisualization", "local", {
        compatibility: {
          graphVisualization: {
            graphDataVersion: "0.1",
            hostSurface: "webPreview",
            renderMode: "3d",
          },
        },
      }),
    ]);

    expect(descriptors[0]).toMatchObject({
      id: "web-graph.view",
      graphVisualization: {
        surface: {
          hostSurface: "webPreview",
          preferredPlacement: "webPreview",
        },
      },
      webViewer: {
        contractVersion: "0.1",
        targetPolicy: {
          allowedTargetKinds: ["localFile", "localhostUrl", "artifact", "trustedUrl"],
          validationOwner: "core",
        },
        endpoints: {
          open: "/preview/open",
          focus: "/preview/focus",
          close: "/preview/close",
        },
      },
    });
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
    compatibility:
      kind === "graphVisualization"
        ? {
            graphVisualization: {
              graphDataVersion: "0.1",
              hostSurface: "editorPane",
              renderMode: "3d",
            },
          }
        : undefined,
    enabled: true,
    trust: "trusted",
    status: "available",
    statusLabel: "Available",
    pluginId: distribution === "official" ? undefined : `${id}.plugin`,
    ...overrides,
  };
}
