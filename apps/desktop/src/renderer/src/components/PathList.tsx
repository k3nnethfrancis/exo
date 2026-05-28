import { X } from "lucide-react";

import { pathLabel } from "../workspaceTree";

export function PathList({
  emptyLabel,
  onRemove,
  paths,
  testId,
}: {
  emptyLabel: string;
  onRemove: (targetPath: string) => void;
  paths: string[];
  testId: string;
}) {
  return (
    <div className="path-list" data-testid={testId}>
      {paths.length === 0 ? <div className="path-list__empty">{emptyLabel}</div> : null}
      {paths.map((targetPath) => (
        <div className="path-list__item" key={targetPath}>
          <span className="path-list__text" title={targetPath}>
            <span className="path-list__name">{pathLabel(targetPath)}</span>
            <span className="path-list__path">{targetPath}</span>
          </span>
          <button
            aria-label={`Remove ${pathLabel(targetPath)}`}
            className="path-list__remove"
            onClick={() => onRemove(targetPath)}
            type="button"
          >
            <X size={14} />
          </button>
        </div>
      ))}
    </div>
  );
}
