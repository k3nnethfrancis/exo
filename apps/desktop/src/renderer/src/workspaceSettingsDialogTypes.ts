import type { WorkspaceSettings } from "@exo/core";

import type { AppearanceMode } from "./appearance";
import type { WorkspaceSettingsSection } from "../../shared/api";

export type { WorkspaceSettingsSection };

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
  terminalInputCoalesceMs: string;
  terminalAgentStartupGraceMs: string;
  terminalAgentSubmitDelayMs: string;
  terminalInitialColumns: string;
  terminalInitialRows: string;
  terminalMinimumColumns: string;
  terminalMinimumRows: string;
  terminalReadTailChars: string;
  terminalMaxReadTailChars: string;
  terminalUnresponsiveThresholdMs: string;
  terminalIdleThresholdMs: string;
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
