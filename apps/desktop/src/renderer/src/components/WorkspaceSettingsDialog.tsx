import type { Dispatch, SetStateAction } from "react";
import { Plus, X } from "lucide-react";
import type { IndexStatus, WorkspaceSettings } from "@exo/core";

import type { AppearanceMode } from "../appearance";
import { agentInstructionStatusLabel, type AgentInstructionEditorController } from "../hooks/useAgentInstructionEditor";
import type { IndexBusyState, WorkspaceSettingsDialogState, WorkspaceSettingsSection } from "../workspaceSettingsDialogTypes";
import { HelpTooltip } from "./HelpTooltip";
import { PathList } from "./PathList";

interface WorkspaceSettingsDialogProps {
  agentInstructionEditor: AgentInstructionEditorController;
  indexBusy: IndexBusyState;
  indexStatus: IndexStatus | null;
  onChooseFolder: (target: "workspaceRoot" | "defaultTerminalCwd" | "projectRoot") => void | Promise<void>;
  onClose: () => void;
  onOpenWorkspaceSwitcher: () => void | Promise<void>;
  onRunIndexUpdate: (kind: Exclude<IndexBusyState, null>) => void | Promise<void>;
  onSave: (settingsDialog: WorkspaceSettingsDialogState, options: { includeStructural: boolean }) => void | Promise<void>;
  partialErrors: string[];
  settings: WorkspaceSettingsDialogState;
  setSettings: Dispatch<SetStateAction<WorkspaceSettingsDialogState | null>>;
  structuralDraftKey: (settings: WorkspaceSettingsDialogState) => string;
}

const SETTINGS_SECTIONS: WorkspaceSettingsSection[] = ["workspace", "index", "agents", "appearance", "terminal"];

export function WorkspaceSettingsDialog({
  agentInstructionEditor,
  indexBusy,
  indexStatus,
  onChooseFolder,
  onClose,
  onOpenWorkspaceSwitcher,
  onRunIndexUpdate,
  onSave,
  partialErrors,
  settings,
  setSettings,
  structuralDraftKey,
}: WorkspaceSettingsDialogProps) {
  return (
    <div className="dialog-overlay" data-testid="workspace-settings-overlay">
      <div className="dialog-card dialog-card--settings" data-testid="workspace-settings-dialog">
        <div className="dialog-card__header">
          <div className="dialog-card__title">Workspace Settings</div>
          <button
            aria-label="Close workspace settings"
            className="dialog-card__close"
            data-testid="workspace-settings-close"
            onClick={onClose}
            title="Close"
            type="button"
          >
            <X size={16} />
          </button>
        </div>
        <div className="dialog-card__message">Appearance and terminal preferences save immediately. Workspace paths and index settings take effect when you press Apply.</div>
        {partialErrors.length > 0 ? (
          <div className="dialog-card__status dialog-card__status--error" data-testid="agent-context-partial-errors">
            <div>Some agent instruction data could not be loaded.</div>
            {partialErrors.slice(0, 3).map((message) => (
              <div key={message}>{message}</div>
            ))}
          </div>
        ) : null}
        <div className="dialog-tabs" role="tablist" aria-label="Workspace settings sections">
          {SETTINGS_SECTIONS.map((section) => (
            <button
              className={`dialog-tabs__button ${settings.section === section ? "dialog-tabs__button--active" : ""}`}
              data-testid={`workspace-settings-tab-${section}`}
              key={section}
              onClick={() => setSettings((current) => (current ? { ...current, section } : current))}
              role="tab"
              type="button"
            >
              {section[0].toUpperCase() + section.slice(1)}
            </button>
          ))}
        </div>
        <div className="dialog-form">
          {settings.section === "workspace" ? (
            <WorkspaceSection settings={settings} setSettings={setSettings} onChooseFolder={onChooseFolder} onOpenWorkspaceSwitcher={onOpenWorkspaceSwitcher} />
          ) : null}
          {settings.section === "index" ? (
            <IndexSection indexBusy={indexBusy} indexStatus={indexStatus} settings={settings} setSettings={setSettings} onRunIndexUpdate={onRunIndexUpdate} />
          ) : null}
          {settings.section === "agents" ? (
            <AgentsSection agentInstructionEditor={agentInstructionEditor} />
          ) : null}
          {settings.section === "appearance" ? <AppearanceSection settings={settings} setSettings={setSettings} /> : null}
          {settings.section === "terminal" ? <TerminalSection settings={settings} setSettings={setSettings} /> : null}
        </div>
        {structuralDraftKey(settings) !== settings.appliedWorkspaceKey ? (
          <div className="dialog-card__apply-row">
            <div className="dialog-card__status">Workspace path and index changes are ready to apply.</div>
            <button
              className="toolbar-button"
              data-testid="workspace-settings-apply"
              disabled={settings.applyStatus === "applying"}
              onClick={() => void onSave(settings, { includeStructural: true })}
              type="button"
            >
              {settings.applyStatus === "applying" ? "Applying..." : "Apply"}
            </button>
          </div>
        ) : null}
        {settings.applyStatus === "applied" ? (
          <div className="dialog-card__status" data-testid="workspace-settings-apply-status">
            Applied. Workspace paths are active.
          </div>
        ) : null}
        {settings.applyStatus === "error" && settings.applyErrorMessage ? (
          <div className="dialog-card__status dialog-card__status--error">{settings.applyErrorMessage}</div>
        ) : null}
        {settings.saveStatus === "saving" ? (
          <div className="dialog-card__status" data-testid="workspace-settings-status">
            Saving...
          </div>
        ) : null}
        {settings.saveStatus === "saved" ? (
          <div className="dialog-card__status" data-testid="workspace-settings-status">
            Draft saved. Press Apply for workspace path or index changes.
          </div>
        ) : null}
        {settings.saveStatus === "error" && settings.errorMessage ? (
          <div className="dialog-card__status dialog-card__status--error">{settings.errorMessage}</div>
        ) : null}
      </div>
    </div>
  );
}

