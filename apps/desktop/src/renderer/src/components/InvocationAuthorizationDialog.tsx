import { useEffect, useState } from "react";

interface InvocationAuthorizationDialogProps {
  commandLabel: string;
  command: string;
  cwd: string;
  documentPath: string;
  fingerprint: string | null;
  message: string;
  onCancel: () => void;
  onRun: (persistTrust: boolean) => void;
}

export function InvocationAuthorizationDialog({
  commandLabel,
  command,
  cwd,
  documentPath,
  fingerprint,
  message,
  onCancel,
  onRun,
}: InvocationAuthorizationDialogProps) {
  const [persistTrust, setPersistTrust] = useState(false);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onCancel();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onCancel]);

  return (
    <div className="dialog-overlay invocation-authorization-overlay" role="presentation">
      <section className="dialog-card invocation-authorization" role="dialog" aria-modal="true" aria-labelledby="invocation-authorization-title">
        <div className="invocation-authorization__header">
          <div>
            <div className="invocation-authorization__eyebrow">Agent invocation</div>
            <h2 className="invocation-authorization__title" id="invocation-authorization-title">Run {commandLabel}?</h2>
          </div>
        </div>

        <p className="invocation-authorization__summary">
          {commandLabel} can run native code and edit files in this workspace. Exo will observe changes to this note for review.
        </p>

        <dl className="invocation-authorization__scope">
          <div><dt>Note</dt><dd title={documentPath}>{documentPath}</dd></div>
          <div><dt>Working folder</dt><dd title={cwd}>{cwd}</dd></div>
        </dl>

        <blockquote className="invocation-authorization__request">{message}</blockquote>

        <details className="invocation-authorization__details">
          <summary>Command details</summary>
          <dl>
            <div><dt>Shell</dt><dd>/bin/zsh -lc {command}</dd></div>
            {fingerprint ? <div><dt>Fingerprint</dt><dd className="invocation-authorization__fingerprint" title={fingerprint}>{fingerprint}</dd></div> : null}
          </dl>
        </details>

        <label className="invocation-authorization__remember">
          <input checked={persistTrust} onChange={(event) => setPersistTrust(event.target.checked)} type="checkbox" />
          <span>
            <strong>Don’t ask again for {commandLabel} in this workspace</strong>
            <small>Exo will ask again if this command changes.</small>
          </span>
        </label>

        <div className="dialog-card__actions invocation-authorization__actions">
          <button className="toolbar-button" onClick={onCancel} type="button">Cancel</button>
          <button autoFocus className="toolbar-button toolbar-button--primary" onClick={() => onRun(persistTrust)} type="button">Run {commandLabel}</button>
        </div>
      </section>
    </div>
  );
}
