import { useCallback, useEffect, useRef, useState, type Dispatch, type MutableRefObject, type SetStateAction } from "react";
import type {
  IndexStatus,
  WorkspaceSettings,
  WorkspaceSettingsRevision,
} from "@exo/core";
import type { IndexSyncStateEvent } from "../../../shared/api";
import { createDefaultClaudeAgentCommand } from "@exo/core/default-agent-command";
import { DEFAULT_AGENT_INVOCATION_PROMPT } from "@exo/core/agent-invocation-prompt";
import type { AppearanceMode } from "../appearance";
import { normalizeColorThemeId } from "../theme/registry";
import {
  clampNumber,
  workspaceSettingsImmediateDraftKey,
  workspaceSettingsStructuralDraftFromSettings,
  workspaceSettingsStructuralDraftKey,
  workspaceSettingsStructuralKeyFromSettings,
} from "../workspaceSettingsModel";
import type {
  IndexBusyState,
  WorkspaceSettingsDialogState,
  WorkspaceSettingsSection,
} from "../workspaceSettingsDialogTypes";

interface UseWorkspaceSettingsControllerOptions {
  workspaceSettingsRef: MutableRefObject<WorkspaceSettings | null>;
  workspaceSettingsRevisionRef: MutableRefObject<WorkspaceSettingsRevision>;
  applyWorkspaceSettings: (settings: WorkspaceSettings) => void;
  refreshWorkspaceModel: () => Promise<void>;
  setIndexStatus: Dispatch<SetStateAction<IndexStatus | null>>;
  onSettingsSaved?: () => void | Promise<void>;
}