function WorkspaceSection({
  onChooseFolder,
  onOpenWorkspaceSwitcher,
  settings,
  setSettings,
}: Pick<WorkspaceSettingsDialogProps, "onChooseFolder" | "onOpenWorkspaceSwitcher" | "settings" | "setSettings">) {
  return (
    <>
      <label className="dialog-field dialog-field--section">
        <span className="dialog-field__label">Workspace</span>
        <input
          className="dialog-card__input"
          data-testid="workspace-settings-workspace-root"
          value={settings.workspaceRoot}
          onChange={(event) =>
            setSettings((current) =>
              current ? { ...current, workspaceRoot: event.target.value, applyStatus: "idle", applyErrorMessage: null } : current,
            )
          }
        />
        <div className="dialog-field__actions">
          <button className="toolbar-button" onClick={() => void onChooseFolder("workspaceRoot")} type="button">
            Select
          </button>
        </div>
      </label>
      <label className="dialog-field dialog-field--section">
        <span className="dialog-field__label">Default terminal</span>
        <input
          className="dialog-card__input"
          data-testid="workspace-settings-terminal-cwd"
          value={settings.defaultTerminalCwd}
          onChange={(event) =>
            setSettings((current) =>
              current ? { ...current, defaultTerminalCwd: event.target.value, applyStatus: "idle", applyErrorMessage: null } : current,
            )
          }
        />
        <div className="dialog-field__actions">
          <button className="toolbar-button" onClick={() => void onChooseFolder("defaultTerminalCwd")} type="button">
            Select
          </button>
        </div>
      </label>
      <div className="dialog-field dialog-field--section">
        <div className="dialog-field__header">
          <span className="dialog-field__label">Notes folder</span>
          <button className="toolbar-button" onClick={() => void onOpenWorkspaceSwitcher()} type="button">
            Switch workspace
          </button>
        </div>
        <PathList
          emptyLabel="No notes folder selected."
          paths={settings.noteRoots}
          testId="workspace-settings-note-roots"
          onRemove={() => setSettings((current) => (current ? { ...current, noteRoots: [], applyStatus: "idle", applyErrorMessage: null } : current))}
        />
      </div>
      <div className="dialog-field dialog-field--section">
        <div className="dialog-field__header">
          <span className="dialog-field__label">Project folders</span>
          <button
            aria-label="Add project folder"
            className="toolbar-button toolbar-button--icon"
            onClick={() => void onChooseFolder("projectRoot")}
            title="Add project folder"
            type="button"
          >
            <Plus size={15} />
          </button>
        </div>
        <PathList
          emptyLabel="No project folders added."
          paths={settings.projectRoots}
          testId="workspace-settings-project-roots"
          onRemove={(targetPath) =>
            setSettings((current) =>
              current
                ? {
                    ...current,
                    projectRoots: current.projectRoots.filter((entry) => entry !== targetPath),
                    applyStatus: "idle",
                    applyErrorMessage: null,
                  }
                : current,
            )
          }
        />
      </div>
    </>
  );
}

