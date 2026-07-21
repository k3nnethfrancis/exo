import { useEffect, useRef, useState } from "react";
import { ChevronLeft, CircleHelp, FilePlus2, Folder, Keyboard, Settings, SquareTerminal } from "lucide-react";
import { EXO_CLI_COMMANDS } from "@exo/core/operator-help";

import { APP_KEYBINDINGS, isMacPlatform } from "../shellHelpModel";

interface WorkspaceMenuProps {
  collapsed: boolean;
  label: string;
  missingFolderIndexCount: number;
  onCreateMissingFolderIndexes: () => void;
  onOpenSettings: () => void;
}

export function WorkspaceMenu({ collapsed, label, missingFolderIndexCount, onCreateMissingFolderIndexes, onOpenSettings }: WorkspaceMenuProps) {
  const [open, setOpen] = useState(false);
  const [showHelp, setShowHelp] = useState(false);
  const menuRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) return;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setOpen(false);
        setShowHelp(false);
      }
    };
    const closeOnOutsidePress = (event: MouseEvent) => {
      if (!menuRef.current?.contains(event.target as Node)) {
        setOpen(false);
        setShowHelp(false);
      }
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
          {showHelp ? <WorkspaceHelpPanel onBack={() => setShowHelp(false)} /> : (
            <>
              <div className="workspace-menu__header"><Folder size={14} aria-hidden="true" />{label}</div>
              {missingFolderIndexCount > 0 ? (
                <button className="workspace-menu__item" data-testid="workspace-menu-create-indexes" onClick={() => { setOpen(false); onCreateMissingFolderIndexes(); }} type="button">
                  <FilePlus2 size={14} aria-hidden="true" />Create {missingFolderIndexCount} missing folder {missingFolderIndexCount === 1 ? "index" : "indexes"}
                </button>
              ) : null}
              <div className="workspace-menu__footer">
                <button className="workspace-menu__item" data-testid="workspace-menu-settings" onClick={() => { setOpen(false); onOpenSettings(); }} type="button">
                  <Settings size={14} aria-hidden="true" />Settings
                </button>
                <button aria-label="Help" className="workspace-menu__icon" data-testid="workspace-menu-help" onClick={() => setShowHelp(true)} title="Help" type="button">
                  <CircleHelp size={15} aria-hidden="true" />
                </button>
              </div>
            </>
          )}
        </div>
      ) : null}
      <button
        aria-expanded={open}
        aria-haspopup="menu"
        className="workspace-menu-button"
        data-testid="workspace-menu-toggle"
        onClick={() => setOpen((current) => {
          if (current) setShowHelp(false);
          return !current;
        })}
        title="Workspace menu"
        type="button"
      >
        <span className="workspace-menu-button__mark"><Folder size={13} aria-hidden="true" /></span>
        {!collapsed ? <span className="workspace-menu-button__label">{label}</span> : null}
      </button>
    </div>
  );
}

export function WorkspaceHelpPanel({ isMac = isMacPlatform(), onBack }: { isMac?: boolean; onBack: () => void }) {
  return (
    <section className="workspace-help" data-testid="workspace-help">
      <header className="workspace-help__header">
        <button aria-label="Back to workspace menu" className="workspace-menu__icon" onClick={onBack} title="Back" type="button">
          <ChevronLeft size={15} aria-hidden="true" />
        </button>
        <strong>Help</strong>
      </header>
      <HelpSection icon={<Keyboard size={14} aria-hidden="true" />} label="Keyboard">
        {APP_KEYBINDINGS.map((shortcut) => (
          <li key={shortcut.id}><span>{shortcut.label}</span><kbd>{isMac ? shortcut.mac : shortcut.other}</kbd></li>
        ))}
      </HelpSection>
      <HelpSection icon={<SquareTerminal size={14} aria-hidden="true" />} label="CLI">
        {EXO_CLI_COMMANDS.map((command) => (
          <li key={command.syntax}><code>{command.syntax}</code><span>{command.label}</span></li>
        ))}
      </HelpSection>
    </section>
  );
}

function HelpSection({ children, icon, label }: { children: React.ReactNode; icon: React.ReactNode; label: string }) {
  return (
    <section className="workspace-help__section">
      <h2>{icon}{label}</h2>
      <ul>{children}</ul>
    </section>
  );
}
