import { X } from "lucide-react";

import type { WorkspaceGitChange } from "../../../shared/api";

export type ChangedNote = WorkspaceGitChange & { rootPath: string; rootLabel: string };

interface ChangedNotesDialogProps {
  changes: ChangedNote[];
  onClose: () => void;
  onOpenChange: (change: ChangedNote) => void;
}

export function ChangedNotesDialog({ changes, onClose, onOpenChange }: ChangedNotesDialogProps) {
  return (
    <div className="dialog-overlay" data-testid="changed-notes-overlay">
      <div className="dialog-card dialog-card--changed-notes" data-testid="changed-notes-dialog">
        <div className="dialog-card__header">
          <div>
            <div className="dialog-card__title">Changed Notes</div>
            <div className="dialog-card__message">Changed files in attached notes repositories. Diff and commit actions will live here later.</div>
          </div>
          <button
            aria-label="Close changed notes"
            className="dialog-card__close"
            data-testid="changed-notes-close"
            onClick={onClose}
            title="Close"
            type="button"
          >
            <X size={16} />
          </button>
        </div>
        {changes.length === 0 ? (
          <div className="dialog-card__status">No changed notes detected.</div>
        ) : (
          <div className="changed-notes-list">
            {changes.map((change) => (
              <button
                className="changed-notes-list__item"
                data-testid="changed-notes-item"
                key={`${change.rootPath}:${change.path}:${change.status}`}
                onClick={() => onOpenChange(change)}
                title={change.absolutePath}
                type="button"
              >
                <span className="changed-notes-list__status">{change.status}</span>
                <span className="changed-notes-list__body">
                  <strong>{change.path}</strong>
                  <small>
                    {change.rootLabel}
                    {change.firstChangedLine ? ` · line ${change.firstChangedLine}` : ""}
                  </small>
                </span>
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
