import type { KeyboardEvent, Ref } from "react";
import { Search, X } from "lucide-react";

export interface WorkspaceSearchFieldProps {
  inputRef?: Ref<HTMLInputElement>;
  query: string;
  onChange: (value: string) => void;
  onClear: () => void;
  onSubmit: () => void;
}

export type WorkspaceSearchKeyAction = "clear" | "submit" | null;

export function workspaceSearchKeyAction(key: string): WorkspaceSearchKeyAction {
  if (key === "Escape") return "clear";
  if (key === "Enter") return "submit";
  return null;
}

export function WorkspaceSearchField({ inputRef, query, onChange, onClear, onSubmit }: WorkspaceSearchFieldProps) {
  function handleKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    const action = workspaceSearchKeyAction(event.key);
    if (!action) return;

    event.preventDefault();
    if (action === "submit") {
      onSubmit();
      return;
    }

    onClear();
    event.currentTarget.blur();
  }

  return (
    <label className="workspace-search-field" data-testid="workspace-search-field">
      <Search aria-hidden="true" className="workspace-search-field__icon" size={14} />
      <input
        aria-label="Search workspace"
        autoCapitalize="off"
        autoComplete="off"
        data-testid="workspace-search-input"
        onChange={(event) => onChange(event.target.value)}
        onKeyDown={handleKeyDown}
        ref={inputRef}
        spellCheck={false}
        type="search"
        value={query}
      />
      {query ? (
        <button
          aria-label="Clear workspace search"
          className="workspace-search-field__clear"
          data-testid="workspace-search-clear"
          onClick={onClear}
          title="Clear"
          type="button"
        >
          <X aria-hidden="true" size={13} />
        </button>
      ) : null}
    </label>
  );
}
