import type { MouseEventHandler, ReactNode } from "react";

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
  onClick: MouseEventHandler<HTMLElement>;
  onDoubleClick?: MouseEventHandler<HTMLElement>;
  onMouseDown?: MouseEventHandler<HTMLElement>;
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
    onClick,
    onDoubleClick,
    onMouseDown,
    leading,
    trailing,
    closeLabel,
    closeTestId,
    closeIcon,
    onClose,
    children,
  } = props;

  return (
    <div
      className={`chrome-tab ${active ? "chrome-tab--active" : ""} ${className ?? ""}`.trim()}
      data-testid={testId}
      onClick={onClick}
      onDoubleClick={onDoubleClick}
      onMouseDown={onMouseDown}
      title={title}
      role="button"
      tabIndex={0}
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
    </div>
  );
}
