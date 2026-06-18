import {
  DEFAULT_APPEARANCE_MODE,
  DEFAULT_EDITOR_FONT_SIZE,
  DEFAULT_EXPLORER_SCALE,
  DEFAULT_TERMINAL_FONT_SIZE,
  DEFAULT_TERMINAL_AGENT_STARTUP_GRACE_MS,
  DEFAULT_TERMINAL_AGENT_SUBMIT_DELAY_MS,
  DEFAULT_TERMINAL_HISTORY_LINES,
  DEFAULT_TERMINAL_HISTORY_MODE,
  DEFAULT_TERMINAL_INITIAL_COLUMNS,
  DEFAULT_TERMINAL_INITIAL_ROWS,
  DEFAULT_TERMINAL_INPUT_COALESCE_MS,
  DEFAULT_TERMINAL_IDLE_THRESHOLD_MS,
  DEFAULT_TERMINAL_MAX_READ_TAIL_CHARS,
  DEFAULT_TERMINAL_MINIMUM_COLUMNS,
  DEFAULT_TERMINAL_MINIMUM_ROWS,
  DEFAULT_TERMINAL_READ_TAIL_CHARS,
  DEFAULT_TERMINAL_TRANSCRIPT_RETENTION,
  DEFAULT_TERMINAL_TRANSCRIPT_RETENTION_DAYS,
  DEFAULT_TERMINAL_UNRESPONSIVE_THRESHOLD_MS,
  MIN_TERMINAL_HISTORY_LINES,
  getWorkspaceRegistryEntry,
  listWorkspaceRegistryEntries,
  loadActiveWorkspaceSettings,
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
  DEFAULT_TERMINAL_AGENT_STARTUP_GRACE_MS,
  DEFAULT_TERMINAL_AGENT_SUBMIT_DELAY_MS,
  DEFAULT_TERMINAL_HISTORY_LINES,
  DEFAULT_TERMINAL_HISTORY_MODE,
  DEFAULT_TERMINAL_INITIAL_COLUMNS,
  DEFAULT_TERMINAL_INITIAL_ROWS,
  DEFAULT_TERMINAL_INPUT_COALESCE_MS,
  DEFAULT_TERMINAL_IDLE_THRESHOLD_MS,
  DEFAULT_TERMINAL_MAX_READ_TAIL_CHARS,
  DEFAULT_TERMINAL_MINIMUM_COLUMNS,
  DEFAULT_TERMINAL_MINIMUM_ROWS,
  DEFAULT_TERMINAL_READ_TAIL_CHARS,
  DEFAULT_TERMINAL_TRANSCRIPT_RETENTION,
  DEFAULT_TERMINAL_TRANSCRIPT_RETENTION_DAYS,
  DEFAULT_TERMINAL_UNRESPONSIVE_THRESHOLD_MS,
  MIN_TERMINAL_HISTORY_LINES,
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
  inputCoalesceMs: number;
  agentStartupGraceMs: number;
  agentSubmitDelayMs: number;
  initialColumns: number;
  initialRows: number;
  minimumColumns: number;
  minimumRows: number;
  readTailChars: number;
  maxReadTailChars: number;
  unresponsiveThresholdMs: number;
  idleThresholdMs: number;
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
      terminalInputCoalesceMs: DEFAULT_TERMINAL_INPUT_COALESCE_MS,
      terminalAgentStartupGraceMs: DEFAULT_TERMINAL_AGENT_STARTUP_GRACE_MS,
      terminalAgentSubmitDelayMs: DEFAULT_TERMINAL_AGENT_SUBMIT_DELAY_MS,
      terminalInitialColumns: DEFAULT_TERMINAL_INITIAL_COLUMNS,
      terminalInitialRows: DEFAULT_TERMINAL_INITIAL_ROWS,
      terminalMinimumColumns: DEFAULT_TERMINAL_MINIMUM_COLUMNS,
      terminalMinimumRows: DEFAULT_TERMINAL_MINIMUM_ROWS,
      terminalReadTailChars: DEFAULT_TERMINAL_READ_TAIL_CHARS,
      terminalMaxReadTailChars: DEFAULT_TERMINAL_MAX_READ_TAIL_CHARS,
      terminalUnresponsiveThresholdMs: DEFAULT_TERMINAL_UNRESPONSIVE_THRESHOLD_MS,
      terminalIdleThresholdMs: DEFAULT_TERMINAL_IDLE_THRESHOLD_MS,
      explorerScale: DEFAULT_EXPLORER_SCALE,
      exploreIndexSearchOnEnter: model.indexing.enabled && model.indexing.mode !== "off" && model.indexedRoots.length > 0,
      indexUpdateStrategy: "on-save",
    };
  }

  async load(): Promise<WorkspaceSettings | null> {
    return loadActiveWorkspaceSettings({ ...this.env, EXO_USER_DATA_PATH: this.options.userDataPath });
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
  _mode: WorkspaceSettings["terminalHistoryMode"],
  lines: number,
): number {
  return Math.max(MIN_TERMINAL_HISTORY_LINES, Math.floor(lines));
}

