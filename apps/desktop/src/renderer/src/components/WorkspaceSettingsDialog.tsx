import { useEffect, useState, type Dispatch, type SetStateAction } from "react";
import { Bot, FolderOpen, Palette, Search, TerminalSquare, X } from "lucide-react";
import type { AgentCommand, IndexStatus, WorkspaceSettings } from "@exo/core";

import type { AppearanceMode } from "../appearance";
import { THEME_FAMILIES, normalizeColorThemeId } from "../theme/registry";
import type { ColorThemeId } from "../theme/types";
import type { IndexBusyState, WorkspaceSettingsDialogState, WorkspaceSettingsSection } from "../workspaceSettingsDialogTypes";
import { HelpTooltip } from "./HelpTooltip";
import { PathList } from "./PathList";
import { AgentInvocationPromptEditor } from "./AgentInvocationPromptEditor";

interface WorkspaceSettingsDialogProps {
  indexBusy: IndexBusyState;
  indexStatus: IndexStatus | null;
  onChooseFolder: (target: "workspaceRoot" | "defaultTerminalCwd" | "noteRoot") => void | Promise<void>;
  onClose: () => void;
  onOpenWorkspaceSwitcher: () => void | Promise<void>;
  onRunIndexUpdate: (kind: Exclude<IndexBusyState, null>) => void | Promise<void>;
  onSave: (settingsDialog: WorkspaceSettingsDialogState, options: { includeStructural: boolean }) => void | Promise<void>;
  settings: WorkspaceSettingsDialogState;
  setSettings: Dispatch<SetStateAction<WorkspaceSettingsDialogState | null>>;
  structuralDraftKey: (settings: WorkspaceSettingsDialogState) => string;
}

const SETTINGS_SECTIONS: Array<{ id: WorkspaceSettingsSection; label: string; description: string; icon: typeof FolderOpen }> = [
  { id: "workspace", label: "Workspace", description: "Folders and roots", icon: FolderOpen },
  { id: "index", label: "Search", description: "Search behavior", icon: Search },
  { id: "appearance", label: "Appearance", description: "Theme and editor", icon: Palette },
  { id: "terminal", label: "Terminal", description: "Display", icon: TerminalSquare },
  { id: "agents", label: "Agents", description: "@ mentions and commands", icon: Bot },
];

export function WorkspaceSettingsDialog({
  indexBusy,
  indexStatus,
  onChooseFolder,
  onClose,
  onOpenWorkspaceSwitcher,
  onRunIndexUpdate,
  onSave,
  settings,
  setSettings,
  structuralDraftKey,
}: WorkspaceSettingsDialogProps) {
  const hasStructuralChanges = structuralDraftKey(settings) !== settings.appliedWorkspaceKey;

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
        <div className="dialog-card__message" aria-live="polite">
          {workspaceSettingsDialogIntroCopy(settings.section, hasStructuralChanges)}
        </div>
        <div className="workspace-settings-layout" data-testid="workspace-settings-body">
          <nav className="settings-nav" role="tablist" aria-label="Workspace settings sections">
            {SETTINGS_SECTIONS.map((section) => {
              const Icon = section.icon;
              return (
                <button
                  aria-selected={settings.section === section.id}
                  className={`settings-nav__button ${settings.section === section.id ? "settings-nav__button--active" : ""}`}
                  data-testid={`workspace-settings-tab-${section.id}`}
                  key={section.id}
                  onClick={() => setSettings((current) => (current ? { ...current, section: section.id } : current))}
                  role="tab"
                  type="button"
                >
                  <Icon size={16} />
                  <span>
                    <strong>{section.label}</strong>
                    <small>{section.description}</small>
                  </span>
                </button>
              );
            })}
          </nav>
          <div className="dialog-form workspace-settings-panel">
            {settings.section === "workspace" ? (
              <WorkspaceSection settings={settings} setSettings={setSettings} onChooseFolder={onChooseFolder} onOpenWorkspaceSwitcher={onOpenWorkspaceSwitcher} />
            ) : null}
            {settings.section === "index" ? (
              <IndexSection
                indexBusy={indexBusy}
                indexStatus={indexStatus}
                settings={settings}
                setSettings={setSettings}
                onRunIndexUpdate={onRunIndexUpdate}
              />
            ) : null}
            {settings.section === "appearance" ? <AppearanceSection settings={settings} setSettings={setSettings} /> : null}
            {settings.section === "terminal" ? <TerminalSection settings={settings} setSettings={setSettings} /> : null}
            {settings.section === "agents" ? <AgentsSection settings={settings} setSettings={setSettings} /> : null}
          </div>
        </div>
        <div className="dialog-card__footer">
          {hasStructuralChanges ? (
            <div className="dialog-card__apply-row">
              <div className="dialog-card__status">Workspace path and advanced search provider changes are ready to apply.</div>
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
              Changes applied.
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
              {workspaceSettingsSavedFooterCopy(hasStructuralChanges)}
            </div>
          ) : null}
          {settings.saveStatus === "error" && settings.errorMessage ? (
            <div className="dialog-card__status dialog-card__status--error">{settings.errorMessage}</div>
          ) : null}
        </div>
      </div>
    </div>
  );
}