function IndexSection({
  indexBusy,
  indexStatus,
  onRunIndexUpdate,
  settings,
  setSettings,
}: Pick<WorkspaceSettingsDialogProps, "indexBusy" | "indexStatus" | "onRunIndexUpdate" | "settings" | "setSettings">) {
  return (
    <>
      <div className="index-summary">
        <div className="index-summary__header">
          <span>
            Local{" "}
            <button className="link-button link-button--inline" onClick={() => void window.exo.shell.openExternal("https://github.com/tobi/qmd")} type="button">
              QMD
            </button>{" "}
            Index
          </span>
        </div>
        <div className="index-summary__stats">
          <span>{indexStatus?.mode ?? settings.indexMode}</span>
          <span>
            {indexStatus?.indexedRoots.length ?? settings.indexedRoots.length} root
            {(indexStatus?.indexedRoots.length ?? settings.indexedRoots.length) === 1 ? "" : "s"}
          </span>
          <span>{indexStatus?.documentCount ?? 0} docs</span>
          <span>{indexStatus?.pendingEmbeddings ?? 0} pending</span>
        </div>
      </div>
      {indexStatus?.recentJobs?.length ? (
        <div className="index-activity" data-testid="workspace-settings-index-activity">
          <div className="index-activity__title">Recent index activity</div>
          {indexStatus.recentJobs.slice(0, 5).map((job) => (
            <div className="index-activity__row" key={job.id}>
              <span>{job.kind}</span>
              <span>{job.reason}</span>
              <span>{formatDuration(job.durationMs)}</span>
              <span>{formatRelativeTime(job.completedAt)}</span>
              <span>{job.status === "failed" ? "failed" : `${job.pendingEmbeddings ?? 0} pending`}</span>
            </div>
          ))}
        </div>
      ) : null}
      <label className="dialog-field dialog-field--section">
        <span className="dialog-field__label">Knowledge index</span>
        <select
          className="dialog-card__input"
          data-testid="workspace-settings-index-mode"
          value={settings.indexMode}
          onChange={(event) => {
            const nextMode = event.target.value as WorkspaceSettings["indexing"]["mode"];
            setSettings((current) =>
              current
                ? {
                    ...current,
                    indexMode: nextMode,
                    indexedRoots: nextMode === "off" ? [] : current.noteRoots,
                    exploreIndexSearchOnEnter: current.exploreIndexSearchOnEnter || (current.indexMode === "off" && nextMode !== "off"),
                    applyStatus: "idle",
                    applyErrorMessage: null,
                  }
                : current,
            );
          }}
        >
          <option value="off">Off</option>
          <option value="lexical">Lexical</option>
          <option value="semantic">Semantic</option>
          <option value="hybrid">Hybrid</option>
        </select>
      </label>
      <label className="dialog-check">
        <input
          checked={settings.exploreIndexSearchOnEnter}
          data-testid="workspace-settings-explore-index-enter"
          disabled={settings.indexMode === "off"}
          onChange={(event) =>
            setSettings((current) => (current ? { ...current, exploreIndexSearchOnEnter: event.target.checked, saveStatus: "idle", errorMessage: null } : current))
          }
          type="checkbox"
        />
        <span>Use indexed lexical search on Enter in Explore.</span>
      </label>
      <label className="dialog-field dialog-field--section">
        <span className="dialog-field__label">Index updates</span>
        <select
          className="dialog-card__input"
          data-testid="workspace-settings-index-update-strategy"
          disabled={settings.indexMode === "off"}
          value={settings.indexUpdateStrategy}
          onChange={(event) =>
            setSettings((current) =>
              current ? { ...current, indexUpdateStrategy: event.target.value as WorkspaceSettings["indexUpdateStrategy"], saveStatus: "idle", errorMessage: null } : current,
            )
          }
        >
          <option value="on-save">On save</option>
          <option value="manual">Manual only</option>
        </select>
      </label>
      <div className="dialog-field dialog-field--section">
        <div className="dialog-field__header">
          <span className="dialog-field__label">Manual sync</span>
        </div>
        <div className="dialog-card__actions dialog-card__actions--split">
          <button
            className="toolbar-button"
            data-testid="workspace-settings-sync-index"
            disabled={indexBusy !== null || !indexStatus?.enabled || indexStatus.indexedRoots.length === 0}
            onClick={() => void onRunIndexUpdate("syncing")}
            type="button"
          >
            {indexBusy === "syncing" ? "Syncing..." : "Sync now"}
          </button>
        </div>
      </div>
      <details className="dialog-details dialog-details--section">
        <summary>
          Advanced maintenance
          <HelpTooltip label="Refresh documents only re-reads Markdown into the lexical index without building embeddings. Build embeddings only creates missing semantic embeddings for documents already in the index. Use these when search looks stale, status says embeddings are needed, or you want to debug one index phase without running a full sync." />
        </summary>
        <div className="dialog-card__actions dialog-card__actions--split">
          <button
            className="toolbar-button"
            data-testid="workspace-settings-update-index"
            disabled={indexBusy !== null || !indexStatus?.enabled || indexStatus.indexedRoots.length === 0}
            onClick={() => void onRunIndexUpdate("updating")}
            type="button"
          >
            {indexBusy === "updating" ? "Refreshing..." : "Refresh documents only"}
          </button>
          <button
            className="toolbar-button"
            data-testid="workspace-settings-embed-index"
            disabled={indexBusy !== null || !indexStatus?.enabled || indexStatus.mode === "lexical" || indexStatus.indexedRoots.length === 0}
            onClick={() => void onRunIndexUpdate("embedding")}
            type="button"
          >
            {indexBusy === "embedding" ? "Embedding..." : "Build embeddings only"}
          </button>
        </div>
      </details>
    </>
  );
}