export function resolveTerminalBufferLineLimit(
  _mode: WorkspaceSettings["terminalHistoryMode"],
  lines: number,
): number {
  return Math.max(MIN_TERMINAL_HISTORY_LINES, Math.floor(lines));
}

export function resolveTranscriptRetentionDays(settings: Pick<WorkspaceSettings, "terminalTranscriptRetention" | "terminalTranscriptRetentionDays">): number {
  return settings.terminalTranscriptRetention === "days" ? settings.terminalTranscriptRetentionDays : 0;
}

export function resolveTerminalRuntimePolicy(settings: WorkspaceSettings): TerminalRuntimePolicy {
  return {
    scrollbackLines: resolveTerminalScrollbackLines(settings.terminalHistoryMode, settings.terminalHistoryLines),
    bufferLineLimit: resolveTerminalBufferLineLimit(settings.terminalHistoryMode, settings.terminalHistoryLines),
    transcriptRetentionDays: resolveTranscriptRetentionDays(settings),
    inputCoalesceMs: settings.terminalInputCoalesceMs ?? DEFAULT_TERMINAL_INPUT_COALESCE_MS,
    agentStartupGraceMs: settings.terminalAgentStartupGraceMs ?? DEFAULT_TERMINAL_AGENT_STARTUP_GRACE_MS,
    agentSubmitDelayMs: settings.terminalAgentSubmitDelayMs ?? DEFAULT_TERMINAL_AGENT_SUBMIT_DELAY_MS,
    initialColumns: settings.terminalInitialColumns ?? DEFAULT_TERMINAL_INITIAL_COLUMNS,
    initialRows: settings.terminalInitialRows ?? DEFAULT_TERMINAL_INITIAL_ROWS,
    minimumColumns: settings.terminalMinimumColumns ?? DEFAULT_TERMINAL_MINIMUM_COLUMNS,
    minimumRows: settings.terminalMinimumRows ?? DEFAULT_TERMINAL_MINIMUM_ROWS,
    readTailChars: settings.terminalReadTailChars ?? DEFAULT_TERMINAL_READ_TAIL_CHARS,
    maxReadTailChars: Math.max(
      settings.terminalReadTailChars ?? DEFAULT_TERMINAL_READ_TAIL_CHARS,
      settings.terminalMaxReadTailChars ?? DEFAULT_TERMINAL_MAX_READ_TAIL_CHARS,
    ),
    unresponsiveThresholdMs: settings.terminalUnresponsiveThresholdMs ?? DEFAULT_TERMINAL_UNRESPONSIVE_THRESHOLD_MS,
    idleThresholdMs: settings.terminalIdleThresholdMs ?? DEFAULT_TERMINAL_IDLE_THRESHOLD_MS,
  };
}