export function workspaceSettingsSavedFooterCopy(hasStructuralChanges: boolean): string {
  return hasStructuralChanges ? "Draft saved. Apply to use workspace or search changes." : "Settings saved.";
}

export function workspaceSettingsDialogIntroCopy(section: WorkspaceSettingsSection, hasStructuralChanges: boolean): string {
  if (hasStructuralChanges) {
    return section === "index"
      ? "Advanced search changes are ready to apply."
      : "Workspace changes are ready to apply.";
  }

  if (section === "index") {
    return "Choose how Exo searches this workspace.";
  }

  if (section === "workspace") {
    return "Choose where Exo reads notes and opens terminals.";
  }

  if (section === "appearance") {
    return "Adjust how Exo looks and reads.";
  }
  if (section === "terminal") {
    return "Adjust terminal text.";
  }
  return "Configure the agents available from @ mentions.";
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
        <div className="settings-control-row">
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
          <button className="toolbar-button" onClick={() => void onChooseFolder("workspaceRoot")} type="button">
            Select
          </button>
        </div>
      </label>
      <label className="dialog-field dialog-field--section">
        <span className="dialog-field__label">Default terminal</span>
        <div className="settings-control-row">
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
  const statusCopy = indexSettingsStatusCopy(indexStatus, indexBusy);

  return (
    <>
      <div className="index-summary">
        <div className="index-summary__header">
          <span>
            Core search is always available. Advanced search adds lexical and semantic retrieval.
          </span>
        </div>
        <div className="index-summary__stats">
          <span>core always on</span>
          <span>{indexStatus?.mode ?? settings.indexMode}</span>
          <span>
            {indexStatus?.indexedRoots.length ?? settings.indexedRoots.length} root
            {(indexStatus?.indexedRoots.length ?? settings.indexedRoots.length) === 1 ? "" : "s"}
          </span>
          <span>{indexStatus?.documentCount ?? 0} docs</span>
          <span>{indexStatus?.pendingEmbeddings ?? 0} pending embeddings</span>
        </div>
      </div>
      {statusCopy ? (
        <div className={`onboarding-section__hint ${statusCopy.tone === "error" ? "dialog-card__status--error" : ""}`} data-testid="workspace-settings-index-status-note">
          {statusCopy.text}
        </div>
      ) : null}
      <label className="dialog-field dialog-field--section">
        <span className="dialog-field__label">Advanced search mode</span>
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
        <span>Search indexed notes when I press Enter in Explore.</span>
      </label>
      <label className="dialog-field dialog-field--section">
        <span className="dialog-field__label">Search updates</span>
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
      <details className="dialog-details dialog-details--section settings-maintenance">
        <summary>
          Search maintenance
          <HelpTooltip label="Use these controls when advanced search is stale or embeddings are incomplete." />
        </summary>
        {indexStatus?.recentJobs?.length ? (
          <div className="index-activity" data-testid="workspace-settings-index-activity">
            <div className="index-activity__title">Recent activity</div>
            {indexStatus.recentJobs.slice(0, 3).map((job) => (
              <div className="index-activity__row" key={job.id}>
                <span>{job.kind}</span>
                <span>{formatDuration(job.durationMs)}</span>
                <span>{formatRelativeTime(job.completedAt)}</span>
                <span>{job.status === "failed" ? "failed" : `${job.pendingEmbeddings ?? 0} pending`}</span>
              </div>
            ))}
          </div>
        ) : null}
        <div className="dialog-card__actions dialog-card__actions--split">
          <button
            className="toolbar-button"
            data-testid="workspace-settings-update-index"
            disabled={indexBusy !== null || !indexStatus?.enabled || indexStatus.indexedRoots.length === 0}
            onClick={() => void onRunIndexUpdate("updating")}
            type="button"
          >
            {indexBusy === "updating" ? "Refreshing..." : "Refresh documents"}
          </button>
          <button
            className="toolbar-button"
            data-testid="workspace-settings-embed-index"
            disabled={indexBusy !== null || !indexStatus?.enabled || indexStatus.mode === "lexical" || indexStatus.indexedRoots.length === 0}
            onClick={() => void onRunIndexUpdate("embedding")}
            type="button"
          >
            {indexBusy === "embedding" ? "Embedding..." : "Build embeddings"}
          </button>
        </div>
      </details>
    </>
  );
}