function AgentsSection({ agentInstructionEditor }: Pick<WorkspaceSettingsDialogProps, "agentInstructionEditor">) {
  const globalScope = agentInstructionEditor.state.config?.scopes.find((scope) => scope.id === "global") ?? null;
  const exocortexScope = agentInstructionEditor.state.config?.scopes.find((scope) => scope.id === "exocortex") ?? null;

  return (
    <div className="agent-context-summary" data-testid="agent-context-settings">
      <div className="agent-context-summary__header">
        <div>
          <div className="dialog-field__label">Agent config</div>
          <div className="agent-context-summary__copy">Keep Codex AGENTS.md and Claude CLAUDE.md aligned for global and notes instructions.</div>
        </div>
      </div>
      <div className="agent-context-summary__grid">
        <div className="agent-context-summary__metric">
          <span>Global</span>
          <strong>{agentInstructionStatusLabel(globalScope)}</strong>
          <small>~/.codex/AGENTS.md and ~/.claude/CLAUDE.md</small>
        </div>
        <div className="agent-context-summary__metric">
          <span>Exocortex</span>
          <strong>{agentInstructionStatusLabel(exocortexScope)}</strong>
          <small>{exocortexScope?.rootPath ?? "No notes folder selected."}</small>
        </div>
        <div className="agent-context-summary__metric">
          <span>Outputs</span>
          <strong>2</strong>
          <small>AGENTS.md and CLAUDE.md only.</small>
        </div>
      </div>
      <div className="agent-context-summary__footer">
        <span>Exo writes only the selected layer and leaves arbitrary project agent files alone.</span>
      </div>
    </div>
  );
}

