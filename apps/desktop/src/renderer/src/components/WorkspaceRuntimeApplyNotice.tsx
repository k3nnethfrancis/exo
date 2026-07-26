import { AlertTriangle, RotateCcw } from "lucide-react";

interface WorkspaceRuntimeApplyNoticeProps {
  message: string;
  onRetry: () => void;
}

export function WorkspaceRuntimeApplyNotice(props: WorkspaceRuntimeApplyNoticeProps) {
  return (
    <aside
      aria-label="Workspace settings need attention"
      className="workspace-settings-notice workspace-runtime-apply-notice"
      data-testid="workspace-runtime-apply-notice"
      role="alert"
    >
      <AlertTriangle aria-hidden="true" size={16} strokeWidth={1.8} />
      <div>
        <strong>Workspace settings</strong>
        <span>{props.message}</span>
      </div>
      <button
        aria-label="Retry workspace settings"
        onClick={props.onRetry}
        title="Retry"
        type="button"
      >
        <RotateCcw aria-hidden="true" size={15} strokeWidth={1.9} />
      </button>
    </aside>
  );
}
