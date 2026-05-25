import {
  DEFAULT_APPEARANCE_MODE,
  DEFAULT_EDITOR_FONT_SIZE,
  DEFAULT_EXPLORER_SCALE,
  DEFAULT_TERMINAL_FONT_SIZE,
  DEFAULT_TERMINAL_HISTORY_LINES,
  DEFAULT_TERMINAL_HISTORY_MODE,
  DEFAULT_TERMINAL_STREAMING_MODE,
  DEFAULT_TERMINAL_TRANSCRIPT_RETENTION,
  DEFAULT_TERMINAL_TRANSCRIPT_RETENTION_DAYS,
  FULL_TERMINAL_SCROLLBACK_LINES,
  getWorkspaceRegistryEntry,
  listWorkspaceRegistryEntries,
  loadWorkspaceSettings,
  normalizeWorkspaceSettings,
  resolveWorkspaceRegistryPath,
  resolveWorkspaceSettingsPath,
  saveWorkspaceSettings,
  workspaceSettingsToEnv,
  type WorkspaceModel,
  type WorkspaceRegistryEntry,
  type WorkspaceSettings,
} from "@exo/core";

export {
  DEFAULT_APPEARANCE_MODE,
  DEFAULT_EDITOR_FONT_SIZE,
  DEFAULT_EXPLORER_SCALE,
  DEFAULT_TERMINAL_FONT_SIZE,
  DEFAULT_TERMINAL_HISTORY_LINES,
  DEFAULT_TERMINAL_HISTORY_MODE,
  DEFAULT_TERMINAL_STREAMING_MODE,
  DEFAULT_TERMINAL_TRANSCRIPT_RETENTION,
  DEFAULT_TERMINAL_TRANSCRIPT_RETENTION_DAYS,
  FULL_TERMINAL_SCROLLBACK_LINES,
  type WorkspaceRegistryEntry,
};

export interface WorkspaceSettingsStoreOptions {
  userDataPath: string;
  env?: NodeJS.ProcessEnv;
}

export interface TerminalRuntimePolicy {
  scrollbackLines: number;
  bufferLineLimit: number | null;
  transcriptRetentionDays: number;
}

export class WorkspaceSettingsStore {
  private readonly env: NodeJS.ProcessEnv;

  constructor(private readonly options: WorkspaceSettingsStoreOptions) {
    this.env = options.env ?? process.env;
  }

  resolvePath(): string {
    return resolveWorkspaceSettingsPath({ ...this.env, EXO_USER_DATA_PATH: this.options.userDataPath });
  }

  resolveRegistryPath(): string {
    return resolveWorkspaceRegistryPath({ ...this.env, EXO_USER_DATA_PATH: this.options.userDataPath });
  }

  normalize(input: Partial<WorkspaceSettings> | null | undefined): WorkspaceSettings | null {
    return normalizeWorkspaceSettings(input);
  }

  fromModel(model: WorkspaceModel): WorkspaceSettings {
    return {
      workspaceRoot: model.workspaceRoot,
      defaultTerminalCwd: model.defaultTerminalCwd,
      noteRoots: model.noteRoots.map((root) => root.path),
      projectRoots: model.projectRoots.map((root) => root.path),
      indexedRoots: model.indexedRoots,
      indexing: model.indexing,
      appearanceMode: DEFAULT_APPEARANCE_MODE,
      editorFontSize: DEFAULT_EDITOR_FONT_SIZE,
      terminalFontSize: DEFAULT_TERMINAL_FONT_SIZE,
      terminalHistoryMode: DEFAULT_TERMINAL_HISTORY_MODE,
      terminalHistoryLines: DEFAULT_TERMINAL_HISTORY_LINES,
      terminalTranscriptRetention: DEFAULT_TERMINAL_TRANSCRIPT_RETENTION,
      terminalTranscriptRetentionDays: DEFAULT_TERMINAL_TRANSCRIPT_RETENTION_DAYS,
      terminalStreamingMode: DEFAULT_TERMINAL_STREAMING_MODE,
      explorerScale: DEFAULT_EXPLORER_SCALE,
      exploreIndexSearchOnEnter: model.indexing.enabled && model.indexing.mode !== "off" && model.indexedRoots.length > 0,
      indexUpdateStrategy: "on-save",
      agentContextFileAdapters: [],
    };
  }

  async load(): Promise<WorkspaceSettings | null> {
    return loadWorkspaceSettings({ ...this.env, EXO_USER_DATA_PATH: this.options.userDataPath });
  }

  async save(settings: WorkspaceSettings): Promise<WorkspaceSettings> {
    return saveWorkspaceSettings(settings, { ...this.env, EXO_USER_DATA_PATH: this.options.userDataPath });
  }

  async listWorkspaces(currentSettings?: WorkspaceSettings | null): Promise<WorkspaceRegistryEntry[]> {
    return listWorkspaceRegistryEntries({ ...this.env, EXO_USER_DATA_PATH: this.options.userDataPath }, currentSettings);
  }

  async getWorkspace(workspaceId: string): Promise<WorkspaceRegistryEntry | null> {
    return getWorkspaceRegistryEntry(workspaceId, { ...this.env, EXO_USER_DATA_PATH: this.options.userDataPath });
  }
}

export function applyWorkspaceSettingsToEnv(settings: WorkspaceSettings | null, env: NodeJS.ProcessEnv = process.env): void {
  if (!settings) {
    return;
  }

  Object.assign(env, workspaceSettingsToEnv(settings));
}

export function isForcedTheme(value: string | undefined): value is WorkspaceSettings["appearanceMode"] {
  return value === "light" || value === "dark" || value === "system";
}

export function resolveTerminalScrollbackLines(
  mode: WorkspaceSettings["terminalHistoryMode"],
  lines: number,
): number {
  return mode === "full" ? FULL_TERMINAL_SCROLLBACK_LINES : lines;
}

export function resolveTerminalBufferLineLimit(
  mode: WorkspaceSettings["terminalHistoryMode"],
  lines: number,
): number | null {
  return mode === "full" ? null : lines;
}

export function resolveTranscriptRetentionDays(settings: Pick<WorkspaceSettings, "terminalTranscriptRetention" | "terminalTranscriptRetentionDays">): number {
  return settings.terminalTranscriptRetention === "days" ? settings.terminalTranscriptRetentionDays : 0;
}

export function resolveTerminalRuntimePolicy(settings: WorkspaceSettings): TerminalRuntimePolicy {
  return {
    scrollbackLines: resolveTerminalScrollbackLines(settings.terminalHistoryMode, settings.terminalHistoryLines),
    bufferLineLimit: resolveTerminalBufferLineLimit(settings.terminalHistoryMode, settings.terminalHistoryLines),
    transcriptRetentionDays: resolveTranscriptRetentionDays(settings),
  };
}
