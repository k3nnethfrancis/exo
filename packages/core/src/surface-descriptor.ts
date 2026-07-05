import {
  terminalSubstrateKindForManagedAgentKind,
  type AgentHarnessDetection,
  type AgentHarnessId,
  type TerminalSubstrateKind,
} from "./types";
import { EXO_COMMAND_ROUTES } from "./command-protocol";
import {
  graphVisualizationFromCapability,
  type GraphVisualizationDataContract,
  type GraphVisualizationSurfaceContribution,
} from "./graph";
import { isCapabilityAvailableOnSurface } from "./surface-policy";
import type { CapabilityMetadata } from "./capabilities";
import type { PluginInventoryItem } from "./plugin-inventory";

export type ToolSurfaceOwnerKind = "core" | "officialPlugin" | "localPlugin" | "developerPlugin";
export type ToolSurfacePlacement = "rightRail" | "toolDock" | "commandPalette";
export type ToolSurfaceDescriptorKind = "railAction" | "toolDockPane" | "pluginPanel";
export type CoreWebViewerTargetKind = "localFile" | "localhostUrl" | "artifact" | "trustedUrl";
export type PluginPanelHostPlacement = "toolDock" | "editorGrid" | "modal";

export type ToolSurfaceAction =
  | { type: "terminal.toggleDock" }
  | { type: "terminal.launch"; terminalKind: TerminalSubstrateKind; harnessId: AgentHarnessId }
  | { type: "agentConfig.open" }
  | { type: "pluginManager.open" }
  | { type: "sidePanes.toggle" }
  | { type: "routineTemplate.open"; routineTemplateId: string }
  | { type: "graphVisualization.open"; graphVisualizationId: string }
  | { type: "pluginPanel.open"; panelId: string }
  | { type: "webViewer.open"; request: CoreWebViewerOpenRequest };

export interface ToolSurfaceDescriptor {
  id: string;
  label: string;
  title: string;
  kind: ToolSurfaceDescriptorKind;
  placement: ToolSurfacePlacement;
  owner: ToolSurfaceOwnerKind;
  action: ToolSurfaceAction;
  testId?: string;
  capabilityId?: string;
  pluginId?: string;
  enabled: boolean;
  visible: boolean;
  graphVisualization?: GraphVisualizationToolMetadata;
  pluginPanel?: PluginPanelToolMetadata;
  webViewer?: CoreWebViewerToolMetadata;
}

export interface GraphVisualizationToolMetadata {
  data: GraphVisualizationDataContract;
  surface: GraphVisualizationSurfaceContribution;
}

export interface PluginPanelToolMetadata {
  contractVersion: "0.1";
  panelId: string;
  hostPlacement: PluginPanelHostPlacement;
  hostKind: "coreRendererPanel";
  rendererEntrypointLoading: "disabled";
}

export interface CoreWebViewerOpenRequest {
  target: string;
  targetKind: CoreWebViewerTargetKind;
  sourcePluginId?: string;
  sourceCapabilityId?: string;
}

export interface CoreWebViewerToolMetadata {
  contractVersion: "0.1";
  targetPolicy: {
    allowedTargetKinds: CoreWebViewerTargetKind[];
    validationOwner: "core";
  };
  endpoints: {
    open: typeof EXO_COMMAND_ROUTES.openPreview;
    focus: typeof EXO_COMMAND_ROUTES.focusPreview;
    close: typeof EXO_COMMAND_ROUTES.closePreview;
  };
}

export interface CoreToolSurfaceDescriptorOptions {
  terminalCollapsed: boolean;
  sidePanesFlipped?: boolean;
  harnesses: AgentHarnessDetection[];
}

