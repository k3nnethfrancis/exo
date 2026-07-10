import {
  type TerminalSubstrateKind,
} from "./types";
import { EXO_COMMAND_ROUTES } from "./command-protocol";
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
  | { type: "terminal.launch"; terminalKind: TerminalSubstrateKind }
  | { type: "sidePanes.toggle" }
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
  pluginPanel?: PluginPanelToolMetadata;
  webViewer?: CoreWebViewerToolMetadata;
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
}

export function buildCoreToolSurfaceDescriptors(options: CoreToolSurfaceDescriptorOptions): ToolSurfaceDescriptor[] {
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

export function toolSurfaceDescriptorsFromInventory(items: PluginInventoryItem[]): ToolSurfaceDescriptor[] {
  return items
    .filter((item) => item.enabled && item.trust === "trusted" && item.surfaces.includes("desktop"))
    .flatMap(() => []);
}

export function toolSurfaceDescriptorsFromCapabilities(capabilities: CapabilityMetadata[]): ToolSurfaceDescriptor[] {
  return capabilities
    .filter((capability) => isCapabilityAvailableOnSurface(capability, "desktop"))
    .flatMap(() => []);
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
