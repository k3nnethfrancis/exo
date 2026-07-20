import {
  ArrowUpRight,
  Binary,
  Check,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  FilePenLine,
  FilePlus2,
  FileX2,
  MoveRight,
  RotateCcw,
  ShieldAlert,
  Undo2,
  type LucideIcon,
} from "lucide-react";
import type { CSSProperties, ReactNode } from "react";

import "./invocation-ui.css";

export type InvocationReviewOperation = "modified" | "created" | "deleted" | "renamed";
export type InvocationReviewMediaType = "text" | "binary";

export interface InvocationReviewItemProjection {
  id: string;
  path: string;
  previousPath?: string;
  operation: InvocationReviewOperation;
  mediaType?: InvocationReviewMediaType;
  summary?: string;
  conflict?: string;
}

export interface InvocationReviewQueueProjection {
  items: readonly InvocationReviewItemProjection[];
  currentIndex: number;
}

export interface InvocationReviewPosition {
  left: number;
  top: number;
  origin?: string;
  maxWidth?: number;
}

export interface InvocationReviewControlsProps {
  queue: InvocationReviewQueueProjection;
  position?: InvocationReviewPosition;
  onNavigate?: (index: number) => void;
  onKeepCurrent: (item: InvocationReviewItemProjection, index: number) => void;
  onRejectCurrent: (item: InvocationReviewItemProjection, index: number) => void;
  onKeepAll?: () => void;
  onRejectAll?: () => void;
  onRefreshConflict?: (item: InvocationReviewItemProjection, index: number) => void;
  onOpenConflict?: (item: InvocationReviewItemProjection, index: number) => void;
}

export function InvocationReviewControls({
  queue,
  position,
  onNavigate,
  onKeepCurrent,
  onRejectCurrent,
  onKeepAll,
  onRejectAll,
  onRefreshConflict,
  onOpenConflict,
}: InvocationReviewControlsProps) {
  if (queue.items.length === 0) return null;

  const index = clampReviewIndex(queue.currentIndex, queue.items.length);
  const item = queue.items[index];
  if (!item) return null;

  const multiple = queue.items.length > 1;
  const conflicted = Boolean(item.conflict);
  const descriptor = reviewDescriptor(item);
  const style = reviewPositionStyle(position);

  return (
    <section
      aria-label="Review agent changes"
      className={`invocation-review-controls${conflicted ? " invocation-review-controls--conflict" : ""}`}
      data-multiple={multiple ? "true" : "false"}
      data-narrow={position?.maxWidth !== undefined && position.maxWidth <= 320 ? "true" : "false"}
      data-positioned={position ? "true" : "false"}
      style={style}
    >
      <header className="invocation-review-controls__header">
        <span aria-hidden="true" className="invocation-review-controls__operation-icon">
          <descriptor.Icon size={15} strokeWidth={1.8} />
        </span>
        <div className="invocation-review-controls__identity">
          <div className="invocation-review-controls__eyebrow">
            <strong>{descriptor.label}</strong>
            {item.mediaType === "binary" ? (
              <span className="invocation-review-controls__media"><Binary aria-hidden="true" size={11} />Binary</span>
            ) : null}
            {multiple ? (
              <span aria-atomic="true" aria-live="polite" role="status">
                {index + 1} of {queue.items.length}
              </span>
            ) : null}
          </div>
          <span className="invocation-review-controls__path" title={reviewPathTitle(item)}>
            {reviewPathSummary(item)}
          </span>
        </div>
        {multiple ? (
          <nav aria-label="Review files" className="invocation-review-controls__navigation">
            <IconAction
              disabled={index === 0 || !onNavigate}
              label="Previous file"
              onClick={() => onNavigate?.(index - 1)}
            >
              <ChevronLeft size={15} />
            </IconAction>
            <IconAction
              disabled={index === queue.items.length - 1 || !onNavigate}
              label="Next file"
              onClick={() => onNavigate?.(index + 1)}
            >
              <ChevronRight size={15} />
            </IconAction>
          </nav>
        ) : null}
      </header>

      {item.summary && !conflicted ? (
        <p className="invocation-review-controls__summary">{item.summary}</p>
      ) : null}

      {conflicted ? (
        <ConflictActions
          conflict={item.conflict ?? "The file changed after this review was prepared."}
          onOpen={onOpenConflict ? () => onOpenConflict(item, index) : undefined}
          onRefresh={onRefreshConflict ? () => onRefreshConflict(item, index) : undefined}
        />
      ) : (
        <>
          <div aria-label="Review decision" className="invocation-review-controls__decisions" role="group">
            <DecisionAction kind="reject" label="Reject" onClick={() => onRejectCurrent(item, index)}>
              <Undo2 size={14} />
            </DecisionAction>
            <DecisionAction kind="keep" label="Keep" onClick={() => onKeepCurrent(item, index)}>
              <Check size={15} />
            </DecisionAction>
          </div>

          {multiple && (onKeepAll || onRejectAll) ? (
            <details className="invocation-review-controls__bulk">
              <summary>
                <ChevronDown aria-hidden="true" size={13} strokeWidth={1.8} />
                All {queue.items.length} files
              </summary>
              <div aria-label="Review all files" role="group">
                {onRejectAll ? (
                  <DecisionAction kind="reject" label="Reject all" onClick={onRejectAll}>
                    <Undo2 size={14} />
                  </DecisionAction>
                ) : null}
                {onKeepAll ? (
                  <DecisionAction kind="keep" label="Keep all" onClick={onKeepAll}>
                    <Check size={15} />
                  </DecisionAction>
                ) : null}
              </div>
            </details>
          ) : null}
        </>
      )}
    </section>
  );
}