export function indexSettingsStatusCopy(
  indexStatus: IndexStatus | null,
  indexBusy: IndexBusyState,
): { text: string; tone: "info" | "warn" | "error" } | null {
  if (indexBusy === "syncing") {
    return { tone: "info", text: "Sync is refreshing documents and rebuilding embeddings. Status will refresh when it finishes." };
  }
  if (indexBusy === "updating") {
    return { tone: "info", text: "Refreshing notes in the advanced search index. Embedding status will update when it finishes." };
  }
  if (indexBusy === "embedding") {
    return { tone: "info", text: "Building semantic embeddings for indexed notes. Status will update when it finishes." };
  }
  if (!indexStatus) {
    return null;
  }
  if (indexStatus.errors.length > 0) {
    return { tone: "error", text: "Advanced search is unavailable. Core search still works." };
  }
  if (!indexStatus.enabled || indexStatus.mode === "off" || indexStatus.indexedRoots.length === 0) {
    return null;
  }
  if ((indexStatus.mode === "semantic" || indexStatus.mode === "hybrid") && indexStatus.pendingEmbeddings > 0) {
    const lastJob = indexStatus.recentJobs?.[0];
    const failedEmbeddingJob = lastJob && (lastJob.kind === "sync" || lastJob.kind === "embed") && (
      lastJob.status === "failed" ||
      lastJob.error ||
      lastJob.warnings?.some((warning) => warning.toLowerCase().includes("embedding failed"))
    );
    if (failedEmbeddingJob) {
      return {
        tone: "warn",
        text: "Documents were refreshed, but embeddings did not complete. Build embeddings can retry; lexical search remains available.",
      };
    }
    return {
      tone: "warn",
      text: "Embeddings are pending. Sync now refreshes documents and embeddings; Build embeddings retries incomplete semantic indexing.",
    };
  }
  return null;
}

function AppearanceSection({
  settings,
  setSettings,
}: Pick<WorkspaceSettingsDialogProps, "settings" | "setSettings">) {
  return (
    <div className="dialog-form__grid">
      <label className="dialog-field">
        <span className="dialog-field__label">Mode</span>
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
        <span className="dialog-field__label">Color theme</span>
        <select
          className="dialog-card__input"
          data-testid="workspace-settings-color-theme"
          value={settings.colorThemeId}
          onChange={(event) =>
            setSettings((current) =>
              current
                ? { ...current, colorThemeId: normalizeColorThemeId(event.target.value as ColorThemeId), saveStatus: "idle", errorMessage: null }
                : current,
            )
          }
        >
          {THEME_FAMILIES.map((theme) => (
            <option key={theme.id} value={theme.id}>
              {theme.label}
            </option>
          ))}
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
    <div className="dialog-form__grid dialog-form__grid--compact">
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
    </div>
  );
}

function AgentsSection({
  settings,
  setSettings,
}: Pick<WorkspaceSettingsDialogProps, "settings" | "setSettings">) {
  return (
    <div className="agent-command-list" data-testid="workspace-settings-agents">
      {settings.agentCommands.map((command) => (
        <AgentCommandSection command={command} key={command.id} setSettings={setSettings} />
      ))}
      <details className="agent-invocation-prompt-disclosure">
        <summary>Advanced</summary>
        <AgentInvocationPromptEditor
          onSave={(agentInvocationPrompt) => setSettings((current) => current ? {
            ...current,
            agentInvocationPrompt,
            saveStatus: "idle",
            errorMessage: null,
          } : current)}
          testId="workspace-settings-invocation-prompt"
          value={settings.agentInvocationPrompt}
        />
      </details>
    </div>
  );
}

