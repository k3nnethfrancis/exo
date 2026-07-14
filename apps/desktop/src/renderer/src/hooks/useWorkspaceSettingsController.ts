import { useEffect, useRef, useState, type Dispatch, type MutableRefObject, type SetStateAction } from "react";
import type {
  IndexStatus,
  WorkspaceSettings,
  WorkspaceSettingsRevision,
} from "@exo/core";
import { createDefaultClaudeAgentCommand } from "@exo/core/default-agent-command";
import { DEFAULT_AGENT_INVOCATION_PROMPT } from "@exo/core/agent-invocation-prompt";
import type { AppearanceMode } from "../appearance";
import { normalizeColorThemeId } from "../theme/registry";
import {
  clampNumber,
  workspaceSettingsImmediateDraftKey,
  workspaceSettingsStructuralDraftKey,
  workspaceSettingsStructuralKeyFromSettings,
} from "../workspaceSettingsModel";
import type {
  IndexBusyState,
  WorkspaceSettingsDialogState,
  WorkspaceSettingsSection,
} from "../workspaceSettingsDialogTypes";
import { pathLabel } from "../workspaceTree";

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
  const settingsPatchSaveTailRef = useRef<Promise<void>>(Promise.resolve());

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

  function saveSettingsPatch(patch: Partial<WorkspaceSettings>): Promise<void> {
    // Fire-and-forget controls share one local snapshot stream. Each patch must
    // wait for the prior save to publish the revision that authorizes it.
    const result = settingsPatchSaveTailRef.current.then(async () => {
      const baseSnapshot = optionsRef.current.workspaceSettingsRef.current
        ? {
            settings: optionsRef.current.workspaceSettingsRef.current,
            revision: optionsRef.current.workspaceSettingsRevisionRef.current,
          }
        : await window.exo.workspace.getSettings();
      const nextSettings: WorkspaceSettings = {
        ...baseSnapshot.settings,
        ...patch,
      };
      const saved = await window.exo.workspace.saveSettings({
        settings: nextSettings,
        expectedRevision: baseSnapshot.revision,
      });
      optionsRef.current.workspaceSettingsRef.current = saved.settings;
      optionsRef.current.workspaceSettingsRevisionRef.current = saved.revision;
      if (saved.runtimeApply.status === "failed") {
        throw new Error(saved.runtimeApply.errorMessage);
      }
      void optionsRef.current.onSettingsSaved?.();
    });
    settingsPatchSaveTailRef.current = result.catch(() => undefined);
    return result;
  }

  async function openDialog(section: WorkspaceSettingsSection = "workspace") {
    const snapshot = await window.exo.workspace.getSettings();
    const settings = snapshot.settings;
    optionsRef.current.workspaceSettingsRef.current = settings;
    optionsRef.current.workspaceSettingsRevisionRef.current = snapshot.revision;
    const appliedWorkspaceKey = workspaceSettingsStructuralKeyFromSettings(settings);
    setDialog({
      section,
      settingsRevision: snapshot.revision,
      workspaceRoot: settings.workspaceRoot,
      defaultTerminalCwd: settings.defaultTerminalCwd,
      noteRoots: settings.noteRoots,
      indexedRoots: settings.indexedRoots.map((root) => root.path),
      indexMode: settings.indexing.mode,
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
      const saved = await window.exo.workspace.saveSettings({
        settings: nextSettings,
        expectedRevision: settingsDialog.settingsRevision,
      });
      optionsRef.current.workspaceSettingsRef.current = saved.settings;
      optionsRef.current.workspaceSettingsRevisionRef.current = saved.revision;
      optionsRef.current.applyWorkspaceSettings(saved.settings);
      if (saved.runtimeApply.status === "failed") {
        const runtimeApplyErrorMessage = saved.runtimeApply.errorMessage;
        setDialog((current) => {
          if (!current || current.settingsRevision !== settingsDialog.settingsRevision) {
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
        if (!current || current.settingsRevision !== settingsDialog.settingsRevision) {
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

export function workspaceSettingsFromDialog(
  settingsDialog: WorkspaceSettingsDialogState,
  options: { includeStructural: boolean },
  currentSettings: WorkspaceSettings | null,
): WorkspaceSettings {
  if (!currentSettings) {
    throw new Error("Workspace settings are unavailable. Close Settings and try again.");
  }

  const fallbackStructural = {
    workspaceRoot: settingsDialog.workspaceRoot.trim(),
    defaultTerminalCwd: settingsDialog.defaultTerminalCwd.trim(),
    noteRoots: settingsDialog.noteRoots
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
  return {
    ...currentSettings,
    workspaceRoot: options.includeStructural ? fallbackStructural.workspaceRoot : currentSettings?.workspaceRoot ?? fallbackStructural.workspaceRoot,
    defaultTerminalCwd: options.includeStructural ? fallbackStructural.defaultTerminalCwd : currentSettings?.defaultTerminalCwd ?? fallbackStructural.defaultTerminalCwd,
    noteRoots: options.includeStructural
      ? fallbackStructural.noteRoots
      : currentSettings?.noteRoots ?? fallbackStructural.noteRoots,
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
    explorerScale: clampNumber(Number(settingsDialog.explorerScale), 0.82, 1.35),
    exploreIndexSearchOnEnter: settingsDialog.exploreIndexSearchOnEnter,
    indexUpdateStrategy: settingsDialog.indexUpdateStrategy,
    agentCommands: settingsDialog.agentCommands,
    agentInvocationPrompt: settingsDialog.agentInvocationPrompt,
  };
}