function ConflictActions({
  conflict,
  onOpen,
  onRefresh,
}: {
  conflict: string;
  onOpen?: () => void;
  onRefresh?: () => void;
}) {
  return (
    <div className="invocation-review-controls__conflict">
      <ShieldAlert aria-hidden="true" size={15} />
      <p>
        <strong>Review changed</strong>
        <span>{conflict}</span>
      </p>
      <div aria-label="Conflict actions" role="group">
        {onRefresh ? (
          <IconAction label="Refresh review" onClick={onRefresh}><RotateCcw size={14} /></IconAction>
        ) : null}
        {onOpen ? (
          <IconAction label="Open file" onClick={onOpen}><ArrowUpRight size={14} /></IconAction>
        ) : null}
      </div>
    </div>
  );
}

function DecisionAction({
  children,
  kind,
  label,
  onClick,
}: {
  children: ReactNode;
  kind: "keep" | "reject";
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      aria-label={label}
      className={`invocation-review-decision invocation-review-decision--${kind}`}
      onClick={onClick}
      title={label}
      type="button"
    >
      {children}
      <span>{label}</span>
    </button>
  );
}

function IconAction({
  children,
  disabled = false,
  label,
  onClick,
}: {
  children: ReactNode;
  disabled?: boolean;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      aria-label={label}
      className="invocation-icon-action"
      disabled={disabled}
      onClick={onClick}
      title={label}
      type="button"
    >
      {children}
    </button>
  );
}

interface ReviewDescriptor {
  label: string;
  Icon: LucideIcon;
}

function reviewDescriptor(item: InvocationReviewItemProjection): ReviewDescriptor {
  const label = reviewOperationLabel(item.operation);
  if (item.operation === "created") return { label, Icon: FilePlus2 };
  if (item.operation === "deleted") return { label, Icon: FileX2 };
  if (item.operation === "renamed") return { label, Icon: MoveRight };
  return { label, Icon: FilePenLine };
}

export function reviewOperationLabel(operation: InvocationReviewOperation): string {
  if (operation === "created") return "Created";
  if (operation === "deleted") return "Deleted";
  if (operation === "renamed") return "Renamed";
  return "Edited";
}

export function clampReviewIndex(index: number, length: number): number {
  if (length <= 0) return 0;
  return Math.min(Math.max(Math.trunc(index), 0), length - 1);
}

function reviewPathSummary(item: InvocationReviewItemProjection): string {
  if (item.operation === "renamed" && item.previousPath) {
    return `${fileName(item.previousPath)} → ${fileName(item.path)}`;
  }
  return item.path;
}

function reviewPathTitle(item: InvocationReviewItemProjection): string {
  return item.operation === "renamed" && item.previousPath
    ? `${item.previousPath} → ${item.path}`
    : item.path;
}

function fileName(filePath: string): string {
  return filePath.split(/[\\/]/).filter(Boolean).at(-1) ?? filePath;
}

function reviewPositionStyle(position?: InvocationReviewPosition): CSSProperties | undefined {
  if (!position) return undefined;
  return {
    "--invocation-review-left": `${position.left}px`,
    "--invocation-review-top": `${position.top}px`,
    "--invocation-review-origin": position.origin ?? "top left",
    "--invocation-review-max-width": `${position.maxWidth ?? 420}px`,
  } as CSSProperties;
}
