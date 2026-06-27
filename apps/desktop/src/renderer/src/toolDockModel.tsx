import { Bot, PanelRightClose, PanelRightOpen, PanelsLeftBottom, Plug, Settings2, SquareTerminal } from "lucide-react";
import type { ReactNode } from "react";
import type { ToolSurfaceDescriptor } from "@exo/core/surface-descriptor";

import type { TerminalKind } from "../../shared/api";
import { AgentIcon } from "./components/AgentIcon";
import type { ToolDockAction } from "./components/ToolDockRail";

export interface ToolSurfaceActionHandlers {
  onToggleTerminalCollapsed: () => void;
  onToggleSidePanes: () => void;
  onOpenAgentConfigEditor: () => void;
  onOpenPluginManager: () => void;
  onCreateTerminal: (kind: TerminalKind) => void;
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
    case "agentConfig.open":
      handlers.onOpenAgentConfigEditor();
      return;
    case "pluginManager.open":
      handlers.onOpenPluginManager();
      return;
    case "sidePanes.toggle":
      handlers.onToggleSidePanes();
      return;
    case "routineTemplate.open":
    case "graphVisualization.open":
    case "pluginPanel.open":
      handlers.onOpenPluginManager();
      return;
  }
}

function iconForToolSurfaceDescriptor(descriptor: ToolSurfaceDescriptor): ReactNode {
  switch (descriptor.action.type) {
    case "terminal.toggleDock":
      return descriptor.id === "terminal-expand" ? <PanelRightOpen size={16} /> : <PanelRightClose size={16} />;
    case "terminal.launch":
      if (descriptor.action.terminalKind === "shell") {
        return <SquareTerminal size={16} />;
      }
      if (descriptor.action.terminalKind === "claude" || descriptor.action.terminalKind === "codex") {
        return <AgentIcon kind={descriptor.action.terminalKind} size={16} />;
      }
      return <Bot size={16} />;
    case "agentConfig.open":
      return <Settings2 size={16} />;
    case "pluginManager.open":
    case "routineTemplate.open":
    case "graphVisualization.open":
    case "pluginPanel.open":
      return <Plug size={16} />;
    case "sidePanes.toggle":
      return <PanelsLeftBottom size={16} />;
  }
}
