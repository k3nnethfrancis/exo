import { BrowserWindow, dialog, shell, type OpenDialogOptions } from "electron";
import path from "node:path";
import type { WorkspaceModel, WorkspaceSettings } from "@exo/core";

import type { DesktopApi, FileStatInfo, WorkspaceRegistryEntry } from "../shared/api";
import { handleDesktopInvoke } from "./typed-ipc";

type WorkspaceApi = DesktopApi["workspace"];
type NotesApi = DesktopApi["notes"];

export interface WorkspaceIpcHandlers {
  activateWorkspace: WorkspaceApi["activateWorkspace"];
  addAgentSkillSource: WorkspaceApi["addAgentSkillSource"];
  createBranch: NotesApi["createBranch"];
  createDirectory: WorkspaceApi["createDirectory"];
  createFile: WorkspaceApi["createFile"];
  deletePath: WorkspaceApi["deletePath"];
  embedIndex: WorkspaceApi["embedIndex"];
  ensureTarget: NotesApi["ensureTarget"];
  getAgentInstructionConfig: WorkspaceApi["getAgentInstructionConfig"];
  getBranchFamily: NotesApi["getBranchFamily"];
  getGitStatus: WorkspaceApi["getGitStatus"];
  getIndexStatus: WorkspaceApi["getIndexStatus"];
  getKnowledge: NotesApi["getKnowledge"];
  getMainWindow: () => BrowserWindow | null;
  getModel: () => WorkspaceModel;
  getProfileState: WorkspaceApi["getProfileState"];
  getRuntimeStatus: () => Promise<unknown> | unknown;
  getSettings: () => WorkspaceSettings;
  getSetupState: () => { complete: boolean; settingsPath: string };
  enablePlugin: WorkspaceApi["enablePlugin"];
  disablePlugin: WorkspaceApi["disablePlugin"];
  setActiveProfile: WorkspaceApi["setActiveProfile"];
  clearActiveProfile: WorkspaceApi["clearActiveProfile"];
  setProfileAutoUpdate: WorkspaceApi["setProfileAutoUpdate"];
  markProfileReviewRequired: WorkspaceApi["markProfileReviewRequired"];
  previewProfile: WorkspaceApi["previewProfile"];
  copyProfile: WorkspaceApi["copyProfile"];
  trustPlugin: WorkspaceApi["trustPlugin"];
  addLocalPlugin: WorkspaceApi["addLocalPlugin"];
  removeLocalPlugin: WorkspaceApi["removeLocalPlugin"];
  replaceLocalPlugin: WorkspaceApi["replaceLocalPlugin"];
  readPluginSettings: WorkspaceApi["readPluginSettings"];
  updatePluginSettings: WorkspaceApi["updatePluginSettings"];
  resetPluginSettings: WorkspaceApi["resetPluginSettings"];
  listProposals: WorkspaceApi["listProposals"];
  readProposal: WorkspaceApi["readProposal"];
  decideProposal: WorkspaceApi["decideProposal"];
  listAgentHarnesses: WorkspaceApi["listAgentHarnesses"];
  listAgentInstructionOverlays: WorkspaceApi["listAgentInstructionOverlays"];
  listAgentSkills: WorkspaceApi["listAgentSkills"];
  listPluginInventory: WorkspaceApi["listPluginInventory"];
  listTree: WorkspaceApi["listTree"];
  listWorkspaces: () => Promise<WorkspaceRegistryEntry[]>;
  readNote: NotesApi["read"];
  readAgentSkillFile: WorkspaceApi["readAgentSkillFile"];
  renamePath: WorkspaceApi["renamePath"];
  resolveTarget: NotesApi["resolveTarget"];
  saveAgentInstructionConfig: WorkspaceApi["saveAgentInstructionConfig"];
  saveAgentSkillFile: WorkspaceApi["saveAgentSkillFile"];
  saveNote: NotesApi["save"];
  saveSettings: WorkspaceApi["saveSettings"];
  searchIndex: WorkspaceApi["searchIndex"];
  searchNotes: WorkspaceApi["searchNotes"];
  searchTag: WorkspaceApi["searchTag"];
  searchWorkspace: WorkspaceApi["searchWorkspace"];
  setAgentSkillEnabled: WorkspaceApi["setAgentSkillEnabled"];
  installAgentLibrarySkill: WorkspaceApi["installAgentLibrarySkill"];
  statNote: (filePath: string) => Promise<FileStatInfo | null>;
  suggestTargets: NotesApi["suggestTargets"];
  syncAgentSkillSource: WorkspaceApi["syncAgentSkillSource"];
  syncIndex: WorkspaceApi["syncIndex"];
  syncRuntime: () => Promise<unknown>;
  updateIndex: WorkspaceApi["updateIndex"];
}