export function buildCoreToolSurfaceDescriptors(options: CoreToolSurfaceDescriptorOptions): ToolSurfaceDescriptor[] {
  const launchableHarnesses = launchableToolSurfaceHarnesses(options.harnesses);
  return [
    {
      id: options.terminalCollapsed ? "terminal-expand" : "terminal-collapse",
      testId: options.terminalCollapsed ? "terminal-expand" : "terminal-collapse",
      label: options.terminalCollapsed ? "Expand terminal" : "Collapse terminal",
      title: options.terminalCollapsed ? "Expand terminal" : "Collapse terminal",
      kind: "railAction",
      placement: "rightRail",
      owner: "core",
      action: { type: "terminal.toggleDock" },
      enabled: true,
      visible: true,
    },
    terminalLaunchDescriptor({
      id: "launch-shell",
      label: "New terminal",
      title: "New terminal",
      terminalKind: "shell",
      harnessId: "shell",
      owner: "core",
      capabilityId: "shell",
    }),
    ...launchableHarnesses.map((harness) =>
      terminalLaunchDescriptor({
        id: `launch-${harness.id}`,
        label: `Launch ${harness.label}`,
        title: `Launch ${harness.label}`,
        terminalKind: harness.launcher ? terminalSubstrateKindForManagedAgentKind(harness.launcher.kind) : "agent",
        harnessId: harness.id,
        owner: "officialPlugin",
        capabilityId: harness.id,
      }),
    ),
    {
      id: "open-agent-config",
      testId: "open-agent-config",
      label: "Agent config",
      title: "Agent config",
      kind: "railAction",
      placement: "rightRail",
      owner: "core",
      action: { type: "agentConfig.open" },
      enabled: true,
      visible: true,
    },
    {
      id: "open-plugin-manager",
      testId: "open-plugin-manager",
      label: "Plugin manager",
      title: "Plugin manager",
      kind: "railAction",
      placement: "rightRail",
      owner: "core",
      action: { type: "pluginManager.open" },
      enabled: true,
      visible: true,
    },
    {
      id: "swap-side-panes",
      testId: "swap-side-panes",
      label: "Swap side panes",
      title: options.sidePanesFlipped ? "Move explorer left and terminal right" : "Move terminal left and explorer right",
      kind: "railAction",
      placement: "rightRail",
      owner: "core",
      action: { type: "sidePanes.toggle" },
      enabled: true,
      visible: true,
    },
  ];
}

export function launchableToolSurfaceHarnesses(harnesses: AgentHarnessDetection[]): AgentHarnessDetection[] {
  return harnesses.filter((harness) => harness.id !== "shell" && harness.visible !== false && harness.enabled && harness.launchable);
}

export function toolSurfaceDescriptorsFromInventory(items: PluginInventoryItem[]): ToolSurfaceDescriptor[] {
  return items
    .filter((item) => item.enabled && item.trust === "trusted" && item.surfaces.includes("desktop"))
    .flatMap((item) => {
      switch (item.kind) {
        case "core:routineTemplate":
          return [capabilityToolDescriptor(item, { type: "routineTemplate.open", routineTemplateId: item.id }, "toolDockPane")];
        case "exo.graph:visualization":
          return [
            capabilityToolDescriptor(item, { type: "graphVisualization.open", graphVisualizationId: item.id }, "toolDockPane", {
              graphVisualization: graphVisualizationMetadataFromInventoryItem(item),
              webViewer: graphVisualizationWebViewerMetadataFromInventoryItem(item),
            }),
          ];
        default:
          return [];
      }
    });
}

export function toolSurfaceDescriptorsFromCapabilities(capabilities: CapabilityMetadata[]): ToolSurfaceDescriptor[] {
  return capabilities
    .filter((capability) => isCapabilityAvailableOnSurface(capability, "desktop"))
    .flatMap((capability) => {
      switch (capability.kind) {
        case "core:routineTemplate":
          return [
            capabilityToolDescriptor(
              {
                id: capability.id,
                label: capability.label,
                description: capability.description,
                kind: capability.kind,
                enabled: true,
                trust: "trusted",
                surfaces: capability.surfaces,
                distribution: "official",
                pluginId: undefined,
              },
              { type: "routineTemplate.open", routineTemplateId: capability.id },
              "toolDockPane",
            ),
          ];
        case "exo.graph:visualization":
          return [
            capabilityToolDescriptor(
              {
                id: capability.id,
                label: capability.label,
                description: capability.description,
                kind: capability.kind,
                enabled: true,
                trust: "trusted",
                surfaces: capability.surfaces,
                distribution: "official",
                pluginId: undefined,
              },
              { type: "graphVisualization.open", graphVisualizationId: capability.id },
              "toolDockPane",
              {
                graphVisualization: graphVisualizationMetadataFromCapability(capability),
                webViewer: graphVisualizationWebViewerMetadataFromCapability(capability),
              },
            ),
          ];
        default:
          return [];
      }
    });
}

export function coreWebViewerToolMetadata(): CoreWebViewerToolMetadata {
  return {
    contractVersion: "0.1",
    targetPolicy: {
      allowedTargetKinds: ["localFile", "localhostUrl", "artifact", "trustedUrl"],
      validationOwner: "core",
    },
    endpoints: {
      open: EXO_COMMAND_ROUTES.openPreview,
      focus: EXO_COMMAND_ROUTES.focusPreview,
      close: EXO_COMMAND_ROUTES.closePreview,
    },
  };
}

export function buildCoreWebViewerDescriptor(input: {
  id: string;
  label: string;
  title: string;
  request: CoreWebViewerOpenRequest;
  owner: ToolSurfaceOwnerKind;
  capabilityId?: string;
  pluginId?: string;
  placement?: ToolSurfacePlacement;
}): ToolSurfaceDescriptor {
  return {
    id: input.id,
    testId: `tool-${input.id}`,
    label: input.label,
    title: input.title,
    kind: "toolDockPane",
    placement: input.placement ?? "toolDock",
    owner: input.owner,
    action: { type: "webViewer.open", request: input.request },
    capabilityId: input.capabilityId,
    pluginId: input.pluginId,
    enabled: true,
    visible: true,
    webViewer: coreWebViewerToolMetadata(),
  };
}

