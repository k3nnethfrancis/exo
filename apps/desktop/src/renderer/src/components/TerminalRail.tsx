import type { CSSProperties } from "react";
import { Bot, Code2, PanelBottomClose, PanelBottomOpen, PanelRightClose, PanelRightOpen, SquareTerminal } from "lucide-react";

import { RailButton } from "./Chrome";

interface TerminalRailProps {
  placement: "right" | "bottom";
  collapsed: boolean;
  onToggleCollapsed: () => void;
  onCreateTerminal: (kind: "shell" | "claude" | "codex") => void;
  style?: CSSProperties;
}

export function TerminalRail(props: TerminalRailProps) {
  const { placement, collapsed, onToggleCollapsed, onCreateTerminal, style } = props;
  const CollapseIcon =
    placement === "right"
      ? collapsed
        ? PanelRightOpen
        : PanelRightClose
      : collapsed
        ? PanelBottomOpen
        : PanelBottomClose;

  return (
    <div className="terminal-rail" data-testid="terminal-rail" style={style}>
      <RailButton
        testId={collapsed ? "terminal-expand" : "terminal-collapse"}
        onClick={onToggleCollapsed}
        title={collapsed ? "Expand terminal" : "Collapse terminal"}
      >
        <CollapseIcon size={13} />
      </RailButton>
      {!collapsed ? (
        <>
          <RailButton testId="launch-shell" onClick={() => onCreateTerminal("shell")} title="New terminal">
            <SquareTerminal size={13} />
          </RailButton>
          <RailButton testId="launch-claude" onClick={() => onCreateTerminal("claude")} title="Launch Claude">
            <Bot size={13} />
          </RailButton>
          <RailButton testId="launch-codex" onClick={() => onCreateTerminal("codex")} title="Launch Codex">
            <Code2 size={13} />
          </RailButton>
        </>
      ) : null}
    </div>
  );
}
