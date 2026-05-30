import type { WorkspaceSettings } from "@exo/core";

import type { WorkspaceSettingsDialogState } from "./workspaceSettingsDialogTypes";

export const FULL_TERMINAL_SCROLLBACK_LINES = 1_000_000;
export const DEFAULT_EDITOR_FONT_SIZE = 15;
export const DEFAULT_TERMINAL_FONT_SIZE = 13;
export const DEFAULT_EXPLORER_SCALE = 1;

export function workspaceSettingsImmediateDraftKey(settings: WorkspaceSettingsDialogState): string {
  return JSON.stringify({
    appearanceMode: settings.appearanceMode,
    editorFontSize: settings.editorFontSize,
    terminalFontSize: settings.terminalFontSize,
    terminalHistoryMode: settings.terminalHistoryMode,
    terminalHistoryLines: settings.terminalHistoryLines,
    terminalTranscriptRetention: settings.terminalTranscriptRetention,
    terminalTranscriptRetentionDays: settings.terminalTranscriptRetentionDays,
    explorerScale: settings.explorerScale,
    exploreIndexSearchOnEnter: settings.exploreIndexSearchOnEnter,
    indexUpdateStrategy: settings.indexUpdateStrategy,
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

export function resolveSettingsTerminalRuntime(settings: WorkspaceSettings): { scrollbackLines: number } {
  if (settings.terminalHistoryMode === "full") {
    return {
      scrollbackLines: FULL_TERMINAL_SCROLLBACK_LINES,
    };
  }
  return {
    scrollbackLines: settings.terminalHistoryLines,
  };
}

export function clampNumber(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) {
    return min;
  }
  return Math.min(max, Math.max(min, value));
}
