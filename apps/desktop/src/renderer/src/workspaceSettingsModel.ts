import type { WorkspaceSettings } from "@exo/core";

import type { WorkspaceSettingsDialogState } from "./workspaceSettingsDialogTypes";

export const DEFAULT_TERMINAL_HISTORY_LINES = 100_000;
export const DEFAULT_TERMINAL_READ_TAIL_CHARS = 20_000;
export const MIN_TERMINAL_HISTORY_LINES = 500;
export const DEFAULT_EDITOR_FONT_SIZE = 15;
export const DEFAULT_TERMINAL_FONT_SIZE = 13;
export const DEFAULT_EXPLORER_SCALE = 1;

export function workspaceSettingsImmediateDraftKey(settings: WorkspaceSettingsDialogState): string {
  return JSON.stringify({
    appearanceMode: settings.appearanceMode,
    colorThemeId: settings.colorThemeId,
    editorFontSize: settings.editorFontSize,
    terminalFontSize: settings.terminalFontSize,
    terminalHistoryLines: settings.terminalHistoryLines,
    terminalTranscriptRetention: settings.terminalTranscriptRetention,
    terminalTranscriptRetentionDays: settings.terminalTranscriptRetentionDays,
    explorerScale: settings.explorerScale,
    exploreIndexSearchOnEnter: settings.exploreIndexSearchOnEnter,
    indexUpdateStrategy: settings.indexUpdateStrategy,
    piHarnessEnabled: settings.piHarnessEnabled,
    piHarnessLabel: settings.piHarnessLabel,
    piHarnessCommand: settings.piHarnessCommand,
    piHarnessRepoPath: settings.piHarnessRepoPath,
    piHarnessArgs: settings.piHarnessArgs,
    piHarnessBackendUrl: settings.piHarnessBackendUrl,
    piHarnessBackendCommand: settings.piHarnessBackendCommand,
    piHarnessBackendLabel: settings.piHarnessBackendLabel,
    piHarnessBackendKind: settings.piHarnessBackendKind,
    piHarnessBackendReady: settings.piHarnessBackendReady,
  });
}

export function workspaceSettingsStructuralDraftKey(settings: WorkspaceSettingsDialogState): string {
  return JSON.stringify({
    workspaceRoot: settings.workspaceRoot,
    defaultTerminalCwd: settings.defaultTerminalCwd,
    noteRoots: settings.noteRoots,
    projectRoots: settings.projectRoots,
    indexedRoots: settings.indexedRoots,
    indexMode: settings.indexMode,
  });
}

export function workspaceSettingsStructuralKeyFromSettings(settings: WorkspaceSettings): string {
  return JSON.stringify({
    workspaceRoot: settings.workspaceRoot,
    defaultTerminalCwd: settings.defaultTerminalCwd,
    noteRoots: settings.noteRoots,
    projectRoots: settings.projectRoots,
    indexedRoots: settings.indexedRoots.map((root) => root.path),
    indexMode: settings.indexing.mode,
  });
}

export function resolveSettingsTerminalRuntime(settings: WorkspaceSettings): { readTailChars: number; scrollbackLines: number } {
  return {
    readTailChars: settings.terminalReadTailChars ?? DEFAULT_TERMINAL_READ_TAIL_CHARS,
    scrollbackLines: settings.terminalHistoryLines,
  };
}

export function clampNumber(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) {
    return min;
  }
  return Math.min(max, Math.max(min, value));
}
