import { PanelRightClose, PanelRightOpen, PanelsLeftBottom, Settings2, SquareTerminal } from "lucide-react";
import type { ReactNode } from "react";
import type { ToolSurfaceDescriptor } from "@exo/core/surface-descriptor";

import type { TerminalLaunchKind } from "../../shared/api";
import type { ToolDockAction } from "./components/ToolDockRail";

export interface ToolSurfaceActionHandlers {
  onToggleTerminalCollapsed: () => void;
  onToggleSidePanes: () => void;
  onCreateTerminal: (terminalKind: TerminalLaunchKind) => void;
}

export function toolDockActionsFromDescriptors(
  descriptors: ToolSurfaceDescriptor[],
  handlers: ToolSurfaceActionHandlers,
): ToolDockAction[] {
  return descriptors
    .filter((descriptor) => descriptor.visible)
    .map((descriptor) => ({
      id: descriptor.id,
      testId: descriptor.testId,
      title: descriptor.title,
      icon: iconForToolSurfaceDescriptor(descriptor),
      onSelect: () => runToolSurfaceAction(descriptor, handlers),
      disabled: !descriptor.enabled,
    }));
}

export function runToolSurfaceAction(descriptor: ToolSurfaceDescriptor, handlers: ToolSurfaceActionHandlers): void {
  if (!descriptor.enabled) {
    return;
  }
  switch (descriptor.action.type) {
    case "terminal.toggleDock":
      handlers.onToggleTerminalCollapsed();
      return;
    case "terminal.launch":
      handlers.onCreateTerminal(descriptor.action.terminalKind);
      return;
    case "sidePanes.toggle":
      handlers.onToggleSidePanes();
      return;
    case "pluginPanel.open":
      return;
  }
}

function iconForToolSurfaceDescriptor(descriptor: ToolSurfaceDescriptor): ReactNode {
  switch (descriptor.action.type) {
    case "terminal.toggleDock":
      return descriptor.id === "terminal-expand" ? <PanelRightOpen size={16} /> : <PanelRightClose size={16} />;
    case "terminal.launch":
      return <SquareTerminal size={16} />;
    case "pluginPanel.open":
      return <Settings2 size={16} />;
    case "sidePanes.toggle":
      return <PanelsLeftBottom size={16} />;
  }
}
