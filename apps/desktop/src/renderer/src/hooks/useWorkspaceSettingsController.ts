import { useEffect, useRef, useState, type Dispatch, type MutableRefObject, type SetStateAction } from "react";
import {
  type IndexStatus,
  type WorkspaceSettings,
} from "@exo/core";
import {
  DEFAULT_TERMINAL_AGENT_STARTUP_GRACE_MS,
  DEFAULT_TERMINAL_AGENT_SUBMIT_DELAY_MS,
  DEFAULT_TERMINAL_IDLE_THRESHOLD_MS,
  DEFAULT_TERMINAL_INITIAL_COLUMNS,
  DEFAULT_TERMINAL_INITIAL_ROWS,
  DEFAULT_TERMINAL_INPUT_COALESCE_MS,
  DEFAULT_TERMINAL_MAX_READ_TAIL_CHARS,
  DEFAULT_TERMINAL_MINIMUM_COLUMNS,
  DEFAULT_TERMINAL_MINIMUM_ROWS,
  DEFAULT_TERMINAL_READ_TAIL_CHARS,
  DEFAULT_TERMINAL_UNRESPONSIVE_THRESHOLD_MS,
} from "@exo/core/terminal-settings";

import type { AppearanceMode } from "../appearance";
import { normalizeColorThemeId } from "../theme/registry";
import {
  clampNumber,
  MIN_TERMINAL_HISTORY_LINES,
  workspaceSettingsImmediateDraftKey,
  workspaceSettingsStructuralDraftKey,
  workspaceSettingsStructuralKeyFromSettings,
} from "../workspaceSettingsModel";
import type {
  IndexBusyState,
  WorkspaceSettingsDialogState,
  WorkspaceSettingsSection,
} from "../workspaceSettingsDialogTypes";
import { pathLabel, uniquePaths } from "../workspaceTree";

interface UseWorkspaceSettingsControllerOptions {
  workspaceSettingsRef: MutableRefObject<WorkspaceSettings | null>;
  applyWorkspaceSettings: (settings: WorkspaceSettings) => void;
  refreshWorkspaceModel: () => Promise<void>;
  setIndexStatus: Dispatch<SetStateAction<IndexStatus | null>>;
}

