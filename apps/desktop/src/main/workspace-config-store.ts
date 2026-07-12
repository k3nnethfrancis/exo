import {
  DEFAULT_APPEARANCE_MODE,
  DEFAULT_COLOR_THEME_ID,
  DEFAULT_EDITOR_FONT_SIZE,
  DEFAULT_EXPLORER_SCALE,
  DEFAULT_TERMINAL_FONT_SIZE,
  getWorkspaceRegistryEntry,
  listWorkspaceRegistryEntries,
  loadActiveWorkspaceSettings,
  legacyProjectRootsInPersistence,
  normalizeWorkspaceSettings,
  resolveWorkspaceSettingsPath,
  saveWorkspaceSettings,
  workspaceSettingsRevision,
  type WorkspaceModel,
  type WorkspaceRegistryEntry,
  type WorkspaceSettings,
  type WorkspaceSettingsRevision,
  type WorkspaceSettingsSnapshot,
} from "@exo/core";

export interface WorkspaceConfigStoreOptions {
  userDataPath: string;
  env?: NodeJS.ProcessEnv;
}

export class WorkspaceConfigConflictError extends Error {
  readonly code = "workspace-settings-stale";

  constructor(readonly expectedRevision: WorkspaceSettingsRevision, readonly actualRevision: WorkspaceSettingsRevision) {
    super("Workspace settings changed since this edit began. Reload settings and try again.");
    this.name = "WorkspaceConfigConflictError";
  }
}

// One main-process writer per settings file. Persistence itself (including 0600
// atomic writes and recovery) is intentionally hidden behind this module.
const writes = new Map<string, Promise<void>>();

export class WorkspaceConfigStore {
  private readonly env: NodeJS.ProcessEnv;
  private current: WorkspaceSettingsSnapshot | null = null;
  private loggedProjectRootNormalization = false;

  constructor(private readonly options: WorkspaceConfigStoreOptions) {
    this.env = options.env ?? process.env;
  }

  async load(): Promise<WorkspaceSettingsSnapshot | null> {
    await (writes.get(this.path()) ?? Promise.resolve());
    const env = this.persistenceEnv();
    const droppedProjectRoots = await legacyProjectRootsInPersistence(env);
    const settings = await loadActiveWorkspaceSettings(env);
    if (!this.loggedProjectRootNormalization && droppedProjectRoots.length > 0) {
      this.loggedProjectRootNormalization = true;
      console.info("[exo] normalized retired project roots", { droppedProjectRoots });
    }
    this.current = settings ? { settings, revision: workspaceSettingsRevision(settings) } : null;
    return this.current;
  }

  patch(expectedRevision: WorkspaceSettingsRevision, ownedPatch: Partial<WorkspaceSettings>): Promise<WorkspaceSettingsSnapshot> {
    const path = this.path();
    const operation = (writes.get(path) ?? Promise.resolve()).then(async () => {
      const currentSettings = await loadActiveWorkspaceSettings(this.persistenceEnv());
      const loaded = currentSettings ? { settings: currentSettings, revision: workspaceSettingsRevision(currentSettings) } : null;
      const actualRevision = loaded?.revision ?? null;
      if (actualRevision !== expectedRevision) {
        throw new WorkspaceConfigConflictError(expectedRevision, actualRevision);
      }
      const settings = normalizeWorkspaceSettings({ ...loaded?.settings, ...ownedPatch });
      if (!settings) {
        throw new Error("Workspace settings are incomplete.");
      }
      const saved = await saveWorkspaceSettings(settings, this.persistenceEnv());
      this.current = { settings: saved, revision: workspaceSettingsRevision(saved) };
      return this.current;
    });
    writes.set(path, operation.then(() => undefined, () => undefined));
    return operation;
  }

  async listWorkspaces(): Promise<WorkspaceRegistryEntry[]> {
    return listWorkspaceRegistryEntries(this.persistenceEnv(), this.current?.settings ?? (await this.load())?.settings);
  }

  async switchWorkspace(workspaceId: string, expectedRevision: WorkspaceSettingsRevision): Promise<WorkspaceSettingsSnapshot> {
    const workspace = await getWorkspaceRegistryEntry(workspaceId, this.persistenceEnv());
    if (!workspace) {
      throw new Error("Workspace not found.");
    }
    return this.patch(expectedRevision, workspace.settings);
  }

  private path(): string {
    return resolveWorkspaceSettingsPath(this.persistenceEnv());
  }

  private persistenceEnv(): NodeJS.ProcessEnv {
    return { ...this.env, EXO_USER_DATA_PATH: this.options.userDataPath };
  }
}


// Composition-root helper: configuration is data, never an environment projection.
export function workspaceSettingsFromModel(model: WorkspaceModel): WorkspaceSettings {
  return {
      workspaceRoot: model.workspaceRoot,
      defaultTerminalCwd: model.defaultTerminalCwd,
      noteRoots: model.noteRoots.map((root) => root.path),
      indexedRoots: model.indexedRoots,
      indexing: model.indexing,
      appearanceMode: DEFAULT_APPEARANCE_MODE,
      colorThemeId: DEFAULT_COLOR_THEME_ID,
      editorFontSize: DEFAULT_EDITOR_FONT_SIZE,
      terminalFontSize: DEFAULT_TERMINAL_FONT_SIZE,
      explorerScale: DEFAULT_EXPLORER_SCALE,
      exploreIndexSearchOnEnter: model.indexing.enabled && model.indexing.mode !== "off" && model.indexedRoots.length > 0,
      indexUpdateStrategy: "on-save",
  };

}