function AgentCommandSection({
  command,
  setSettings,
}: { command: AgentCommand; setSettings: WorkspaceSettingsDialogProps["setSettings"] }) {
  const [hasContext, setHasContext] = useState(false);
  const [contextBusy, setContextBusy] = useState(false);
  const [contextError, setContextError] = useState<string | null>(null);
  useEffect(() => {
    let active = true;
    void window.exo.workspace.getAgentCommandContinuity(command.id)
      .then((status) => {
        if (!active) return;
        setHasContext(status.hasHead);
        setContextBusy(status.active);
      })
      .catch(() => undefined);
    return () => { active = false; };
  }, [command.id]);
  const updateCommand = (patch: Partial<AgentCommand>) => {
    setSettings((current) =>
      current
        ? {
            ...current,
            agentCommands: current.agentCommands.map((entry) => entry.id === command.id ? { ...entry, ...patch } : entry),
            saveStatus: "idle",
            errorMessage: null,
          }
        : current,
    );
  };
  const updateCwdPolicy = (cwdPolicy: AgentCommand["cwdPolicy"]) => {
    setSettings((current) =>
      current
        ? {
            ...current,
            agentCommands: current.agentCommands.map((entry) => entry.id === command.id
              ? { ...entry, cwdPolicy, fixedCwd: cwdPolicy === "fixed" ? entry.fixedCwd || current.workspaceRoot : undefined }
              : entry),
            saveStatus: "idle",
            errorMessage: null,
          }
        : current,
    );
  };

  return (
    <section className="agent-command">
      <div className="agent-command__header">
        <div>
          <strong>{command.label}</strong>
          <span>@{command.handle}</span>
        </div>
        <label className="dialog-check dialog-check--inline">
          <input
            checked={command.enabled}
            data-testid={`workspace-settings-agent-enabled-${command.id}`}
            onChange={(event) => updateCommand({ enabled: event.target.checked })}
            type="checkbox"
          />
          <span>Enabled</span>
        </label>
      </div>
      <div className="dialog-form__grid agent-command__fields">
        <div className="dialog-field agent-command__continuity">
          <span className="dialog-field__label">Context</span>
          {command.adapter === "claude-code" ? (
            <div className="agent-command__continuity-controls">
              <label className="dialog-check dialog-check--inline">
                <input
                  checked={command.continuityPolicy === "continuous"}
                  data-testid={`workspace-settings-agent-continuity-${command.id}`}
                  onChange={(event) => updateCommand({ continuityPolicy: event.target.checked ? "continuous" : "fresh" })}
                  type="checkbox"
                />
                <span>Keep context</span>
              </label>
              {hasContext ? (
                <button
                  className="toolbar-button"
                  disabled={contextBusy}
                  onClick={() => {
                    setContextBusy(true);
                    setContextError(null);
                    void window.exo.workspace.resetAgentCommandContinuity(command.id)
                      .then(() => setHasContext(false))
                      .catch((error) => setContextError(error instanceof Error ? error.message : String(error)))
                      .finally(() => setContextBusy(false));
                  }}
                  type="button"
                >
                  Reset
                </button>
              ) : null}
              {contextError ? <span className="dialog-field__error">{contextError}</span> : null}
            </div>
          ) : <span className="dialog-field__hint">Unavailable</span>}
        </div>
        <label className="dialog-field">
          <span className="dialog-field__label">Name</span>
          <input
            className="dialog-card__input"
            data-testid={`workspace-settings-agent-label-${command.id}`}
            value={command.label}
            onChange={(event) => updateCommand({ label: event.target.value })}
          />
        </label>
        <label className="dialog-field">
          <span className="dialog-field__label">Run from</span>
          <select
            className="dialog-card__input"
            data-testid={`workspace-settings-agent-cwd-${command.id}`}
            value={command.cwdPolicy}
            onChange={(event) => updateCwdPolicy(event.target.value as AgentCommand["cwdPolicy"])}
          >
            <option value="workspace_root">Workspace</option>
            <option value="note_dir">Note folder</option>
            <option value="fixed">Fixed folder</option>
          </select>
        </label>
        <label className="dialog-field agent-command__command">
          <span className="dialog-field__label">Command</span>
          <input
            className="dialog-card__input"
            data-testid={`workspace-settings-agent-command-${command.id}`}
            spellCheck={false}
            value={command.command}
            onChange={(event) => updateCommand({ command: event.target.value })}
          />
        </label>
        {command.cwdPolicy === "fixed" ? (
          <label className="dialog-field agent-command__command">
            <span className="dialog-field__label">Folder</span>
            <input
              className="dialog-card__input"
              data-testid={`workspace-settings-agent-fixed-cwd-${command.id}`}
              value={command.fixedCwd ?? ""}
              onChange={(event) => updateCommand({ fixedCwd: event.target.value })}
            />
          </label>
        ) : null}
      </div>
    </section>
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