export function useWorkspaceSettingsController(options: UseWorkspaceSettingsControllerOptions) {
  const [dialog, setDialog] = useState<WorkspaceSettingsDialogState | null>(null);
  const [indexBusy, setIndexBusy] = useState<IndexBusyState>(null);
  const optionsRef = useRef(options);

  useEffect(() => {
    optionsRef.current = options;
  }, [options]);

  useEffect(() => {
    return window.exo.workspace.onIndexSyncState((event) => {
      if (event.state === "running") {
        setIndexBusy("syncing");
        return;
      }
      setIndexBusy(null);
      if (event.result?.status) {
        optionsRef.current.setIndexStatus(event.result.status);
      }
      if (event.state === "error") {
        setDialog((current) =>
          current
            ? {
                ...current,
                applyStatus: "error",
                applyErrorMessage: event.error ?? "Index sync failed.",
              }
            : current,
        );
      }
    });
  }, []);

  useEffect(() => {
    if (!dialog || dialog.saveStatus !== "idle") {
      return;
    }

    const snapshot = dialog;
    const timeout = window.setTimeout(() => {
      void saveDialog(snapshot);
    }, 650);

    return () => window.clearTimeout(timeout);
  }, [dialog]);

  async function saveSettingsPatch(patch: Partial<WorkspaceSettings>) {
    const base = optionsRef.current.workspaceSettingsRef.current ?? await window.exo.workspace.getSettings();
    const nextSettings: WorkspaceSettings = {
      ...base,
      ...patch,
    };
    optionsRef.current.workspaceSettingsRef.current = nextSettings;
    const saved = await window.exo.workspace.saveSettings(nextSettings);
    optionsRef.current.workspaceSettingsRef.current = saved;
  }

  async function openDialog(section: WorkspaceSettingsSection = "workspace") {
    const settings = await window.exo.workspace.getSettings();
    const appliedWorkspaceKey = workspaceSettingsStructuralKeyFromSettings(settings);
    setDialog({
      section,
      workspaceRoot: settings.workspaceRoot,
      defaultTerminalCwd: settings.defaultTerminalCwd,
      noteRoots: settings.noteRoots,
      projectRoots: settings.projectRoots,
      indexedRoots: settings.indexedRoots.map((root) => root.path),
      indexMode: settings.indexing.mode,
      appearanceMode: settings.appearanceMode as AppearanceMode,
      colorThemeId: normalizeColorThemeId(settings.colorThemeId),
      editorFontSize: String(settings.editorFontSize),
      terminalFontSize: String(settings.terminalFontSize),
      terminalHistoryMode: settings.terminalHistoryMode,
      terminalHistoryLines: String(settings.terminalHistoryLines),
      terminalTranscriptRetention: settings.terminalTranscriptRetention,
      terminalTranscriptRetentionDays: String(settings.terminalTranscriptRetentionDays),
      terminalInputCoalesceMs: String(settings.terminalInputCoalesceMs ?? DEFAULT_TERMINAL_INPUT_COALESCE_MS),
      terminalAgentStartupGraceMs: String(settings.terminalAgentStartupGraceMs ?? DEFAULT_TERMINAL_AGENT_STARTUP_GRACE_MS),
      terminalAgentSubmitDelayMs: String(settings.terminalAgentSubmitDelayMs ?? DEFAULT_TERMINAL_AGENT_SUBMIT_DELAY_MS),
      terminalInitialColumns: String(settings.terminalInitialColumns ?? DEFAULT_TERMINAL_INITIAL_COLUMNS),
      terminalInitialRows: String(settings.terminalInitialRows ?? DEFAULT_TERMINAL_INITIAL_ROWS),
      terminalMinimumColumns: String(settings.terminalMinimumColumns ?? DEFAULT_TERMINAL_MINIMUM_COLUMNS),
      terminalMinimumRows: String(settings.terminalMinimumRows ?? DEFAULT_TERMINAL_MINIMUM_ROWS),
      terminalReadTailChars: String(settings.terminalReadTailChars ?? DEFAULT_TERMINAL_READ_TAIL_CHARS),
      terminalMaxReadTailChars: String(settings.terminalMaxReadTailChars ?? DEFAULT_TERMINAL_MAX_READ_TAIL_CHARS),
      terminalUnresponsiveThresholdMs: String(settings.terminalUnresponsiveThresholdMs ?? DEFAULT_TERMINAL_UNRESPONSIVE_THRESHOLD_MS),
      terminalIdleThresholdMs: String(settings.terminalIdleThresholdMs ?? DEFAULT_TERMINAL_IDLE_THRESHOLD_MS),
      explorerScale: String(settings.explorerScale),
      exploreIndexSearchOnEnter: settings.exploreIndexSearchOnEnter,
      indexUpdateStrategy: settings.indexUpdateStrategy,
      saveStatus: "idle",
      errorMessage: null,
      appliedWorkspaceKey,
      applyStatus: "idle",
      applyErrorMessage: null,
    });
    void window.exo.workspace.getIndexStatus().then(optionsRef.current.setIndexStatus).catch((error) => {
      console.warn("[exo] failed to load index status", error);
      optionsRef.current.setIndexStatus(null);
    });
  }

  function closeDialog() {
    const snapshot = dialog;
    if (snapshot && snapshot.saveStatus !== "saved" && snapshot.saveStatus !== "saving") {
      void saveDialog(snapshot, { includeStructural: false });
    }
    setDialog(null);
  }

  async function chooseFolder(target: "workspaceRoot" | "defaultTerminalCwd" | "noteRoot" | "projectRoot") {
    const folders = await window.exo.workspace.selectFolder({
      title:
        target === "noteRoot"
          ? "Choose notes folder"
          : target === "projectRoot"
            ? "Add project folder"
            : "Choose folder",
      buttonLabel: target === "projectRoot" ? "Add Folder" : "Use Folder",
      allowMultiple: target === "projectRoot",
    });
    if (folders.length === 0) {
      return;
    }
    setDialog((current) => {
      if (!current) {
        return current;
      }
      if (target === "workspaceRoot") {
        return { ...current, workspaceRoot: folders[0], applyStatus: "idle", applyErrorMessage: null };
      }
      if (target === "defaultTerminalCwd") {
        return { ...current, defaultTerminalCwd: folders[0], applyStatus: "idle", applyErrorMessage: null };
      }
      if (target === "noteRoot") {
        return { ...current, noteRoots: [folders[0]], applyStatus: "idle", applyErrorMessage: null };
      }
      if (target === "projectRoot") {
        return { ...current, projectRoots: uniquePaths([...current.projectRoots, ...folders]), applyStatus: "idle", applyErrorMessage: null };
      }
      return current;
    });
  }

  async function runIndexUpdate(action: Exclude<IndexBusyState, null>) {
    setIndexBusy(action);
    setDialog((current) =>
      current
        ? {
            ...current,
            applyStatus: "idle",
            applyErrorMessage: null,
          }
        : current,
    );

    try {
      const status = action === "syncing"
        ? (await window.exo.workspace.syncIndex()).status
        : action === "embedding"
          ? await window.exo.workspace.embedIndex()
          : await window.exo.workspace.updateIndex();
      optionsRef.current.setIndexStatus(status);
    } catch (error) {
      setDialog((current) =>
        current
          ? {
              ...current,
              applyStatus: "error",
              applyErrorMessage: error instanceof Error ? error.message : "Unable to update the index.",
            }
          : current,
      );
    } finally {
      setIndexBusy(null);
    }
  }

  async function saveDialog(settingsDialog = dialog, saveOptions = { includeStructural: false }) {
    if (!settingsDialog) {
      return;
    }

    const nextSettings = workspaceSettingsFromDialog(
      settingsDialog,
      saveOptions,
      optionsRef.current.workspaceSettingsRef.current,
    );
    const snapshotKey = saveOptions.includeStructural
      ? workspaceSettingsStructuralDraftKey(settingsDialog)
      : workspaceSettingsImmediateDraftKey(settingsDialog);

    setDialog((current) =>
      current && (saveOptions.includeStructural ? workspaceSettingsStructuralDraftKey(current) : workspaceSettingsImmediateDraftKey(current)) === snapshotKey
        ? {
            ...current,
            ...(saveOptions.includeStructural
              ? { applyStatus: "applying" as const, applyErrorMessage: null }
              : { saveStatus: "saving" as const, errorMessage: null }),
          }
        : current,
    );

    try {
      const saved = await window.exo.workspace.saveSettings(nextSettings);
      optionsRef.current.workspaceSettingsRef.current = saved;
      optionsRef.current.applyWorkspaceSettings(saved);
      setDialog((current) =>
        current && (saveOptions.includeStructural ? workspaceSettingsStructuralDraftKey(current) : workspaceSettingsImmediateDraftKey(current)) === snapshotKey
          ? {
              ...current,
              ...(saveOptions.includeStructural
                ? {
                    appliedWorkspaceKey: workspaceSettingsStructuralKeyFromSettings(saved),
                    applyStatus: "applied" as const,
                    applyErrorMessage: null,
                  }
                : {
                    saveStatus: "saved" as const,
                    errorMessage: null,
                  }),
          }
          : current,
      );
      if (saveOptions.includeStructural) {
        void optionsRef.current.refreshWorkspaceModel();
      }
    } catch (error) {
      setDialog((current) =>
        current && (saveOptions.includeStructural ? workspaceSettingsStructuralDraftKey(current) : workspaceSettingsImmediateDraftKey(current)) === snapshotKey
          ? {
              ...current,
              ...(saveOptions.includeStructural
                ? {
                    applyStatus: "error" as const,
                    applyErrorMessage: error instanceof Error ? error.message : "Unable to apply workspace settings.",
                  }
                : {
                    saveStatus: "error" as const,
                    errorMessage: error instanceof Error ? error.message : "Unable to save workspace settings.",
                  }),
            }
          : current,
      );
    }
  }

  return {
    dialog,
    setDialog,
    indexBusy,
    saveSettingsPatch,
    openDialog,
    closeDialog,
    chooseFolder,
    runIndexUpdate,
    saveDialog,
  };
}

