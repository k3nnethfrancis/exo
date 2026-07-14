import type { WorkspaceSettings } from "@exo/core";
import {
  DEFAULT_TERMINAL_PENDING_HYDRATION_CHARS as CORE_DEFAULT_TERMINAL_PENDING_HYDRATION_CHARS,
  DEFAULT_TERMINAL_SCROLLBACK_LINES,
} from "@exo/core/terminal-settings";

import type { WorkspaceSettingsDialogState } from "./workspaceSettingsDialogTypes";

export const DEFAULT_TERMINAL_RUNTIME_SCROLLBACK_LINES = DEFAULT_TERMINAL_SCROLLBACK_LINES;
export const DEFAULT_TERMINAL_PENDING_HYDRATION_CHARS = CORE_DEFAULT_TERMINAL_PENDING_HYDRATION_CHARS;
export const DEFAULT_EDITOR_FONT_SIZE = 15;
export const DEFAULT_TERMINAL_FONT_SIZE = 13;
export const DEFAULT_EXPLORER_SCALE = 1;

export function workspaceSettingsImmediateDraftKey(settings: WorkspaceSettingsDialogState): string {
  return JSON.stringify({
    appearanceMode: settings.appearanceMode,
    colorThemeId: settings.colorThemeId,
    editorFontSize: settings.editorFontSize,
    terminalFontSize: settings.terminalFontSize,
    explorerScale: settings.explorerScale,
    exploreIndexSearchOnEnter: settings.exploreIndexSearchOnEnter,
    indexUpdateStrategy: settings.indexUpdateStrategy,
    agentCommands: settings.agentCommands,
    agentInvocationPrompt: settings.agentInvocationPrompt,
  });
}

export function workspaceSettingsStructuralDraftKey(settings: WorkspaceSettingsDialogState): string {
  return JSON.stringify({
    workspaceRoot: settings.workspaceRoot,
    defaultTerminalCwd: settings.defaultTerminalCwd,
    noteRoots: settings.noteRoots,
    indexedRoots: settings.indexedRoots,
    indexMode: settings.indexMode,
  });
}

export function workspaceSettingsStructuralKeyFromSettings(settings: WorkspaceSettings): string {
  return JSON.stringify({
    workspaceRoot: settings.workspaceRoot,
    defaultTerminalCwd: settings.defaultTerminalCwd,
    noteRoots: settings.noteRoots,
    indexedRoots: settings.indexedRoots.map((root) => root.path),
    indexMode: settings.indexing.mode,
  });
}

export function resolveSettingsTerminalRuntime(_settings: WorkspaceSettings): { readTailChars: number; scrollbackLines: number } {
  return {
    readTailChars: DEFAULT_TERMINAL_PENDING_HYDRATION_CHARS,
    scrollbackLines: DEFAULT_TERMINAL_RUNTIME_SCROLLBACK_LINES,
  };
}

export function clampNumber(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) {
    return min;
  }
  return Math.min(max, Math.max(min, value));
}