function AppearanceSection({
  settings,
  setSettings,
}: Pick<WorkspaceSettingsDialogProps, "settings" | "setSettings">) {
  return (
    <div className="dialog-form__grid">
      <label className="dialog-field">
        <span className="dialog-field__label">Appearance</span>
        <select
          className="dialog-card__input"
          data-testid="workspace-settings-appearance"
          value={settings.appearanceMode}
          onChange={(event) =>
            setSettings((current) => (current ? { ...current, appearanceMode: event.target.value as AppearanceMode, saveStatus: "idle", errorMessage: null } : current))
          }
        >
          <option value="system">System</option>
          <option value="light">Light</option>
          <option value="dark">Dark</option>
        </select>
      </label>
      <label className="dialog-field">
        <span className="dialog-field__label">Editor font</span>
        <input
          className="dialog-card__input"
          data-testid="workspace-settings-editor-font-size"
          type="number"
          min={11}
          max={24}
          value={settings.editorFontSize}
          onChange={(event) => setSettings((current) => (current ? { ...current, editorFontSize: event.target.value, saveStatus: "idle", errorMessage: null } : current))}
        />
      </label>
      <label className="dialog-field">
        <span className="dialog-field__label">Explorer scale</span>
        <input
          className="dialog-card__input"
          data-testid="workspace-settings-explorer-scale"
          type="number"
          min={0.82}
          max={1.35}
          step={0.01}
          value={settings.explorerScale}
          onChange={(event) => setSettings((current) => (current ? { ...current, explorerScale: event.target.value, saveStatus: "idle", errorMessage: null } : current))}
        />
      </label>
    </div>
  );
}

