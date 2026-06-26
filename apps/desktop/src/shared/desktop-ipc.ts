import type { DesktopApi, IndexSyncStateEvent, TerminalDataEvent, TerminalSessionInfo } from "./api";

type WorkspaceApi = DesktopApi["workspace"];
type NotesApi = DesktopApi["notes"];
type TerminalsApi = DesktopApi["terminals"];
type ShellApi = DesktopApi["shell"];

export interface DesktopInvokeHandlers {
  "workspace:get-model": WorkspaceApi["getModel"];
  "workspace:get-settings": WorkspaceApi["getSettings"];
  "workspace:get-setup-state": WorkspaceApi["getSetupState"];
  "workspace:list-workspaces": WorkspaceApi["listWorkspaces"];
  "workspace:activate-workspace": WorkspaceApi["activateWorkspace"];
  "workspace:save-settings": WorkspaceApi["saveSettings"];
  "workspace:select-folder": WorkspaceApi["selectFolder"];
  "workspace:get-index-status": WorkspaceApi["getIndexStatus"];
  "workspace:index-sync": WorkspaceApi["syncIndex"];
  "workspace:index-update": WorkspaceApi["updateIndex"];
  "workspace:index-embed": WorkspaceApi["embedIndex"];
  "workspace:list-tree": WorkspaceApi["listTree"];
  "workspace:search-notes": WorkspaceApi["searchNotes"];
  "workspace:search-workspace": WorkspaceApi["searchWorkspace"];
  "workspace:search-index": WorkspaceApi["searchIndex"];
  "workspace:get-git-status": WorkspaceApi["getGitStatus"];
  "workspace:get-agent-instruction-config": WorkspaceApi["getAgentInstructionConfig"];
  "workspace:list-agent-harnesses": WorkspaceApi["listAgentHarnesses"];
  "workspace:list-plugin-inventory": WorkspaceApi["listPluginInventory"];
  "workspace:save-agent-instruction-config": WorkspaceApi["saveAgentInstructionConfig"];
  "workspace:list-agent-instruction-overlays": WorkspaceApi["listAgentInstructionOverlays"];
  "workspace:list-agent-skills": WorkspaceApi["listAgentSkills"];
  "workspace:add-agent-skill-source": WorkspaceApi["addAgentSkillSource"];
  "workspace:sync-agent-skill-source": WorkspaceApi["syncAgentSkillSource"];
  "workspace:install-agent-library-skill": WorkspaceApi["installAgentLibrarySkill"];
  "workspace:read-agent-skill-file": WorkspaceApi["readAgentSkillFile"];
  "workspace:save-agent-skill-file": WorkspaceApi["saveAgentSkillFile"];
  "workspace:set-agent-skill-enabled": WorkspaceApi["setAgentSkillEnabled"];
  "workspace:create-file": WorkspaceApi["createFile"];
  "workspace:create-directory": WorkspaceApi["createDirectory"];
  "workspace:rename-path": WorkspaceApi["renamePath"];
  "workspace:delete-path": WorkspaceApi["deletePath"];
  "runtime:get-status": () => Promise<unknown>;
  "runtime:sync": () => Promise<unknown>;
  "notes:read": NotesApi["read"];
  "notes:save": NotesApi["save"];
  "notes:stat": NotesApi["stat"];
  "notes:get-knowledge": NotesApi["getKnowledge"];
  "notes:resolve-target": NotesApi["resolveTarget"];
  "notes:ensure-target": NotesApi["ensureTarget"];
  "notes:suggest-targets": NotesApi["suggestTargets"];
  "notes:get-branch-family": NotesApi["getBranchFamily"];
  "notes:create-branch": NotesApi["createBranch"];
  "terminals:ensure-default": TerminalsApi["ensureDefault"];
  "terminals:list": TerminalsApi["list"];
  "terminals:diagnostics": TerminalsApi["diagnostics"];
  "terminals:create": TerminalsApi["create"];
  "terminals:read": TerminalsApi["read"];
  "terminals:read-transcript": TerminalsApi["readTranscript"];
  "terminals:write": TerminalsApi["write"];
  "terminals:send-message": TerminalsApi["sendMessage"];
  "terminals:reconnect": TerminalsApi["reconnect"];
  "terminals:resize": TerminalsApi["resize"];
  "terminals:kill": TerminalsApi["kill"];
  "shell:open-external": ShellApi["openExternal"];
  "shell:focus-window": ShellApi["focusWindow"];
}

export interface DesktopEventPayloads {
  "workspace:changed": { rootPath: string; eventType: string; filePath: string | null };
  "workspace:index-sync-state": IndexSyncStateEvent;
  "command:open-file": string;
  "command:open-preview": { url: string };
  "command:focus-preview": undefined;
  "command:close-preview": undefined;
  "command:open-settings": { section: "workspace" | "index" | "appearance" | "terminal" };
  "terminal:created": TerminalSessionInfo;
  "terminal:data": TerminalDataEvent;
  "terminal:exit": { id: string; exitCode?: number };
}

export type DesktopInvokeChannel = keyof DesktopInvokeHandlers;
export type DesktopEventChannel = keyof DesktopEventPayloads;