function workspaceSettingsFromDialog(
  settingsDialog: WorkspaceSettingsDialogState,
  options: { includeStructural: boolean },
  currentSettings: WorkspaceSettings | null,
): WorkspaceSettings {
  const fallbackStructural = {
    workspaceRoot: settingsDialog.workspaceRoot.trim(),
    defaultTerminalCwd: settingsDialog.defaultTerminalCwd.trim(),
    noteRoots: settingsDialog.noteRoots
      .map((entry) => entry.trim())
      .filter(Boolean),
    projectRoots: settingsDialog.projectRoots
      .map((entry) => entry.trim())
      .filter(Boolean),
    indexedRoots: settingsDialog.indexedRoots
      .map((entry, index) => ({ entry, index }))
      .filter(({ entry }) => entry.trim())
      .map(({ entry, index }) => ({
        id: `index-root-${index + 1}`,
        label: pathLabel(entry.trim()),
        path: entry.trim(),
        kind: "mixed" as const,
        pattern: "**/*.md",
        ignore: [],
        backend: "qmd" as const,
      })),
    indexing: {
      enabled: settingsDialog.indexMode !== "off",
      mode: settingsDialog.indexMode,
      backend: "qmd" as const,
    },
  };
  const parsedTerminalHistoryLines = Math.floor(Number(settingsDialog.terminalHistoryLines));
  const terminalHistoryLines = Number.isFinite(parsedTerminalHistoryLines)
    ? Math.max(MIN_TERMINAL_HISTORY_LINES, parsedTerminalHistoryLines)
    : MIN_TERMINAL_HISTORY_LINES;
  const terminalReadTailChars = integerAtLeast(Number(settingsDialog.terminalReadTailChars), DEFAULT_TERMINAL_READ_TAIL_CHARS, 0);
  const terminalMaxReadTailChars = Math.max(
    terminalReadTailChars,
    integerAtLeast(Number(settingsDialog.terminalMaxReadTailChars), DEFAULT_TERMINAL_MAX_READ_TAIL_CHARS, 0),
  );

  return {
    workspaceRoot: options.includeStructural ? fallbackStructural.workspaceRoot : currentSettings?.workspaceRoot ?? fallbackStructural.workspaceRoot,
    defaultTerminalCwd: options.includeStructural ? fallbackStructural.defaultTerminalCwd : currentSettings?.defaultTerminalCwd ?? fallbackStructural.defaultTerminalCwd,
    noteRoots: options.includeStructural
      ? fallbackStructural.noteRoots
      : currentSettings?.noteRoots ?? fallbackStructural.noteRoots,
    projectRoots: options.includeStructural
      ? fallbackStructural.projectRoots
      : currentSettings?.projectRoots ?? fallbackStructural.projectRoots,
    indexedRoots: options.includeStructural
      ? fallbackStructural.indexedRoots
      : currentSettings?.indexedRoots ?? fallbackStructural.indexedRoots,
    indexing: options.includeStructural
      ? fallbackStructural.indexing
      : currentSettings?.indexing ?? fallbackStructural.indexing,
    appearanceMode: settingsDialog.appearanceMode,
    colorThemeId: normalizeColorThemeId(settingsDialog.colorThemeId),
    editorFontSize: clampNumber(Number(settingsDialog.editorFontSize), 11, 24),
    terminalFontSize: clampNumber(Number(settingsDialog.terminalFontSize), 10, 22),
    terminalHistoryMode: "custom",
    terminalHistoryLines,
    terminalTranscriptRetention: settingsDialog.terminalTranscriptRetention,
    terminalTranscriptRetentionDays: clampNumber(Number(settingsDialog.terminalTranscriptRetentionDays), 1, 3650),
    terminalInputCoalesceMs: integerAtLeast(Number(settingsDialog.terminalInputCoalesceMs), DEFAULT_TERMINAL_INPUT_COALESCE_MS, 0),
    terminalAgentStartupGraceMs: integerAtLeast(Number(settingsDialog.terminalAgentStartupGraceMs), DEFAULT_TERMINAL_AGENT_STARTUP_GRACE_MS, 0),
    terminalAgentSubmitDelayMs: integerAtLeast(Number(settingsDialog.terminalAgentSubmitDelayMs), DEFAULT_TERMINAL_AGENT_SUBMIT_DELAY_MS, 0),
    terminalInitialColumns: integerAtLeast(Number(settingsDialog.terminalInitialColumns), DEFAULT_TERMINAL_INITIAL_COLUMNS, 20),
    terminalInitialRows: integerAtLeast(Number(settingsDialog.terminalInitialRows), DEFAULT_TERMINAL_INITIAL_ROWS, 8),
    terminalMinimumColumns: integerAtLeast(Number(settingsDialog.terminalMinimumColumns), DEFAULT_TERMINAL_MINIMUM_COLUMNS, 1),
    terminalMinimumRows: integerAtLeast(Number(settingsDialog.terminalMinimumRows), DEFAULT_TERMINAL_MINIMUM_ROWS, 1),
    terminalReadTailChars,
    terminalMaxReadTailChars,
    terminalUnresponsiveThresholdMs: integerAtLeast(Number(settingsDialog.terminalUnresponsiveThresholdMs), DEFAULT_TERMINAL_UNRESPONSIVE_THRESHOLD_MS, 1_000),
    terminalIdleThresholdMs: integerAtLeast(Number(settingsDialog.terminalIdleThresholdMs), DEFAULT_TERMINAL_IDLE_THRESHOLD_MS, 1_000),
    explorerScale: clampNumber(Number(settingsDialog.explorerScale), 0.82, 1.35),
    exploreIndexSearchOnEnter: settingsDialog.exploreIndexSearchOnEnter,
    indexUpdateStrategy: settingsDialog.indexUpdateStrategy,
  };
}

function integerAtLeast(value: number, fallback: number, min: number): number {
  return Number.isFinite(value) ? Math.max(min, Math.floor(value)) : fallback;
}
