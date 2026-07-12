import { useEffect, useRef, useState } from "react";
import { Bot, FilePlus2, Folder, Settings } from "lucide-react";

interface WorkspaceMenuProps {
  collapsed: boolean;
  label: string;
  missingFolderIndexCount: number;
  onCreateMissingFolderIndexes: () => void;
  onOpenAgents: () => void;
  onOpenSettings: () => void;
}

export function WorkspaceMenu({ collapsed, label, missingFolderIndexCount, onCreateMissingFolderIndexes, onOpenAgents, onOpenSettings }: WorkspaceMenuProps) {
  const [open, setOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) return;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    const closeOnOutsidePress = (event: MouseEvent) => {
      if (!menuRef.current?.contains(event.target as Node)) setOpen(false);
    };
    window.addEventListener("keydown", closeOnEscape);
    window.addEventListener("mousedown", closeOnOutsidePress);
    return () => {
      window.removeEventListener("keydown", closeOnEscape);
      window.removeEventListener("mousedown", closeOnOutsidePress);
    };
  }, [open]);

  return (
    <div className={`workspace-menu-anchor${collapsed ? " workspace-menu-anchor--collapsed" : ""}`} ref={menuRef}>
      {open ? (
        <div className="workspace-menu" data-testid="workspace-menu-panel">
          <div className="workspace-menu__header"><Folder size={14} aria-hidden="true" />{label}</div>
          {missingFolderIndexCount > 0 ? (
            <button className="workspace-menu__item" data-testid="workspace-menu-create-indexes" onClick={() => { setOpen(false); onCreateMissingFolderIndexes(); }} type="button">
              <FilePlus2 size={14} aria-hidden="true" />Create {missingFolderIndexCount} missing folder {missingFolderIndexCount === 1 ? "index" : "indexes"}
            </button>
          ) : null}
          <button className="workspace-menu__item" data-testid="workspace-menu-agents" onClick={() => { setOpen(false); onOpenAgents(); }} type="button">
            <Bot size={14} aria-hidden="true" />Agents
          </button>
          <button className="workspace-menu__item" data-testid="workspace-menu-settings" onClick={() => { setOpen(false); onOpenSettings(); }} type="button">
            <Settings size={14} aria-hidden="true" />Settings
          </button>
        </div>
      ) : null}
      <button
        aria-expanded={open}
        aria-haspopup="menu"
        className="workspace-menu-button"
        data-testid="workspace-menu-toggle"
        onClick={() => setOpen((current) => !current)}
        title="Workspace menu"
        type="button"
      >
        <span className="workspace-menu-button__mark"><Folder size={13} aria-hidden="true" /></span>
        {!collapsed ? <span className="workspace-menu-button__label">{label}</span> : null}
      </button>
    </div>
  );
}
