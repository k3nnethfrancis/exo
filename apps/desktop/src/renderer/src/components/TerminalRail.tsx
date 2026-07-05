import { useEffect, useState, type CSSProperties, type ReactNode } from "react";
import {
  buildCoreToolSurfaceDescriptors,
  launchableToolSurfaceHarnesses,
} from "@exo/core/surface-descriptor";
import type { AgentHarnessDetection } from "@exo/core";

import type { TerminalLaunchKind } from "../../../shared/api";
import { ToolDockActionButtons, ToolDockRail, type ToolDockAction, type ToolDockRailPlacement } from "./ToolDockRail";
import { toolDockActionsFromDescriptors } from "../toolDockModel";

interface TerminalRailProps {
  placement: ToolDockRailPlacement;
  collapsed: boolean;
  sidePanesFlipped: boolean;
  topControls?: ReactNode;
  onToggleCollapsed: () => void;
  onToggleSidePanes: () => void;
  onOpenAgentConfigEditor: () => void;
  onOpenPluginManager: () => void;
  onCreateTerminal: (terminalKind: TerminalLaunchKind, harnessId?: string) => void;
  style?: CSSProperties;
}

export function TerminalRail(props: TerminalRailProps) {
  const {
    placement,
    collapsed,
    sidePanesFlipped,
    topControls,
    onToggleCollapsed,
    onToggleSidePanes,
    onOpenAgentConfigEditor,
    onOpenPluginManager,
    onCreateTerminal,
    style,
  } = props;
  const primary = topControls ?? (
    <TerminalRailTopControls
      collapsed={collapsed}
      onToggleCollapsed={onToggleCollapsed}
      onOpenAgentConfigEditor={onOpenAgentConfigEditor}
      onCreateTerminal={onCreateTerminal}
    />
  );

  return (
    <ToolDockRail
      placement={placement}
      primary={primary}
      secondaryActions={createSecondaryToolDockActions({ sidePanesFlipped, onOpenPluginManager, onToggleSidePanes })}
      className="terminal-rail"
      spacerClassName="terminal-rail__spacer"
      testId="terminal-rail"
      style={style}
    />
  );
}

export function TerminalRailTopControls(props: {
  collapsed: boolean;
  onToggleCollapsed: () => void;
  onOpenAgentConfigEditor: () => void;
  onCreateTerminal: (terminalKind: TerminalLaunchKind, harnessId?: string) => void;
  harnesses?: AgentHarnessDetection[];
}) {
  const { collapsed, onToggleCollapsed, onOpenAgentConfigEditor, onCreateTerminal } = props;
  const harnesses = useAgentHarnesses(props.harnesses);

  return (
    <ToolDockActionButtons
      actions={createTerminalToolDockActions({
        collapsed,
        harnesses,
        onToggleCollapsed,
        onOpenAgentConfigEditor,
        onCreateTerminal,
      })}
    />
  );
}

export function createTerminalToolDockActions(input: {
  collapsed: boolean;
  harnesses: AgentHarnessDetection[];
  onToggleCollapsed: () => void;
  onOpenAgentConfigEditor: () => void;
  onCreateTerminal: (terminalKind: TerminalLaunchKind, harnessId?: string) => void;
}): ToolDockAction[] {
  return toolDockActionsFromDescriptors(
    buildCoreToolSurfaceDescriptors({
      terminalCollapsed: input.collapsed,
      harnesses: input.harnesses,
    }).filter((descriptor) =>
      descriptor.action.type === "terminal.toggleDock" ||
      descriptor.action.type === "terminal.launch" ||
      descriptor.action.type === "agentConfig.open",
    ),
    {
      onToggleTerminalCollapsed: input.onToggleCollapsed,
      onToggleSidePanes: () => {},
      onOpenAgentConfigEditor: input.onOpenAgentConfigEditor,
      onOpenPluginManager: () => {},
      onCreateTerminal: input.onCreateTerminal,
    },
  );
}

function useAgentHarnesses(providedHarnesses?: AgentHarnessDetection[]): AgentHarnessDetection[] {
  const [harnesses, setHarnesses] = useState<AgentHarnessDetection[]>(providedHarnesses ?? []);

  useEffect(() => {
    if (providedHarnesses) {
      setHarnesses(providedHarnesses);
      return;
    }

    let cancelled = false;
    window.exo.workspace.listAgentHarnesses()
      .then((nextHarnesses) => {
        if (!cancelled) {
          setHarnesses(nextHarnesses);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setHarnesses([]);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [providedHarnesses]);

  return harnesses;
}

export function launchableTerminalAgentHarnesses(harnesses: AgentHarnessDetection[]): AgentHarnessDetection[] {
  return launchableToolSurfaceHarnesses(harnesses);
}

export function createSecondaryToolDockActions(input: {
  sidePanesFlipped: boolean;
  onOpenPluginManager: () => void;
  onToggleSidePanes: () => void;
}): ToolDockAction[] {
  return toolDockActionsFromDescriptors(
    buildCoreToolSurfaceDescriptors({
      terminalCollapsed: false,
      sidePanesFlipped: input.sidePanesFlipped,
      harnesses: [],
    }).filter((descriptor) =>
      descriptor.action.type === "pluginManager.open" ||
      descriptor.action.type === "sidePanes.toggle",
    ),
    {
      onToggleTerminalCollapsed: () => {},
      onToggleSidePanes: input.onToggleSidePanes,
      onOpenAgentConfigEditor: () => {},
      onOpenPluginManager: input.onOpenPluginManager,
      onCreateTerminal: () => {},
    },
  );
}
