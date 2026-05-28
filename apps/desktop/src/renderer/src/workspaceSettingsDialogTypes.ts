import type { WorkspaceSettings } from "@exo/core";

import type { AppearanceMode } from "./appearance";

export type WorkspaceSettingsSection = "workspace" | "index" | "agents" | "appearance" | "terminal";

export type IndexBusyState = "syncing" | "updating" | "embedding" | null;

export interface WorkspaceSettingsDialogState {
  section: WorkspaceSettingsSection;
  workspaceRoot: string;
  defaultTerminalCwd: string;
  noteRoots: string[];
  projectRoots: string[];
  indexedRoots: string[];
  indexMode: WorkspaceSettings["indexing"]["mode"];
  appearanceMode: AppearanceMode;
  editorFontSize: string;
  terminalFontSize: string;
  terminalHistoryMode: WorkspaceSettings["terminalHistoryMode"];
  terminalHistoryLines: string;
  terminalTranscriptRetention: WorkspaceSettings["terminalTranscriptRetention"];
  terminalTranscriptRetentionDays: string;
  explorerScale: string;
  exploreIndexSearchOnEnter: boolean;
  indexUpdateStrategy: WorkspaceSettings["indexUpdateStrategy"];
  saveStatus: "idle" | "saving" | "saved" | "error";
  errorMessage: string | null;
  appliedWorkspaceKey: string;
  applyStatus: "idle" | "applying" | "applied" | "error";
  applyErrorMessage: string | null;
  partialErrorMessages: string[];
}
