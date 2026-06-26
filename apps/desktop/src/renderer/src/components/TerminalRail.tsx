import { useEffect, useState, type CSSProperties, type ReactNode } from "react";
import type { AgentHarnessDetection } from "@exo/core";
import { Bot, PanelRightClose, PanelRightOpen, PanelsLeftBottom, Plug, Settings2, SquareTerminal } from "lucide-react";

import type { TerminalKind } from "../../../shared/api";
import { AgentIcon } from "./AgentIcon";
import { ToolDockActionButtons, ToolDockRail, type ToolDockAction, type ToolDockRailPlacement } from "./ToolDockRail";

interface TerminalRailProps {
  placement: ToolDockRailPlacement;
  collapsed: boolean;
  sidePanesFlipped: boolean;
  topControls?: ReactNode;
  onToggleCollapsed: () => void;
  onToggleSidePanes: () => void;
  onOpenAgentConfigEditor: () => void;
  onOpenPluginManager: () => void;
  onCreateTerminal: (kind: TerminalKind) => void;
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
      secondaryActions={[
        {
          id: "open-plugin-manager",
          testId: "open-plugin-manager",
          title: "Plugin manager",
          icon: <Plug size={16} />,
          onSelect: onOpenPluginManager,
        },
        {
          id: "swap-side-panes",
          testId: "swap-side-panes",
          title: sidePanesFlipped ? "Move explorer left and terminal right" : "Move terminal left and explorer right",
          icon: <PanelsLeftBottom size={16} />,
          onSelect: onToggleSidePanes,
        },
      ]}
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
  onCreateTerminal: (kind: TerminalKind) => void;
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
  onCreateTerminal: (kind: TerminalKind) => void;
}): ToolDockAction[] {
  const CollapseIcon = input.collapsed ? PanelRightOpen : PanelRightClose;
  const launchableAgentHarnesses = launchableTerminalAgentHarnesses(input.harnesses);

  return [
    {
      id: input.collapsed ? "terminal-expand" : "terminal-collapse",
      testId: input.collapsed ? "terminal-expand" : "terminal-collapse",
      title: input.collapsed ? "Expand terminal" : "Collapse terminal",
      icon: <CollapseIcon size={16} />,
      onSelect: input.onToggleCollapsed,
    },
    {
      id: "launch-shell",
      testId: "launch-shell",
      title: "New terminal",
      icon: <SquareTerminal size={16} />,
      onSelect: () => input.onCreateTerminal("shell"),
    },
    ...launchableAgentHarnesses.map((harness) => ({
      id: `launch-${harness.id}`,
      testId: `launch-${harness.id}`,
      title: `Launch ${harness.label}`,
      icon: <HarnessRailIcon harness={harness} />,
      onSelect: () => input.onCreateTerminal(harness.id),
    })),
    {
      id: "open-agent-config",
      testId: "open-agent-config",
      title: "Agent config",
      icon: <Settings2 size={16} />,
      onSelect: input.onOpenAgentConfigEditor,
    },
  ];
}

function HarnessRailIcon({ harness }: { harness: AgentHarnessDetection }) {
  if (harness.id === "claude" || harness.id === "codex") {
    return <AgentIcon kind={harness.id} size={16} />;
  }

  return <Bot size={16} />;
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
  return harnesses.filter((harness) => harness.id !== "shell" && harness.visible !== false && harness.enabled && harness.launchable);
}
