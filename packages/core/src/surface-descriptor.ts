import type { AgentHarnessDetection, ManagedAgentKind } from "./types";
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

export type ToolSurfaceAction =
  | { type: "terminal.toggleDock" }
  | { type: "terminal.launch"; terminalKind: ManagedAgentKind }
  | { type: "agentConfig.open" }
  | { type: "pluginManager.open" }
  | { type: "sidePanes.toggle" }
  | { type: "routineTemplate.open"; routineTemplateId: string }
  | { type: "graphVisualization.open"; graphVisualizationId: string }
  | { type: "pluginPanel.open"; panelId: string };

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
}

export interface GraphVisualizationToolMetadata {
  data: GraphVisualizationDataContract;
  surface: GraphVisualizationSurfaceContribution;
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
      owner: "core",
      capabilityId: "shell",
    }),
    ...launchableHarnesses.map((harness) =>
      terminalLaunchDescriptor({
        id: `launch-${harness.id}`,
        label: `Launch ${harness.label}`,
        title: `Launch ${harness.label}`,
        terminalKind: harness.id,
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
        case "routineTemplate":
          return [capabilityToolDescriptor(item, { type: "routineTemplate.open", routineTemplateId: item.id }, "toolDockPane")];
        case "graphVisualization":
          return [
            capabilityToolDescriptor(item, { type: "graphVisualization.open", graphVisualizationId: item.id }, "toolDockPane", {
              graphVisualization: graphVisualizationMetadataFromInventoryItem(item),
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
        case "routineTemplate":
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
        case "graphVisualization":
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
              },
            ),
          ];
        default:
          return [];
      }
    });
}

function terminalLaunchDescriptor(input: {
  id: string;
  label: string;
  title: string;
  terminalKind: ManagedAgentKind;
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
    action: { type: "terminal.launch", terminalKind: input.terminalKind },
    enabled: true,
    visible: true,
  };
}

function capabilityToolDescriptor(
  item: Pick<PluginInventoryItem, "id" | "label" | "description" | "kind" | "enabled" | "trust" | "surfaces" | "distribution" | "pluginId">,
  action: ToolSurfaceAction,
  kind: ToolSurfaceDescriptorKind,
  metadata: Pick<ToolSurfaceDescriptor, "graphVisualization"> = {},
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

function graphVisualizationMetadataFromInventoryItem(item: PluginInventoryItem): GraphVisualizationToolMetadata | undefined {
  if (item.kind !== "graphVisualization") {
    return undefined;
  }
  return graphVisualizationMetadataFromCapability({
    id: item.id,
    kind: "graphVisualization",
    label: item.label,
    description: item.description,
    lifecycle: item.lifecycle,
    owner: item.owner,
    surfaces: item.surfaces,
    permissions: item.permissions,
    compatibility: item.compatibility,
  });
}
