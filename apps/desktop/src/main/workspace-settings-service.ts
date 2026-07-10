import {
  resolveRuntimeConfig,
  resolveWorkspaceModel,
  type WorkspaceModel,
  type WorkspaceSettings,
  type WorkspaceSettingsSaveRequest,
  type WorkspaceSettingsSnapshot,
} from "@exo/core";

import type { WorkspaceSettingsSaveOutcome } from "../shared/api";

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

  currentSnapshot(): WorkspaceSettingsSnapshot {
    return {
      settings: this.currentSettings(),
      revision: this.options.store.currentRevision(),
    };
  }

  async saveSettings(request: WorkspaceSettingsSaveRequest): Promise<WorkspaceSettingsSaveOutcome> {
    const previousSettings = this.currentSettings();
    const previousRuntimeRoot = resolveRuntimeConfig().runtimeRoot;
    const nextSettings = {
      ...previousSettings,
      ...request.settings,
    };
    const saved = await this.options.store.save({
      settings: nextSettings,
      expectedRevision: request.expectedRevision,
    });
    const savedSettings = saved.settings;

    this.options.setWorkspaceSettings(savedSettings);
    this.options.setWorkspaceSetupComplete(true);

    try {
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
      this.options.terminalManager.setTerminalRuntimeOptions(terminalPolicy);
      await this.options.terminalManager.syncRuntimeContext();

      if (nextRuntimeConfig.runtimeRoot !== previousRuntimeRoot) {
        this.options.restartCommandServer();
      }
      if (this.options.indexingService.shouldSyncAfterSettingsApply(previousSettings, savedSettings)) {
        this.options.indexingService.scheduleSync("settings-apply", 0);
      }
    } catch (error) {
      return {
        ...saved,
        runtimeApply: {
          status: "failed",
          errorMessage: runtimeApplyErrorMessage(error),
        },
      };
    }

    return { ...saved, runtimeApply: { status: "applied" } };
  }

  applySettings(settings: WorkspaceSettings | null): void {
    applyWorkspaceSettingsToEnv(settings);
    this.options.applyAppearanceMode(settings);
  }
}

function runtimeApplyErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
