import {
  DEFAULT_APPEARANCE_MODE,
  DEFAULT_COLOR_THEME_ID,
  DEFAULT_EDITOR_FONT_SIZE,
  DEFAULT_EXPLORER_SCALE,
  DEFAULT_TERMINAL_FONT_SIZE,
  DEFAULT_TERMINAL_AGENT_STARTUP_GRACE_MS,
  DEFAULT_TERMINAL_AGENT_SUBMIT_DELAY_MS,
  DEFAULT_TERMINAL_HISTORY_LINES,
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
  workspaceSettingsRevision,
  workspaceSettingsToEnv,
  type WorkspaceModel,
  type WorkspaceRegistryEntry,
  type WorkspaceSettings,
  type WorkspaceSettingsRevision,
  type WorkspaceSettingsSaveRequest,
  type WorkspaceSettingsSnapshot,
} from "@exo/core";
import { createHash } from "node:crypto";
import path from "node:path";

export {
  DEFAULT_APPEARANCE_MODE,
  DEFAULT_EDITOR_FONT_SIZE,
  DEFAULT_EXPLORER_SCALE,
  DEFAULT_TERMINAL_FONT_SIZE,
  DEFAULT_TERMINAL_AGENT_STARTUP_GRACE_MS,
  DEFAULT_TERMINAL_AGENT_SUBMIT_DELAY_MS,
  DEFAULT_TERMINAL_HISTORY_LINES,
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

export class WorkspaceSettingsConflictError extends Error {
  readonly code = "workspace-settings-stale";

  constructor(
    readonly expectedRevision: WorkspaceSettingsRevision,
    readonly actualRevision: WorkspaceSettingsRevision,
  ) {
    super("Workspace settings changed since this edit began. Reload settings and try again.");
    this.name = "WorkspaceSettingsConflictError";
  }
}

const PI_HARNESS_ENV_KEYS = [
  "EXO_PI_ENABLED",
  "EXO_PI_LABEL",
  "EXO_PI_COMMAND",
  "EXO_PI_REPO_PATH",
  "EXO_PI_ARGS",
  "EXO_PI_CHANNEL",
  "EXO_PI_BUILD",
  "EXO_PI_BACKEND_URL",
  "EXO_PI_BACKEND_COMMAND",
  "EXO_PI_BACKEND_LABEL",
  "EXO_PI_BACKEND_KIND",
  "EXO_PI_BACKEND_READY",
] as const;

const initialPiHarnessEnvOverrides = new Map(
  PI_HARNESS_ENV_KEYS
    .filter((key) => process.env[key] !== undefined)
    .map((key) => [key, process.env[key] as string]),
);
const initialTmuxServerNameOverride = process.env.EXO_TMUX_SERVER_NAME;

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

// The desktop main process is the single settings writer. This per-path queue
// also serializes accidental duplicate store instances within that process.
const settingsSaveQueues = new Map<string, Promise<void>>();

export class WorkspaceSettingsStore {
  private readonly env: NodeJS.ProcessEnv;
  private revision: WorkspaceSettingsRevision = null;

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
      colorThemeId: DEFAULT_COLOR_THEME_ID,
      editorFontSize: DEFAULT_EDITOR_FONT_SIZE,
      terminalFontSize: DEFAULT_TERMINAL_FONT_SIZE,
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

  async load(): Promise<WorkspaceSettingsSnapshot | null> {
    await currentSettingsSave(this.resolvePath());
    const settings = await this.loadCurrentSettings();
    this.revision = workspaceSettingsRevision(settings);
    return settings ? { settings, revision: this.revision } : null;
  }

  save(request: WorkspaceSettingsSaveRequest): Promise<WorkspaceSettingsSnapshot> {
    return enqueueSettingsSave(this.resolvePath(), async () => {
      const actual = await this.loadCurrentRevision();
      if (actual !== request.expectedRevision) {
        throw new WorkspaceSettingsConflictError(request.expectedRevision, actual);
      }
      const settings = await saveWorkspaceSettings(request.settings, this.persistenceEnv());
      this.revision = workspaceSettingsRevision(settings);
      return { settings, revision: this.revision };
    });
  }

  currentRevision(): WorkspaceSettingsRevision {
    return this.revision;
  }

  async listWorkspaces(currentSettings?: WorkspaceSettings | null): Promise<WorkspaceRegistryEntry[]> {
    return listWorkspaceRegistryEntries({ ...this.env, EXO_USER_DATA_PATH: this.options.userDataPath }, currentSettings);
  }

  async getWorkspace(workspaceId: string): Promise<WorkspaceRegistryEntry | null> {
    return getWorkspaceRegistryEntry(workspaceId, { ...this.env, EXO_USER_DATA_PATH: this.options.userDataPath });
  }

  private loadCurrentSettings(): Promise<WorkspaceSettings | null> {
    return loadActiveWorkspaceSettings(this.persistenceEnv());
  }

  private async loadCurrentRevision(): Promise<WorkspaceSettingsRevision> {
    return workspaceSettingsRevision(await this.loadCurrentSettings());
  }

  private persistenceEnv(): NodeJS.ProcessEnv {
    return { ...this.env, EXO_USER_DATA_PATH: this.options.userDataPath };
  }
}

function currentSettingsSave(settingsPath: string): Promise<void> {
  return settingsSaveQueues.get(settingsPath) ?? Promise.resolve();
}

function enqueueSettingsSave<Result>(settingsPath: string, operation: () => Promise<Result>): Promise<Result> {
  const result = currentSettingsSave(settingsPath).then(operation);
  settingsSaveQueues.set(settingsPath, result.then(() => undefined, () => undefined));
  return result;
}

export function applyWorkspaceSettingsToEnv(settings: WorkspaceSettings | null, env: NodeJS.ProcessEnv = process.env): void {
  if (!settings) {
    return;
  }

  const settingsEnv = workspaceSettingsToEnv(settings);
  Object.assign(env, settingsEnv);
  if (env === process.env && initialTmuxServerNameOverride !== undefined) {
    env.EXO_TMUX_SERVER_NAME = initialTmuxServerNameOverride;
  } else {
    // Exo owns a tmux namespace per workspace. This keeps a user's unrelated
    // default tmux server crash/config from breaking Exo terminal sessions.
    env.EXO_TMUX_SERVER_NAME = exoTmuxServerNameForWorkspace(settings.workspaceRoot);
  }
  for (const key of PI_HARNESS_ENV_KEYS) {
    const operatorValue = env === process.env ? initialPiHarnessEnvOverrides.get(key) : undefined;
    if (operatorValue !== undefined) {
      env[key] = operatorValue;
    } else if (!(key in settingsEnv)) {
      delete env[key];
    }
  }
}

export function exoTmuxServerNameForWorkspace(workspaceRoot: string): string {
  const workspaceHash = createHash("sha256").update(path.resolve(workspaceRoot)).digest("hex").slice(0, 10);
  return `exo-${workspaceHash}`;
}

export function isForcedTheme(value: string | undefined): value is WorkspaceSettings["appearanceMode"] {
  return value === "light" || value === "dark" || value === "system";
}

export function resolveTerminalScrollbackLines(lines: number): number {
  return Math.max(MIN_TERMINAL_HISTORY_LINES, Math.floor(lines));
}

export function resolveTerminalBufferLineLimit(lines: number): number {
  return Math.max(MIN_TERMINAL_HISTORY_LINES, Math.floor(lines));
}

export function resolveTranscriptRetentionDays(settings: Pick<WorkspaceSettings, "terminalTranscriptRetention" | "terminalTranscriptRetentionDays">): number {
  return settings.terminalTranscriptRetention === "days" ? settings.terminalTranscriptRetentionDays : 0;
}

export function resolveTerminalRuntimePolicy(settings: WorkspaceSettings): TerminalRuntimePolicy {
  return {
    scrollbackLines: resolveTerminalScrollbackLines(settings.terminalHistoryLines),
    bufferLineLimit: resolveTerminalBufferLineLimit(settings.terminalHistoryLines),
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
