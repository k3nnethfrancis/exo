import type { Dispatch, SetStateAction } from "react";
import { FolderOpen, Palette, Search, TerminalSquare, X } from "lucide-react";
import type { IndexStatus, WorkspaceSettings } from "@exo/core";

import type { AppearanceMode } from "../appearance";
import { THEME_FAMILIES, normalizeColorThemeId } from "../theme/registry";
import type { ColorThemeId } from "../theme/types";
import type { IndexBusyState, WorkspaceSettingsDialogState, WorkspaceSettingsSection } from "../workspaceSettingsDialogTypes";
import { HelpTooltip } from "./HelpTooltip";
import { PathList } from "./PathList";

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
  { id: "index", label: "Search", description: "Core + QMD provider", icon: Search },
  { id: "appearance", label: "Appearance", description: "Theme and editor", icon: Palette },
  { id: "terminal", label: "Terminal", description: "Runtime defaults", icon: TerminalSquare },
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
        <div className="dialog-card__message">{workspaceSettingsDialogIntroCopy(settings.section, hasStructuralChanges)}</div>
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
  return hasStructuralChanges ? "Draft saved. Press Apply for workspace path or search provider changes." : "Settings saved.";
}

export function workspaceSettingsDialogIntroCopy(section: WorkspaceSettingsSection, hasStructuralChanges: boolean): string {
  if (hasStructuralChanges) {
    return section === "index"
      ? "Advanced search provider changes are saved as a draft. Press Apply to make them active."
      : "Workspace path or search provider changes are saved as a draft. Press Apply to make them active.";
  }

  if (section === "index") {
    return "Core search is always on. QMD provider update preferences save immediately.";
  }

  if (section === "workspace") {
    return "Workspace folder edits are saved as a draft before they become active.";
  }

  return "Settings in this section save immediately.";
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
            Core search +{" "}
            <button className="link-button link-button--inline" onClick={() => void window.exo.shell.openExternal("https://github.com/tobi/qmd")} type="button">
              QMD
            </button>{" "}
            advanced provider
          </span>
        </div>
        <div className="index-summary__stats">
          <span>core always on</span>
          <span>official provider</span>
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
      {indexStatus?.recentJobs?.length ? (
        <div className="index-activity" data-testid="workspace-settings-index-activity">
          <div className="index-activity__title">Recent QMD activity</div>
          {indexStatus.recentJobs.slice(0, 5).map((job) => (
            <div className="index-activity__row" key={job.id}>
              <span>{job.kind}</span>
              <span>{job.reason}</span>
              <span>{formatDuration(job.durationMs)}</span>
              <span>{formatRelativeTime(job.completedAt)}</span>
              <span>{job.status === "failed" ? "failed" : `${job.pendingEmbeddings ?? 0} pending embeddings`}</span>
            </div>
          ))}
        </div>
      ) : null}
      <label className="dialog-field dialog-field--section">
        <span className="dialog-field__label">QMD provider mode</span>
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
        <span>Use QMD lexical provider search on Enter in Explore.</span>
      </label>
      <label className="dialog-field dialog-field--section">
        <span className="dialog-field__label">QMD updates</span>
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
          <HelpTooltip label="Refresh documents only re-reads Markdown into the QMD lexical store without building embeddings. Build embeddings only creates missing semantic embeddings for documents already in QMD. Use these when advanced search looks stale, status says embeddings are needed, or you want to debug one QMD phase without running a full sync." />
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

export function indexSettingsStatusCopy(
  indexStatus: IndexStatus | null,
  indexBusy: IndexBusyState,
): { text: string; tone: "info" | "warn" | "error" } | null {
  if (indexBusy === "syncing") {
    return { tone: "info", text: "Sync is refreshing documents and rebuilding embeddings. Status will refresh when it finishes." };
  }
  if (indexBusy === "updating") {
    return { tone: "info", text: "Refresh documents only is re-reading Markdown into QMD. Embedding status will refresh when it finishes." };
  }
  if (indexBusy === "embedding") {
    return { tone: "info", text: "Build embeddings only is creating semantic embeddings for documents already in QMD. Status will refresh when it finishes." };
  }
  if (!indexStatus) {
    return null;
  }
  if (indexStatus.errors.length > 0) {
    return { tone: "error", text: `QMD status error: ${indexStatus.errors.join(" ")}` };
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
      const detail = lastJob.error ?? lastJob.warnings?.find((warning) => warning.toLowerCase().includes("embedding failed"));
      return {
        tone: "warn",
        text: `Documents were refreshed, but embeddings did not complete${detail ? `: ${detail}` : ""}. Build embeddings only can retry semantic embeddings; lexical search remains available.`,
      };
    }
    return {
      tone: "warn",
      text: "Embeddings are pending. Sync now refreshes documents and embeddings; Build embeddings only retries embeddings for documents already in QMD.",
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
          <HelpTooltip label="Maximum terminal transcript characters an agent-facing Exo surface can request. Set higher when debugging long sessions." />
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
          <HelpTooltip label="How long Exo may batch rapid raw terminal input before writing it to the terminal process. Lower values favor immediate keystrokes." />
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
