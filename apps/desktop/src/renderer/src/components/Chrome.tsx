import type { DragEventHandler, MouseEventHandler, ReactNode } from "react";

interface RailButtonProps {
  title: string;
  onClick: MouseEventHandler<HTMLButtonElement>;
  children: ReactNode;
  testId?: string;
  className?: string;
}

interface ChromeTabProps {
  active: boolean;
  title?: string;
  testId?: string;
  className?: string;
  draggable?: boolean;
  onClick: MouseEventHandler<HTMLButtonElement>;
  onDoubleClick?: MouseEventHandler<HTMLButtonElement>;
  onDragStart?: DragEventHandler<HTMLButtonElement>;
  onDragEnd?: DragEventHandler<HTMLButtonElement>;
  leading?: ReactNode;
  trailing?: ReactNode;
  closeLabel?: string;
  closeTestId?: string;
  closeIcon?: ReactNode;
  onClose?: MouseEventHandler<HTMLSpanElement>;
  children: ReactNode;
}

export function RailButton(props: RailButtonProps) {
  const { title, onClick, children, testId, className } = props;
  return (
    <button
      className={`appearance-toggle__button ${className ?? ""}`.trim()}
      data-testid={testId}
      onClick={onClick}
      title={title}
      type="button"
    >
      {children}
    </button>
  );
}

export function ChromeTab(props: ChromeTabProps) {
  const {
    active,
    title,
    testId,
    className,
    draggable,
    onClick,
    onDoubleClick,
    onDragStart,
    onDragEnd,
    leading,
    trailing,
    closeLabel,
    closeTestId,
    closeIcon,
    onClose,
    children,
  } = props;

  return (
    <button
      className={`chrome-tab ${active ? "chrome-tab--active" : ""} ${className ?? ""}`.trim()}
      data-testid={testId}
      draggable={draggable}
      onClick={onClick}
      onDoubleClick={onDoubleClick}
      onDragStart={onDragStart}
      onDragEnd={onDragEnd}
      title={title}
      type="button"
    >
      {leading}
      <span className="chrome-tab__label">{children}</span>
      {trailing}
      {onClose ? (
        <span
          aria-label={closeLabel}
          className="chrome-tab__close"
          data-testid={closeTestId}
          onClick={onClose}
          role="button"
        >
          {closeIcon}
        </span>
      ) : null}
    </button>
  );
}
