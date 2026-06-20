import { useEffect, useState, type CSSProperties, type ReactNode } from "react";
import type { AgentHarnessDetection } from "@exo/core";
import { Bot, PanelRightClose, PanelRightOpen, PanelsLeftBottom, Settings2, SquareTerminal } from "lucide-react";

import type { TerminalKind } from "../../../shared/api";
import { AgentIcon } from "./AgentIcon";
import { RailButton } from "./Chrome";

interface TerminalRailProps {
  placement: "right" | "bottom";
  collapsed: boolean;
  sidePanesFlipped: boolean;
  topControls?: ReactNode;
  onToggleCollapsed: () => void;
  onToggleSidePanes: () => void;
  onOpenAgentConfigEditor: () => void;
  onCreateTerminal: (kind: TerminalKind) => void;
  style?: CSSProperties;
}

export function TerminalRail(props: TerminalRailProps) {
  const { collapsed, sidePanesFlipped, topControls, onToggleCollapsed, onToggleSidePanes, onOpenAgentConfigEditor, onCreateTerminal, style } = props;

  return (
    <div className="terminal-rail" data-testid="terminal-rail" style={style}>
      {topControls ?? (
        <TerminalRailTopControls
          collapsed={collapsed}
          onToggleCollapsed={onToggleCollapsed}
          onOpenAgentConfigEditor={onOpenAgentConfigEditor}
          onCreateTerminal={onCreateTerminal}
        />
      )}
      <div className="terminal-rail__spacer" aria-hidden="true" />
      <RailButton
        testId="swap-side-panes"
        onClick={onToggleSidePanes}
        title={sidePanesFlipped ? "Move explorer left and terminal right" : "Move terminal left and explorer right"}
      >
        <PanelsLeftBottom size={16} />
      </RailButton>
    </div>
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
  const CollapseIcon = collapsed ? PanelRightOpen : PanelRightClose;
  const launchableAgentHarnesses = launchableTerminalAgentHarnesses(harnesses);

  return (
    <>
      <RailButton
        testId={collapsed ? "terminal-expand" : "terminal-collapse"}
        onClick={onToggleCollapsed}
        title={collapsed ? "Expand terminal" : "Collapse terminal"}
      >
        <CollapseIcon size={16} />
      </RailButton>
      <RailButton
        testId="launch-shell"
        onClick={() => onCreateTerminal("shell")}
        title="New terminal"
      >
        <SquareTerminal size={16} />
      </RailButton>
      {launchableAgentHarnesses.map((harness) => (
        <RailButton
          key={harness.id}
          testId={`launch-${harness.id}`}
          onClick={() => onCreateTerminal(harness.id)}
          title={`Launch ${harness.label}`}
        >
          <HarnessRailIcon harness={harness} />
        </RailButton>
      ))}
      <RailButton
        testId="open-agent-config"
        onClick={onOpenAgentConfigEditor}
        title="Agent config"
      >
        <Settings2 size={16} />
      </RailButton>
    </>
  );
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
  return harnesses.filter((harness) => harness.id !== "shell" && harness.enabled && harness.launchable);
}