export function buildSafePluginPanelDescriptor(input: {
  id: string;
  label: string;
  title: string;
  panelId: string;
  owner: ToolSurfaceOwnerKind;
  capabilityId?: string;
  pluginId?: string;
  placement?: ToolSurfacePlacement;
  hostPlacement?: PluginPanelHostPlacement;
  enabled: boolean;
  trusted: boolean;
  desktopSurface: boolean;
}): ToolSurfaceDescriptor | undefined {
  if (!input.enabled || !input.trusted || !input.desktopSurface) {
    return undefined;
  }
  return {
    id: input.id,
    testId: `tool-${input.id}`,
    label: input.label,
    title: input.title,
    kind: "pluginPanel",
    placement: input.placement ?? "toolDock",
    owner: input.owner,
    action: { type: "pluginPanel.open", panelId: input.panelId },
    capabilityId: input.capabilityId,
    pluginId: input.pluginId,
    enabled: true,
    visible: true,
    pluginPanel: {
      contractVersion: "0.1",
      panelId: input.panelId,
      hostPlacement: input.hostPlacement ?? "toolDock",
      hostKind: "coreRendererPanel",
      rendererEntrypointLoading: "disabled",
    },
  };
}

function terminalLaunchDescriptor(input: {
  id: string;
  label: string;
  title: string;
  terminalKind: TerminalSubstrateKind;
  harnessId: AgentHarnessId;
  owner: ToolSurfaceOwnerKind;
  capabilityId: string;
}): ToolSurfaceDescriptor {
  return {
    id: input.id,
    testId: input.id,
    label: input.label,
    title: input.title,
    kind: "railAction",
    placement: "rightRail",
    owner: input.owner,
    capabilityId: input.capabilityId,
    action: { type: "terminal.launch", terminalKind: input.terminalKind, harnessId: input.harnessId },
    enabled: true,
    visible: true,
  };
}

function capabilityToolDescriptor(
  item: Pick<PluginInventoryItem, "id" | "label" | "description" | "kind" | "enabled" | "trust" | "surfaces" | "distribution" | "pluginId">,
  action: ToolSurfaceAction,
  kind: ToolSurfaceDescriptorKind,
  metadata: Pick<ToolSurfaceDescriptor, "graphVisualization" | "webViewer"> = {},
): ToolSurfaceDescriptor {
  return {
    id: item.id,
    testId: `tool-${item.id}`,
    label: item.label,
    title: item.description,
    kind,
    placement: "toolDock",
    owner: item.distribution === "official" ? "officialPlugin" : item.distribution === "developer" ? "developerPlugin" : "localPlugin",
    action,
    capabilityId: item.id,
    pluginId: item.pluginId,
    enabled: item.enabled,
    visible: item.enabled && item.trust === "trusted" && item.surfaces.includes("desktop"),
    ...metadata,
  };
}

function graphVisualizationMetadataFromCapability(capability: CapabilityMetadata): GraphVisualizationToolMetadata | undefined {
  const definition = graphVisualizationFromCapability(capability);
  return definition ? { data: definition.data, surface: definition.surface } : undefined;
}

function graphVisualizationWebViewerMetadataFromCapability(capability: CapabilityMetadata): CoreWebViewerToolMetadata | undefined {
  const definition = graphVisualizationFromCapability(capability);
  return definition?.surface.hostSurface === "webPreview" ? coreWebViewerToolMetadata() : undefined;
}

function graphVisualizationMetadataFromInventoryItem(item: PluginInventoryItem): GraphVisualizationToolMetadata | undefined {
  if (item.kind !== "exo.graph:visualization") {
    return undefined;
  }
  return graphVisualizationMetadataFromCapability({
    id: item.id,
    kind: "exo.graph:visualization",
    label: item.label,
    description: item.description,
    lifecycle: item.lifecycle,
    owner: item.owner,
    surfaces: item.surfaces,
    permissions: item.permissions,
    compatibility: item.compatibility,
  });
}

function graphVisualizationWebViewerMetadataFromInventoryItem(item: PluginInventoryItem): CoreWebViewerToolMetadata | undefined {
  if (item.kind !== "exo.graph:visualization") {
    return undefined;
  }
  return graphVisualizationWebViewerMetadataFromCapability({
    id: item.id,
    kind: "exo.graph:visualization",
    label: item.label,
    description: item.description,
    lifecycle: item.lifecycle,
    owner: item.owner,
    surfaces: item.surfaces,
    permissions: item.permissions,
    compatibility: item.compatibility,
  });
}
