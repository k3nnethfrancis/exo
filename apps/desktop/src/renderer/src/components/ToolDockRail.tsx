import type { CSSProperties, ReactNode } from "react";

import { RailButton } from "./Chrome";

export interface ToolDockAction {
  id: string;
  title: string;
  icon: ReactNode;
  onSelect: () => void;
  testId?: string;
  disabled?: boolean;
}

export type ToolDockRailPlacement = "right" | "bottom";

export interface ToolDockRailProps {
  placement: ToolDockRailPlacement;
  primary: ReactNode;
  secondaryActions?: ToolDockAction[];
  testId?: string;
  className?: string;
  spacerClassName?: string;
  style?: CSSProperties;
}

export function ToolDockRail(props: ToolDockRailProps) {
  const {
    placement,
    primary,
    secondaryActions = [],
    testId = "tool-dock-rail",
    className = "tool-dock-rail",
    spacerClassName = "tool-dock-rail__spacer",
    style,
  } = props;

  return (
    <div className={className} data-testid={testId} data-tool-dock-placement={placement} style={style}>
      {primary}
      <div className={spacerClassName} aria-hidden="true" />
      <ToolDockActionButtons actions={secondaryActions} />
    </div>
  );
}

export function ToolDockActionButtons({ actions }: { actions: ToolDockAction[] }) {
  return (
    <>
      {actions.map((action) => (
        <RailButton
          key={action.id}
          testId={action.testId}
          onClick={action.onSelect}
          title={action.title}
          disabled={action.disabled}
        >
          {action.icon}
        </RailButton>
      ))}
    </>
  );
}
