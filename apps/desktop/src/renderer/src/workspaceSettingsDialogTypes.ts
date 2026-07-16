import type { AgentCommand, SearchEngine, WorkspaceSettings, WorkspaceSettingsRevision } from "@exo/core";

import type { AppearanceMode } from "./appearance";
import type { ColorThemeId } from "./theme/types";
import type { WorkspaceSettingsSection } from "../../shared/api";

export type { WorkspaceSettingsSection };

export type IndexBusyState = "syncing" | "updating" | "embedding" | null;

export interface WorkspaceSettingsDialogState {
  section: WorkspaceSettingsSection;
  settingsRevision: WorkspaceSettingsRevision;
  workspaceRoot: string;
  defaultTerminalCwd: string;
  noteRoots: string[];
  indexedRoots: string[];
  indexMode: WorkspaceSettings["indexing"]["mode"];
  searchEngine: SearchEngine;
  appearanceMode: AppearanceMode;
  colorThemeId: ColorThemeId;
  editorFontSize: string;
  terminalFontSize: string;
  explorerScale: string;
  exploreIndexSearchOnEnter: boolean;
  indexUpdateStrategy: WorkspaceSettings["indexUpdateStrategy"];
  agentCommands: AgentCommand[];
  agentInvocationPrompt?: string;
  saveStatus: "idle" | "saving" | "saved" | "error";
  errorMessage: string | null;
  appliedWorkspaceKey: string;
  applyStatus: "idle" | "applying" | "applied" | "error";
  applyErrorMessage: string | null;
}