export function useWorkspaceSettingsController(options: UseWorkspaceSettingsControllerOptions) {
  const [dialog, setDialog] = useState<WorkspaceSettingsDialogState | null>(null);
  const [indexBusy, setIndexBusy] = useState<IndexBusyState>(null);
  const optionsRef = useRef(options);
  const settingsSaveTailRef = useRef<Promise<void>>(Promise.resolve());
  const dialogSessionIdRef = useRef(0);
  const enqueueSettingsSave = useCallback((
    buildSettings: (baseSettings: WorkspaceSettings) => WorkspaceSettings,
  ) => {
    // Every renderer-originated Settings write shares this stream. The next
    // request reads the revision synchronously published by its predecessor.
    const result = settingsSaveTailRef.current.then(async () => {
      const baseSnapshot = optionsRef.current.workspaceSettingsRef.current
        ? {
            settings: optionsRef.current.workspaceSettingsRef.current,
            revision: optionsRef.current.workspaceSettingsRevisionRef.current,
          }
        : await window.exo.workspace.getSettings();
      const nextSettings: WorkspaceSettings = {
        ...buildSettings(baseSnapshot.settings),
      };
      const saved = await window.exo.workspace.saveSettings({
        settings: nextSettings,
        expectedRevision: baseSnapshot.revision,
      });
      optionsRef.current.workspaceSettingsRef.current = saved.settings;
      optionsRef.current.workspaceSettingsRevisionRef.current = saved.revision;
      return saved;
    });
    settingsSaveTailRef.current = result.then(() => undefined, () => undefined);
    return result;
  }, []);
  const saveSettingsPatch = useCallback((patch: Partial<WorkspaceSettings>): Promise<void> =>
    enqueueSettingsSave((baseSettings) => ({
      ...baseSettings,
      ...patch,
    })).then((saved) => {
      if (saved.runtimeApply.status === "failed") {
        throw new Error(saved.runtimeApply.errorMessage);
      }
      void optionsRef.current.onSettingsSaved?.();
    }), [enqueueSettingsSave]);

  useEffect(() => {
    optionsRef.current = options;
  }, [options]);

  useEffect(() => {
    return window.exo.workspace.onIndexSyncState((event) => {
      if (event.state === "running") {
        setIndexBusy((current) => indexBusyStateForEvent(event, current));
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

  async function openDialog(section: WorkspaceSettingsSection = "workspace") {
    const dialogSessionId = dialogSessionIdRef.current + 1;
    dialogSessionIdRef.current = dialogSessionId;
    await settingsSaveTailRef.current;
    if (dialogSessionIdRef.current !== dialogSessionId) {
      return;
    }
    const snapshot = await window.exo.workspace.getSettings();
    if (dialogSessionIdRef.current !== dialogSessionId) {
      return;
    }
    const settings = snapshot.settings;
    optionsRef.current.workspaceSettingsRef.current = settings;
    optionsRef.current.workspaceSettingsRevisionRef.current = snapshot.revision;
    const appliedWorkspaceKey = workspaceSettingsStructuralKeyFromSettings(settings);
    const structuralDraft = workspaceSettingsStructuralDraftFromSettings(settings);
    setDialog({
      section,
      settingsRevision: snapshot.revision,
      ...structuralDraft,
      appearanceMode: settings.appearanceMode as AppearanceMode,
      colorThemeId: normalizeColorThemeId(settings.colorThemeId),
      editorFontSize: String(settings.editorFontSize),
      terminalFontSize: String(settings.terminalFontSize),
      explorerScale: String(settings.explorerScale),
      exploreIndexSearchOnEnter: settings.exploreIndexSearchOnEnter,
      indexUpdateStrategy: settings.indexUpdateStrategy,
      agentCommands: settings.agentCommands?.length ? settings.agentCommands : [createDefaultClaudeAgentCommand()],
      agentInvocationPrompt: settings.agentInvocationPrompt ?? DEFAULT_AGENT_INVOCATION_PROMPT,
      saveStatus: "saved",
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
    dialogSessionIdRef.current += 1;
    setDialog(null);
  }

  async function chooseFolder(target: "workspaceRoot" | "defaultTerminalCwd" | "noteRoot") {
    const folders = await window.exo.workspace.selectFolder({
      title:
        target === "noteRoot"
          ? "Choose notes folder"
          : "Choose folder",
      buttonLabel: "Use Folder",
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

    const dialogSessionId = dialogSessionIdRef.current;
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
      const saved = await enqueueSettingsSave((baseSettings) =>
        workspaceSettingsFromDialog(settingsDialog, saveOptions, baseSettings));
      optionsRef.current.applyWorkspaceSettings(saved.settings);
      if (saved.runtimeApply.status === "failed") {
        const runtimeApplyErrorMessage = saved.runtimeApply.errorMessage;
        setDialog((current) => {
          if (!current || dialogSessionIdRef.current !== dialogSessionId) {
            return current;
          }
          const savedDraftIsCurrent = (
            saveOptions.includeStructural
              ? workspaceSettingsStructuralDraftKey(current)
              : workspaceSettingsImmediateDraftKey(current)
          ) === snapshotKey;
          return {
            ...current,
            settingsRevision: saved.revision,
            ...(savedDraftIsCurrent
              ? saveOptions.includeStructural
                ? {
                    applyStatus: "error" as const,
                    applyErrorMessage: runtimeApplyErrorMessage,
                  }
                : {
                    saveStatus: "error" as const,
                    errorMessage: runtimeApplyErrorMessage,
                  }
              : {}),
          };
        });
        return;
      }
      void optionsRef.current.onSettingsSaved?.();
      setDialog((current) => {
        if (!current || dialogSessionIdRef.current !== dialogSessionId) {
          return current;
        }
        const savedDraftIsCurrent = (
          saveOptions.includeStructural
            ? workspaceSettingsStructuralDraftKey(current)
            : workspaceSettingsImmediateDraftKey(current)
        ) === snapshotKey;
        return {
          ...current,
          settingsRevision: saved.revision,
          ...(savedDraftIsCurrent
            ? saveOptions.includeStructural
              ? {
                  ...workspaceSettingsStructuralDraftFromSettings(saved.settings),
                  appliedWorkspaceKey: workspaceSettingsStructuralKeyFromSettings(saved.settings),
                  applyStatus: "applied" as const,
                  applyErrorMessage: null,
                }
              : {
                  saveStatus: "saved" as const,
                  errorMessage: null,
                }
            : {}),
        };
      });
      if (saveOptions.includeStructural) {
        void optionsRef.current.refreshWorkspaceModel();
        void window.exo.workspace.getIndexStatus().then(optionsRef.current.setIndexStatus).catch((error) => {
          console.warn("[exo] failed to refresh search status", error);
        });
      }
    } catch (error) {
      setDialog((current) =>
        current
        && dialogSessionIdRef.current === dialogSessionId
        && (saveOptions.includeStructural ? workspaceSettingsStructuralDraftKey(current) : workspaceSettingsImmediateDraftKey(current)) === snapshotKey
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

export function indexBusyStateForEvent(
  event: Pick<IndexSyncStateEvent, "state" | "reason">,
  current: IndexBusyState = null,
): IndexBusyState {
  if (event.state !== "running") {
    return null;
  }
  const reason = event.reason.toLowerCase();
  if (reason.includes("embed") || reason.includes("embedding") || reason.includes("catch-up")) {
    return "embedding";
  }
  if (reason.includes("update") || reason.includes("refresh") || reason.includes("note-save")) {
    return "updating";
  }
  return current ?? "syncing";
}

export function workspaceSettingsFromDialog(
  settingsDialog: WorkspaceSettingsDialogState,
  options: { includeStructural: boolean },
  currentSettings: WorkspaceSettings | null,
): WorkspaceSettings {
  if (!currentSettings) {
    throw new Error("Workspace settings are unavailable. Close Settings and try again.");
  }

  const structuralSettings = {
    workspaceRoot: settingsDialog.workspaceRoot.trim(),
    defaultTerminalCwd: settingsDialog.defaultTerminalCwd.trim(),
    noteRoots: settingsDialog.noteRoots
      .map((entry) => entry.trim())
      .filter(Boolean),
    indexedRoots: settingsDialog.indexedRoots
      .filter((root) => Boolean(root.path.trim()))
      .map((root) => ({ ...root, path: root.path.trim(), ignore: [...root.ignore] })),
    indexing: {
      enabled: settingsDialog.indexMode !== "off",
      mode: settingsDialog.indexMode,
      backend: "qmd" as const,
    },
    searchEngine: settingsDialog.searchEngine,
  };
  return {
    ...currentSettings,
    workspaceRoot: options.includeStructural ? structuralSettings.workspaceRoot : currentSettings.workspaceRoot,
    defaultTerminalCwd: options.includeStructural ? structuralSettings.defaultTerminalCwd : currentSettings.defaultTerminalCwd,
    noteRoots: options.includeStructural
      ? structuralSettings.noteRoots
      : currentSettings.noteRoots,
    indexedRoots: options.includeStructural
      ? structuralSettings.indexedRoots
      : currentSettings.indexedRoots,
    indexing: options.includeStructural
      ? structuralSettings.indexing
      : currentSettings.indexing,
    searchEngine: options.includeStructural
      ? structuralSettings.searchEngine
      : currentSettings.searchEngine,
    appearanceMode: settingsDialog.appearanceMode,
    colorThemeId: normalizeColorThemeId(settingsDialog.colorThemeId),
    editorFontSize: clampNumber(Number(settingsDialog.editorFontSize), 11, 24),
    terminalFontSize: clampNumber(Number(settingsDialog.terminalFontSize), 10, 22),
    explorerScale: clampNumber(Number(settingsDialog.explorerScale), 0.82, 1.35),
    exploreIndexSearchOnEnter: settingsDialog.exploreIndexSearchOnEnter,
    indexUpdateStrategy: settingsDialog.indexUpdateStrategy,
    agentCommands: settingsDialog.agentCommands,
    agentInvocationPrompt: settingsDialog.agentInvocationPrompt,
  };
}