function TerminalSection({
  settings,
  setSettings,
}: Pick<WorkspaceSettingsDialogProps, "settings" | "setSettings">) {
  return (
    <div className="dialog-form__grid">
      <label className="dialog-field">
        <span className="dialog-field__label">Terminal font</span>
        <input
          className="dialog-card__input"
          data-testid="workspace-settings-terminal-font-size"
          type="number"
          min={10}
          max={22}
          value={settings.terminalFontSize}
          onChange={(event) => setSettings((current) => (current ? { ...current, terminalFontSize: event.target.value, saveStatus: "idle", errorMessage: null } : current))}
        />
      </label>
      <label className="dialog-field">
        <span className="dialog-field__label">
          Live terminal scrollback lines
          <HelpTooltip label="Controls how many terminal output lines Exo keeps in the live terminal, tmux pane, and hydration buffer. Higher values use more memory. Durable transcripts are controlled separately." />
        </span>
        <input
          className="dialog-card__input"
          data-testid="workspace-settings-terminal-history-lines"
          type="number"
          min={500}
          step={1000}
          value={settings.terminalHistoryLines}
          onChange={(event) => setSettings((current) => (current ? { ...current, terminalHistoryLines: event.target.value, saveStatus: "idle", errorMessage: null } : current))}
        />
      </label>
      <label className="dialog-field">
        <span className="dialog-field__label">Transcript retention</span>
        <select
          className="dialog-card__input"
          data-testid="workspace-settings-terminal-transcript-retention"
          value={settings.terminalTranscriptRetention}
          onChange={(event) =>
            setSettings((current) =>
              current ? { ...current, terminalTranscriptRetention: event.target.value as WorkspaceSettings["terminalTranscriptRetention"], saveStatus: "idle", errorMessage: null } : current,
            )
          }
        >
          <option value="forever">Forever</option>
          <option value="days">Days</option>
        </select>
      </label>
      {settings.terminalTranscriptRetention === "days" ? (
        <label className="dialog-field">
          <span className="dialog-field__label">Retention days</span>
          <input
            className="dialog-card__input"
            data-testid="workspace-settings-terminal-transcript-days"
            type="number"
            min={1}
            max={3650}
            step={1}
            value={settings.terminalTranscriptRetentionDays}
            onChange={(event) =>
              setSettings((current) => (current ? { ...current, terminalTranscriptRetentionDays: event.target.value, saveStatus: "idle", errorMessage: null } : current))
            }
          />
        </label>
      ) : null}
      <label className="dialog-field">
        <span className="dialog-field__label">
          Agent read default characters
          <HelpTooltip label="Default terminal transcript characters returned when an agent reads a session without requesting a specific tail size." />
        </span>
        <input
          className="dialog-card__input"
          data-testid="workspace-settings-terminal-read-tail-chars"
          type="number"
          min={0}
          step={1000}
          value={settings.terminalReadTailChars}
          onChange={(event) => setSettings((current) => (current ? { ...current, terminalReadTailChars: event.target.value, saveStatus: "idle", errorMessage: null } : current))}
        />
      </label>
      <label className="dialog-field">
        <span className="dialog-field__label">
          Agent read maximum characters
          <HelpTooltip label="Maximum terminal transcript characters an agent can request through Exo MCP. Set higher when debugging long sessions." />
        </span>
        <input
          className="dialog-card__input"
          data-testid="workspace-settings-terminal-max-read-tail-chars"
          type="number"
          min={0}
          step={10000}
          value={settings.terminalMaxReadTailChars}
          onChange={(event) => setSettings((current) => (current ? { ...current, terminalMaxReadTailChars: event.target.value, saveStatus: "idle", errorMessage: null } : current))}
        />
      </label>
      <label className="dialog-field">
        <span className="dialog-field__label">
          Input coalesce milliseconds
          <HelpTooltip label="How long Exo batches rapid raw terminal input before writing it to tmux. Lower values favor immediate keystrokes; higher values can reduce write churn." />
        </span>
        <input
          className="dialog-card__input"
          data-testid="workspace-settings-terminal-input-coalesce-ms"
          type="number"
          min={0}
          step={5}
          value={settings.terminalInputCoalesceMs}
          onChange={(event) => setSettings((current) => (current ? { ...current, terminalInputCoalesceMs: event.target.value, saveStatus: "idle", errorMessage: null } : current))}
        />
      </label>
      <label className="dialog-field">
        <span className="dialog-field__label">
          Agent startup grace milliseconds
          <HelpTooltip label="How long Exo waits before flushing queued startup input to agent harnesses that show startup interstitials." />
        </span>
        <input
          className="dialog-card__input"
          data-testid="workspace-settings-terminal-agent-startup-grace-ms"
          type="number"
          min={0}
          step={100}
          value={settings.terminalAgentStartupGraceMs}
          onChange={(event) => setSettings((current) => (current ? { ...current, terminalAgentStartupGraceMs: event.target.value, saveStatus: "idle", errorMessage: null } : current))}
        />
      </label>
      <label className="dialog-field">
        <span className="dialog-field__label">
          Agent submit delay milliseconds
          <HelpTooltip label="Delay before pressing Enter for queued startup messages after an agent harness becomes ready." />
        </span>
        <input
          className="dialog-card__input"
          data-testid="workspace-settings-terminal-agent-submit-delay-ms"
          type="number"
          min={0}
          step={20}
          value={settings.terminalAgentSubmitDelayMs}
          onChange={(event) => setSettings((current) => (current ? { ...current, terminalAgentSubmitDelayMs: event.target.value, saveStatus: "idle", errorMessage: null } : current))}
        />
      </label>
      <label className="dialog-field">
        <span className="dialog-field__label">Initial terminal columns</span>
        <input
          className="dialog-card__input"
          data-testid="workspace-settings-terminal-initial-columns"
          type="number"
          min={20}
          value={settings.terminalInitialColumns}
          onChange={(event) => setSettings((current) => (current ? { ...current, terminalInitialColumns: event.target.value, saveStatus: "idle", errorMessage: null } : current))}
        />
      </label>
      <label className="dialog-field">
        <span className="dialog-field__label">Initial terminal rows</span>
        <input
          className="dialog-card__input"
          data-testid="workspace-settings-terminal-initial-rows"
          type="number"
          min={8}
          value={settings.terminalInitialRows}
          onChange={(event) => setSettings((current) => (current ? { ...current, terminalInitialRows: event.target.value, saveStatus: "idle", errorMessage: null } : current))}
        />
      </label>
      <label className="dialog-field">
        <span className="dialog-field__label">Minimum terminal columns</span>
        <input
          className="dialog-card__input"
          data-testid="workspace-settings-terminal-minimum-columns"
          type="number"
          min={1}
          value={settings.terminalMinimumColumns}
          onChange={(event) => setSettings((current) => (current ? { ...current, terminalMinimumColumns: event.target.value, saveStatus: "idle", errorMessage: null } : current))}
        />
      </label>
      <label className="dialog-field">
        <span className="dialog-field__label">Minimum terminal rows</span>
        <input
          className="dialog-card__input"
          data-testid="workspace-settings-terminal-minimum-rows"
          type="number"
          min={1}
          value={settings.terminalMinimumRows}
          onChange={(event) => setSettings((current) => (current ? { ...current, terminalMinimumRows: event.target.value, saveStatus: "idle", errorMessage: null } : current))}
        />
      </label>
      <label className="dialog-field">
        <span className="dialog-field__label">
          Unresponsive threshold milliseconds
          <HelpTooltip label="How long Exo waits after input without output before marking a terminal unhealthy." />
        </span>
        <input
          className="dialog-card__input"
          data-testid="workspace-settings-terminal-unresponsive-threshold-ms"
          type="number"
          min={1000}
          step={1000}
          value={settings.terminalUnresponsiveThresholdMs}
          onChange={(event) => setSettings((current) => (current ? { ...current, terminalUnresponsiveThresholdMs: event.target.value, saveStatus: "idle", errorMessage: null } : current))}
        />
      </label>
      <label className="dialog-field">
        <span className="dialog-field__label">
          Idle threshold milliseconds
          <HelpTooltip label="How long Exo waits without terminal output before showing an idle health state." />
        </span>
        <input
          className="dialog-card__input"
          data-testid="workspace-settings-terminal-idle-threshold-ms"
          type="number"
          min={1000}
          step={1000}
          value={settings.terminalIdleThresholdMs}
          onChange={(event) => setSettings((current) => (current ? { ...current, terminalIdleThresholdMs: event.target.value, saveStatus: "idle", errorMessage: null } : current))}
        />
      </label>
    </div>
  );
}

function formatDuration(durationMs: number): string {
  if (durationMs < 1000) {
    return `${durationMs}ms`;
  }
  return `${(durationMs / 1000).toFixed(durationMs < 10_000 ? 1 : 0)}s`;
}

function formatRelativeTime(value: string): string {
  const elapsedMs = Date.now() - new Date(value).getTime();
  if (!Number.isFinite(elapsedMs) || elapsedMs < 0) {
    return "just now";
  }
  if (elapsedMs < 60_000) {
    return `${Math.max(1, Math.round(elapsedMs / 1000))}s ago`;
  }
  if (elapsedMs < 3_600_000) {
    return `${Math.round(elapsedMs / 60_000)}m ago`;
  }
  return `${Math.round(elapsedMs / 3_600_000)}h ago`;
}
