import type { DesktopApi, IndexSyncStateEvent, TerminalDataEvent, TerminalSessionInfo, WorkspaceSettingsSection } from "./api";
import type { InvocationRecord } from "@exo/core";

type WorkspaceApi = DesktopApi["workspace"];
type NotesApi = DesktopApi["notes"];
type TerminalsApi = DesktopApi["terminals"];
type ShellApi = DesktopApi["shell"];

export interface DesktopInvokeHandlers {
  "workspace:get-model": WorkspaceApi["getModel"];
  "workspace:get-settings": WorkspaceApi["getSettings"];
  "workspace:get-setup-state": WorkspaceApi["getSetupState"];
  "workspace:mark-onboarding-complete": WorkspaceApi["markOnboardingComplete"];
  "workspace:list-workspaces": WorkspaceApi["listWorkspaces"];
  "workspace:activate-workspace": WorkspaceApi["activateWorkspace"];
  "workspace:save-settings": WorkspaceApi["saveSettings"];
  "workspace:select-folder": WorkspaceApi["selectFolder"];
  "workspace:get-index-status": WorkspaceApi["getIndexStatus"];
  "workspace:resolve-preview-target": WorkspaceApi["resolvePreviewTarget"];
  "workspace:launch-agent-invocation": WorkspaceApi["launchAgentInvocation"];
  "workspace:end-agent-invocation": WorkspaceApi["endAgentInvocation"];
  "workspace:index-sync": WorkspaceApi["syncIndex"];
  "workspace:index-update": WorkspaceApi["updateIndex"];
  "workspace:index-embed": WorkspaceApi["embedIndex"];
  "workspace:list-tree": WorkspaceApi["listTree"];
  "workspace:search-notes": WorkspaceApi["searchNotes"];
  "workspace:search-workspace": WorkspaceApi["searchWorkspace"];
  "workspace:search-index": WorkspaceApi["searchIndex"];
  "workspace:search-tag": WorkspaceApi["searchTag"];
  "workspace:get-agent-instruction-config": WorkspaceApi["getAgentInstructionConfig"];
  "workspace:save-agent-instruction-config": WorkspaceApi["saveAgentInstructionConfig"];
  "workspace:sync-agent-instruction-files-from-provider": WorkspaceApi["syncAgentInstructionFilesFromProvider"];
  "workspace:apply-global-exograph-context": WorkspaceApi["applyGlobalExographContext"];
  "workspace:list-agent-instruction-overlays": WorkspaceApi["listAgentInstructionOverlays"];
  "workspace:create-file": WorkspaceApi["createFile"];
  "workspace:create-directory": WorkspaceApi["createDirectory"];
  "workspace:rename-path": WorkspaceApi["renamePath"];
  "workspace:delete-path": WorkspaceApi["deletePath"];
  "notes:read": NotesApi["read"];
  "notes:save": NotesApi["save"];
  "notes:stat": NotesApi["stat"];
  "notes:get-graph-context": NotesApi["getGraphContext"];
  "notes:resolve-target": NotesApi["resolveTarget"];
  "notes:ensure-target": NotesApi["ensureTarget"];
  "notes:suggest-targets": NotesApi["suggestTargets"];
  "notes:get-branch-family": NotesApi["getBranchFamily"];
  "notes:create-branch": NotesApi["createBranch"];
  "terminals:ensure-default": TerminalsApi["ensureDefault"];
  "terminals:list": TerminalsApi["list"];
  "terminals:create": TerminalsApi["create"];
  "terminals:read": TerminalsApi["read"];
  "terminals:write": TerminalsApi["write"];
  "terminals:send-message": TerminalsApi["sendMessage"];
  "terminals:resize": TerminalsApi["resize"];
  "terminals:kill": TerminalsApi["kill"];
  "shell:open-external": ShellApi["openExternal"];
  "shell:focus-window": ShellApi["focusWindow"];
}

export interface DesktopEventPayloads {
  "workspace:changed": { rootPath: string; eventType: string; filePath: string | null };
  "workspace:index-sync-state": IndexSyncStateEvent;
  "workspace:invocation-updated": InvocationRecord;
  "command:open-file": string;
  "command:open-preview": { url: string };
  "command:focus-preview": undefined;
  "command:close-preview": undefined;
  "command:open-settings": { section: WorkspaceSettingsSection };
  "terminal:created": TerminalSessionInfo;
  "terminal:updated": TerminalSessionInfo;
  "terminal:data": TerminalDataEvent;
  "terminal:exit": { id: string; exitCode?: number };
}

export type DesktopInvokeChannel = keyof DesktopInvokeHandlers;
export type DesktopEventChannel = keyof DesktopEventPayloads;
