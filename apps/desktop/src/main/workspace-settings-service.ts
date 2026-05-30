import path from "node:path";

import {
  resolveRuntimeConfig,
  resolveWorkspaceModel,
  type WorkspaceModel,
  type WorkspaceSettings,
} from "@exo/core";

import type { IndexingService } from "./indexing-service";
import {
  applyWorkspaceSettingsToEnv,
  resolveTerminalRuntimePolicy,
  WorkspaceSettingsStore,
} from "./settings-store";
import type { TerminalManager } from "./terminal-manager";
import type { WorkspaceWatcherService } from "./workspace-watchers";

export interface WorkspaceSettingsServiceOptions {
  store: WorkspaceSettingsStore;
  getWorkspaceModel: () => WorkspaceModel;
  setWorkspaceModel: (model: WorkspaceModel) => void;
  getWorkspaceSettings: () => WorkspaceSettings | null;
  setWorkspaceSettings: (settings: WorkspaceSettings) => void;
  setWorkspaceSetupComplete: (complete: boolean) => void;
  terminalManager: TerminalManager;
  workspaceWatcherService: WorkspaceWatcherService;
  indexingService: IndexingService;
  ensureNoteRoots: (model: WorkspaceModel) => Promise<void>;
  restartCommandServer: () => void;
  applyAppearanceMode: (settings: WorkspaceSettings | null) => void;
}

export class WorkspaceSettingsService {
  constructor(private readonly options: WorkspaceSettingsServiceOptions) {}

  currentSettings(): WorkspaceSettings {
    return this.options.getWorkspaceSettings() ?? this.options.store.fromModel(this.options.getWorkspaceModel());
  }

  async saveSettings(settings: WorkspaceSettings): Promise<WorkspaceSettings> {
    const previousSettings = this.currentSettings();
    const previousRuntimeRoot = resolveRuntimeConfig().runtimeRoot;
    const savedSettings = await this.options.store.save(settings);

    this.options.setWorkspaceSettings(savedSettings);
    this.options.setWorkspaceSetupComplete(true);
    this.applySettings(savedSettings);

    const nextModel = resolveWorkspaceModel();
    this.options.setWorkspaceModel(nextModel);
    const nextRuntimeConfig = resolveRuntimeConfig();
    const terminalPolicy = resolveTerminalRuntimePolicy(this.currentSettings());

    await this.options.ensureNoteRoots(nextModel);
    this.options.workspaceWatcherService.start(nextModel);
    this.options.terminalManager.setRuntimeConfig(nextRuntimeConfig);
    this.options.terminalManager.setDefaultCwd(nextModel.defaultTerminalCwd);
    this.options.terminalManager.setBufferLineLimit(terminalPolicy.bufferLineLimit);
    this.options.terminalManager.setTranscriptRetentionDays(terminalPolicy.transcriptRetentionDays);
    await this.options.terminalManager.syncRuntimeContext();

    if (nextRuntimeConfig.runtimeRoot !== previousRuntimeRoot) {
      this.options.restartCommandServer();
    }
    if (this.options.indexingService.shouldSyncAfterSettingsApply(previousSettings, savedSettings)) {
      this.options.indexingService.scheduleSync("settings-apply", 0);
    }

    return savedSettings;
  }

  async addProjectRoot(targetPath?: string): Promise<WorkspaceSettings> {
    if (!targetPath) {
      throw new Error("Missing project root path.");
    }
    const settings = this.currentSettings();
    const resolvedPath = path.resolve(targetPath);
    const nextRoots = uniqueResolvedPaths([...settings.projectRoots, resolvedPath]);
    return this.saveSettings({ ...settings, projectRoots: nextRoots });
  }

  async removeProjectRoot(target: string): Promise<WorkspaceSettings> {
    if (!target) {
      throw new Error("Missing project root target.");
    }
    const settings = this.currentSettings();
    const resolvedTarget = path.resolve(target);
    const nextRoots = settings.projectRoots.filter((root) => path.resolve(root) !== resolvedTarget && root !== target);
    return this.saveSettings({ ...settings, projectRoots: nextRoots });
  }

  applySettings(settings: WorkspaceSettings | null): void {
    applyWorkspaceSettingsToEnv(settings);
    this.options.applyAppearanceMode(settings);
  }
}

export function uniqueResolvedPaths(paths: string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const entry of paths) {
    const resolved = path.resolve(entry);
    if (seen.has(resolved)) {
      continue;
    }
    seen.add(resolved);
    result.push(resolved);
  }
  return result;
}
