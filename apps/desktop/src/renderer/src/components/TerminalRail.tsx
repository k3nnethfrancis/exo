import type { CSSProperties, ReactNode } from "react";
import { Globe2, PanelRightClose, PanelRightOpen, PanelsLeftBottom, SquareTerminal } from "lucide-react";

import { AgentIcon } from "./AgentIcon";
import { RailButton } from "./Chrome";

interface TerminalRailProps {
  placement: "right" | "bottom";
  collapsed: boolean;
  sidePanesFlipped: boolean;
  topControls?: ReactNode;
  onToggleCollapsed: () => void;
  onToggleSidePanes: () => void;
  onCreateTerminal: (kind: "shell" | "claude" | "codex") => void;
  onCreateBrowserPane: () => void;
  style?: CSSProperties;
}

export function TerminalRail(props: TerminalRailProps) {
  const { collapsed, sidePanesFlipped, topControls, onToggleCollapsed, onToggleSidePanes, onCreateTerminal, onCreateBrowserPane, style } = props;

  return (
    <div className="terminal-rail" data-testid="terminal-rail" style={style}>
      {topControls ?? (
        <TerminalRailTopControls
          collapsed={collapsed}
          onToggleCollapsed={onToggleCollapsed}
          onCreateTerminal={onCreateTerminal}
          onCreateBrowserPane={onCreateBrowserPane}
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
  onCreateTerminal: (kind: "shell" | "claude" | "codex") => void;
  onCreateBrowserPane: () => void;
}) {
  const { collapsed, onToggleCollapsed, onCreateTerminal, onCreateBrowserPane } = props;
  const CollapseIcon = collapsed ? PanelRightOpen : PanelRightClose;

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
      <RailButton
        testId="launch-browser"
        onClick={onCreateBrowserPane}
        title="New preview pane"
      >
        <Globe2 size={16} />
      </RailButton>
      <RailButton
        testId="launch-claude"
        onClick={() => onCreateTerminal("claude")}
        title="Launch Claude"
      >
        <AgentIcon kind="claude" size={16} />
      </RailButton>
      <RailButton
        testId="launch-codex"
        onClick={() => onCreateTerminal("codex")}
        title="Launch Codex"
      >
        <AgentIcon kind="codex" size={16} />
      </RailButton>
    </>
  );
}
