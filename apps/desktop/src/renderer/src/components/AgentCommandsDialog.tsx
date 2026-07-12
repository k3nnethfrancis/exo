import { useEffect, useMemo, useState } from "react";
import { Bot, Plus, Trash2, X } from "lucide-react";
import type { AgentCommand } from "@exo/core";

export function AgentCommandsDialog({ commands, onClose, onSave }: {
  commands: AgentCommand[];
  onClose: () => void;
  onSave: (commands: AgentCommand[]) => Promise<void>;
}) {
  const [draft, setDraft] = useState(() => initialDraft(commands));
  const [saving, setSaving] = useState(false);
  useEffect(() => setDraft(initialDraft(commands)), [commands]);
  const valid = useMemo(() => draft.every((command) => /^[a-z][a-z0-9_-]{1,31}$/.test(command.handle) && command.command.trim()), [draft]);

  function update(index: number, patch: Partial<AgentCommand>) {
    setDraft((current) => current.map((command, currentIndex) => currentIndex === index ? { ...command, ...patch } : command));
  }

  async function save() {
    if (!valid || saving) return;
    setSaving(true);
    try {
      await onSave(draft.map((command) => ({ ...command, handle: command.handle.trim().replace(/^@/, "").toLowerCase(), label: command.label.trim() || command.handle.trim(), command: command.command.trim() })));
      onClose();
    } finally {
      setSaving(false);
    }
  }

  return <div className="dialog-overlay" data-testid="agent-commands-overlay">
    <section className="dialog-card dialog-card--agents" aria-label="Agents" data-testid="agent-commands-dialog">
      <header className="dialog-card__header">
        <div className="dialog-card__title">Agents</div>
        <button aria-label="Close agents" className="dialog-card__close" onClick={onClose} type="button"><X size={16} /></button>
      </header>
      <p className="dialog-card__message">Commands run locally only when you invoke their matching <code>@handle</code> in a note and confirm the launch.</p>
      <div className="agent-commands">
        {draft.map((command, index) => <div className="agent-command" key={command.id}>
          <div className="agent-command__heading"><Bot size={15} /><strong>{command.label || "New agent"}</strong><button aria-label={`Remove ${command.label || "agent"}`} className="toolbar-button toolbar-button--icon" onClick={() => setDraft((current) => current.filter((_, currentIndex) => currentIndex !== index))} title="Remove agent" type="button"><Trash2 size={14} /></button></div>
          <label><span>Handle</span><input value={command.handle} onChange={(event) => update(index, { handle: event.target.value })} placeholder="claude" /></label>
          <label><span>Name</span><input value={command.label} onChange={(event) => update(index, { label: event.target.value })} placeholder="Claude" /></label>
          <label className="agent-command__command"><span>Command</span><input value={command.command} onChange={(event) => update(index, { command: event.target.value })} placeholder="claude" /></label>
        </div>)}
        <button className="agent-commands__add" onClick={() => setDraft((current) => [...current, newAgentCommand(current.length)])} type="button"><Plus size={15} />Add agent</button>
      </div>
      {!valid ? <p className="agent-commands__error">Every agent needs a lowercase handle and a command.</p> : null}
      <footer className="dialog-card__footer"><button className="toolbar-button" onClick={onClose} type="button">Cancel</button><button className="toolbar-button toolbar-button--primary" disabled={!valid || saving} onClick={() => void save()} type="button">{saving ? "Saving…" : "Save agents"}</button></footer>
    </section>
  </div>;
}

function newAgentCommand(index: number): AgentCommand {
  return {
    id: `agent-${Date.now()}`,
    label: "New agent",
    handle: `agent-${index + 1}`,
    command: "",
    cwdPolicy: "workspace_root",
    promptDelivery: "terminalInputAfterLaunch",
    version: 1,
    enabled: true,
  };
}

function initialDraft(commands: AgentCommand[]): AgentCommand[] {
  if (commands.length > 0) return commands;
  return [{
    id: "claude",
    label: "Claude",
    handle: "claude",
    command: "claude",
    cwdPolicy: "workspace_root",
    promptDelivery: "terminalInputAfterLaunch",
    version: 1,
    enabled: true,
  }];
}