export function registerWorkspaceIpcHandlers(handlers: WorkspaceIpcHandlers) {
  handleDesktopInvoke("workspace:get-model", async () => handlers.getModel());
  handleDesktopInvoke("workspace:get-settings", async () => handlers.getSettings());
  handleDesktopInvoke("workspace:get-setup-state", async () => handlers.getSetupState());
  handleDesktopInvoke("workspace:list-workspaces", async () => handlers.listWorkspaces());
  handleDesktopInvoke("workspace:activate-workspace", async (_event, workspaceId) => handlers.activateWorkspace(workspaceId));
  handleDesktopInvoke("workspace:get-index-status", async () => handlers.getIndexStatus());
  handleDesktopInvoke("workspace:index-sync", async () => handlers.syncIndex());
  handleDesktopInvoke("workspace:index-update", async () => handlers.updateIndex());
  handleDesktopInvoke("workspace:index-embed", async () => handlers.embedIndex());
  handleDesktopInvoke("workspace:save-settings", async (_event, settings) => handlers.saveSettings(settings));
  handleDesktopInvoke(
    "workspace:select-folder",
    async (_event, options) => {
      if (process.env.EXO_TEST === "1" && process.env.EXO_TEST_SELECT_FOLDER_PATH) {
        return options?.allowMultiple
          ? process.env.EXO_TEST_SELECT_FOLDER_PATH.split(path.delimiter).filter(Boolean)
          : [process.env.EXO_TEST_SELECT_FOLDER_PATH];
      }

      const dialogOptions: OpenDialogOptions = {
        title: options?.title,
        buttonLabel: options?.buttonLabel,
        properties: [
          "openDirectory",
          "createDirectory",
          ...(options?.allowMultiple ? ["multiSelections" as const] : []),
        ],
      };
      const mainWindow = handlers.getMainWindow();
      const result = mainWindow && !mainWindow.isDestroyed()
        ? await dialog.showOpenDialog(mainWindow, dialogOptions)
        : await dialog.showOpenDialog(dialogOptions);
      return result.canceled ? [] : result.filePaths;
    },
  );
  handleDesktopInvoke("runtime:get-status", async () => handlers.getRuntimeStatus());
  handleDesktopInvoke("runtime:sync", async () => handlers.syncRuntime());
  handleDesktopInvoke(
    "workspace:list-tree",
    async (_event, rootPath, options) =>
      handlers.listTree(rootPath, options),
  );
  handleDesktopInvoke("workspace:search-notes", async (_event, query) => handlers.searchNotes(query));
  handleDesktopInvoke("workspace:search-workspace", async (_event, query) => handlers.searchWorkspace(query));
  handleDesktopInvoke(
    "workspace:search-index",
    async (_event, query, options) =>
      handlers.searchIndex(query, options),
  );
  handleDesktopInvoke("workspace:get-git-status", async (_event, rootPath) => handlers.getGitStatus(rootPath));
  handleDesktopInvoke("workspace:get-agent-instruction-config", async () => handlers.getAgentInstructionConfig());
  handleDesktopInvoke("workspace:list-agent-harnesses", async () => handlers.listAgentHarnesses());
  handleDesktopInvoke("workspace:list-plugin-inventory", async () => handlers.listPluginInventory());
  handleDesktopInvoke("workspace:get-profile-state", async () => handlers.getProfileState());
  handleDesktopInvoke("workspace:set-active-profile", async (_event, input) => handlers.setActiveProfile(input));
  handleDesktopInvoke("workspace:clear-active-profile", async () => handlers.clearActiveProfile());
  handleDesktopInvoke("workspace:set-profile-auto-update", async (_event, input) => handlers.setProfileAutoUpdate(input));
  handleDesktopInvoke("workspace:mark-profile-review-required", async (_event, input) => handlers.markProfileReviewRequired(input));
  handleDesktopInvoke("workspace:preview-profile", async (_event, input) => handlers.previewProfile(input));
  handleDesktopInvoke("workspace:copy-profile", async (_event, input) => handlers.copyProfile(input));
  handleDesktopInvoke("workspace:enable-plugin", async (_event, input) => handlers.enablePlugin(input));
  handleDesktopInvoke("workspace:disable-plugin", async (_event, input) => handlers.disablePlugin(input));
  handleDesktopInvoke("workspace:trust-plugin", async (_event, input) => handlers.trustPlugin(input));
  handleDesktopInvoke("workspace:add-local-plugin", async (_event, input) => handlers.addLocalPlugin(input));
  handleDesktopInvoke("workspace:remove-local-plugin", async (_event, input) => handlers.removeLocalPlugin(input));
  handleDesktopInvoke("workspace:replace-local-plugin", async (_event, input) => handlers.replaceLocalPlugin(input));
  handleDesktopInvoke("workspace:read-plugin-settings", async (_event, input) => handlers.readPluginSettings(input));
  handleDesktopInvoke("workspace:update-plugin-settings", async (_event, input) => handlers.updatePluginSettings(input));
  handleDesktopInvoke("workspace:reset-plugin-settings", async (_event, input) => handlers.resetPluginSettings(input));
  handleDesktopInvoke("workspace:list-proposals", async () => handlers.listProposals());
  handleDesktopInvoke("workspace:read-proposal", async (_event, id) => handlers.readProposal(id));
  handleDesktopInvoke("workspace:decide-proposal", async (_event, id, input) => handlers.decideProposal(id, input));
  handleDesktopInvoke("workspace:save-agent-instruction-config", async (_event, input) =>
    handlers.saveAgentInstructionConfig(input),
  );
  handleDesktopInvoke("workspace:list-agent-instruction-overlays", async () => handlers.listAgentInstructionOverlays());
  handleDesktopInvoke("workspace:list-agent-skills", async () => handlers.listAgentSkills());
  handleDesktopInvoke("workspace:add-agent-skill-source", async (_event, input) => handlers.addAgentSkillSource(input));
  handleDesktopInvoke("workspace:sync-agent-skill-source", async (_event, sourceId) => handlers.syncAgentSkillSource(sourceId));
  handleDesktopInvoke("workspace:install-agent-library-skill", async (_event, input) => handlers.installAgentLibrarySkill(input));
  handleDesktopInvoke("workspace:read-agent-skill-file", async (_event, skillId, relativePath) =>
    handlers.readAgentSkillFile(skillId, relativePath),
  );
  handleDesktopInvoke("workspace:save-agent-skill-file", async (_event, skillId, relativePath, body) =>
    handlers.saveAgentSkillFile(skillId, relativePath, body),
  );
  handleDesktopInvoke("workspace:set-agent-skill-enabled", async (_event, input) => handlers.setAgentSkillEnabled(input));
  handleDesktopInvoke("workspace:create-file", async (_event, targetPath, content) => handlers.createFile(targetPath, content));
  handleDesktopInvoke("workspace:create-directory", async (_event, targetPath) => handlers.createDirectory(targetPath));
  handleDesktopInvoke("workspace:rename-path", async (_event, sourcePath, nextPath) => handlers.renamePath(sourcePath, nextPath));
  handleDesktopInvoke("workspace:delete-path", async (_event, targetPath) => handlers.deletePath(targetPath));
  handleDesktopInvoke("workspace:search-tag", async (_event, tag) => handlers.searchTag(tag));
  handleDesktopInvoke("notes:read", async (_event, filePath) => handlers.readNote(filePath));
  handleDesktopInvoke("notes:save", async (_event, filePath, frontmatter, body) =>
    handlers.saveNote(filePath, frontmatter, body),
  );
  handleDesktopInvoke("notes:stat", async (_event, filePath) => handlers.statNote(filePath));
  handleDesktopInvoke("notes:get-knowledge", async (_event, filePath) => handlers.getKnowledge(filePath));
  handleDesktopInvoke("notes:resolve-target", async (_event, sourceFilePath, target) => handlers.resolveTarget(sourceFilePath, target));
  handleDesktopInvoke("notes:ensure-target", async (_event, sourceFilePath, target) => handlers.ensureTarget(sourceFilePath, target));
  handleDesktopInvoke("notes:suggest-targets", async (_event, sourceFilePath, query) => handlers.suggestTargets(sourceFilePath, query));
  handleDesktopInvoke("notes:get-branch-family", async (_event, filePath) => handlers.getBranchFamily(filePath));
  handleDesktopInvoke("notes:create-branch", async (_event, filePath, frontmatter, body) =>
    handlers.createBranch(filePath, frontmatter, body),
  );
  handleDesktopInvoke("shell:open-external", async (_event, target) => shell.openExternal(target));
  handleDesktopInvoke("shell:focus-window", async () => {
    const window = handlers.getMainWindow();
    window?.focus();
    window?.webContents.focus();
  });
}
