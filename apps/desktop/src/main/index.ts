import { app, nativeTheme, powerMonitor } from "electron";
import path from "node:path";
import { existsSync } from "node:fs";
import { appendFile, mkdir, stat } from "node:fs/promises";
import { fileURLToPath } from "node:url";

import {
  createWorkspaceDirectory,
  createWorkspaceFile,
  createBranchFile,
  deleteWorkspacePath,
  listRootTree,
  listPluginInventory,
  addLocalPlugin,
  applyPluginStateAction,
  copyProfileToWorkspacePlugin,
  discoverManagedPlugins,
  planProfilePreview,
  profileFromCapability,
  readIndexDocument,
  readManagedPluginSettings,
  readProfileStateStore,
  readWorkspaceDocument,
  renameWorkspacePath,
  resetManagedPluginSettings,
  removeLocalPlugin,
  replaceLocalPlugin,
  resolveRuntimeConfig,
  resolveWorkspaceModel,
  saveWorkspaceDocument,
  searchIndex,
  searchNotes,
  searchWorkspace,
  clearActiveProfile,
  markProfileReviewRequired,
  setActiveProfile,
  setProfileAutoUpdate,
  updateManagedPluginSettings,
  writeProfileStateStore,
  type DiscoveredPlugin,
  type IndexStatus,
  type ManagedAgentKind,
  type ActiveProfileIdentity,
  type CapabilityMetadata,
  type PluginInventoryItem,
  type PluginInventoryReadinessSummary,
  type PluginStateAction,
  type WorkspaceModel,
  type WorkspaceSettings,
} from "@exo/core";

import type { WorkspacePluginActionInput, WorkspacePluginSettingsInput } from "../shared/api";
import type { DesktopEventChannel, DesktopEventPayloads } from "../shared/desktop-ipc";
import { AgentInstructionsService } from "./agent-instructions-service";
import { AgentSkillsService } from "./agent-skills-service";
import { AppLifecycleController } from "./app-lifecycle";
import { CommandServer } from "./command-server";
import { IndexingService } from "./indexing-service";
import {
  applyWorkspaceSettingsToEnv,
  DEFAULT_APPEARANCE_MODE,
  isForcedTheme,
  resolveTerminalRuntimePolicy,
  WorkspaceSettingsStore,
} from "./settings-store";
import { registerTerminalIpcHandlers } from "./terminal-ipc";
import { TerminalManager } from "./terminal-manager";
import { registerTerminalRecoveryService } from "./terminal-recovery-service";
import { registerWorkspaceIpcHandlers } from "./workspace-ipc";
import { ProjectReviewService } from "./project-review-service";
import { resolvePreviewTarget } from "./preview-target";
import { WorkspaceNotesService } from "./workspace-notes-service";
import { WorkspaceSettingsService } from "./workspace-settings-service";
import { WorkspaceWatcherService } from "./workspace-watchers";

const currentDirectory = path.dirname(fileURLToPath(import.meta.url));
const sourceProjectRoot = resolveSourceProjectRoot();

if (process.env.EXO_ENABLE_GPU !== "1") {
  app.disableHardwareAcceleration();
  app.commandLine.appendSwitch("disable-gpu");
  app.commandLine.appendSwitch("disable-gpu-compositing");
  app.commandLine.appendSwitch("disable-zero-copy");
}

if (process.env.EXO_USER_DATA_PATH) {
  app.setPath("userData", process.env.EXO_USER_DATA_PATH);
}

process.on("uncaughtException", (error) => {
  logMain("uncaught exception", serializeError(error));
});

process.on("unhandledRejection", (reason) => {
  logMain("unhandled rejection", serializeError(reason));
});

const singleInstanceLock = app.requestSingleInstanceLock(resolveSingleInstanceData());

let appLifecycle: AppLifecycleController;
let commandServer: CommandServer | null = null;
let workspaceModel: WorkspaceModel;
let workspaceSettings: WorkspaceSettings | null = null;
let workspaceSettingsStore: WorkspaceSettingsStore;
let workspaceSetupComplete = false;
let terminalManager: TerminalManager;
let workspaceWatcherService: WorkspaceWatcherService;
let indexingService: IndexingService;
let workspaceNotesService: WorkspaceNotesService;
let projectReviewService: ProjectReviewService;
let agentInstructionsService: AgentInstructionsService;
let agentSkillsService: AgentSkillsService;
let workspaceSettingsService: WorkspaceSettingsService;

if (!singleInstanceLock) {
  console.error(
    "[exo] another Exo instance is already running; this dev process will exit after asking the running app to focus and refresh command-server discovery.",
  );
  app.quit();
}

function startCommandServer() {
  const runtimeConfig = resolveRuntimeConfig();

  commandServer?.stop();
  const nextCommandServer = new CommandServer({
    runtimeRoot: runtimeConfig.runtimeRoot,
    onShowWindow: () => appLifecycle.showMainWindow(),
    onOpenFile: (filePath: string) => {
      sendToRenderer("command:open-file", filePath);
    },
    onOpenPreview: async (target: string) => {
      const result = await resolvePreviewTarget(target, workspaceSettingsService.currentSettings());
      appLifecycle.showMainWindow();
      sendToRenderer("command:open-preview", { url: result.url });
      return result;
    },
    onFocusPreview: () => {
      appLifecycle.showMainWindow();
      sendToRenderer("command:focus-preview", undefined);
      return { ok: true };
    },
    onClosePreview: () => {
      sendToRenderer("command:close-preview", undefined);
      return { ok: true };
    },
    onSearch: (query: string) => searchWorkspace(workspaceModel, query),
    onIndexSearch: (query, options) => searchIndex(workspaceModel, resolveRuntimeConfig().runtimeRoot, query, options),
    onReadDocument: (target, options) => readIndexDocument(workspaceModel, resolveRuntimeConfig().runtimeRoot, target, options),
    onIndexStatus: () => indexingService.getMeasuredStatus(),
    onIndexAddRoot: (input) => indexingService.addRoot(input),
    onIndexRemoveRoot: (target) => indexingService.removeRoot(target),
    onIndexSync: () => indexingService.runSync("command"),
    onIndexUpdate: () => indexingService.update("command"),
    onIndexEmbed: () => indexingService.embed("command"),
    onListProjectRoots: () => workspaceSettingsService.currentSettings().projectRoots,
    onAddProjectRoot: (input) => workspaceSettingsService.addProjectRoot(input.path),
    onRemoveProjectRoot: (target) => workspaceSettingsService.removeProjectRoot(target),
    onListTerminals: () => terminalManager.list(),
    onTerminalDiagnostics: () => terminalManager.diagnostics(),
    onCreateTerminal: (kind: string, cwd?: string) =>
      terminalManager.create({ kind: kind as ManagedAgentKind, cwd }),
    onReadTerminalTail: (id: string, options?: { maxLines?: number }) => terminalManager.readTail(id, options),
    onReadTerminalTranscript: (id: string, tailChars: number) => terminalManager.readTranscript(id, tailChars),
    onWriteTerminal: (id: string, data: string) => terminalManager.write(id, data),
    onSendTerminalMessage: (id: string, message: string, submit: boolean) => terminalManager.sendMessage(id, message, submit),
    onReconnectTerminal: (id: string) => terminalManager.reconnect(id),
    onKillTerminal: (id: string) => terminalManager.kill(id),
    onGetSettings: () => workspaceSettingsService.currentSettings(),
    onGetStatus: () => ({
      workspace: workspaceModel,
      terminals: terminalManager.list(),
    }),
  });
  commandServer = nextCommandServer;

  nextCommandServer.start().then((port) => {
    logMain("command server started", { runtimeRoot: runtimeConfig.runtimeRoot, port });
  }).catch((error) => {
    if (commandServer === nextCommandServer) {
      commandServer = null;
    }
    console.error("Failed to start command server:", error);
    logMain("command server start failed", serializeError(error));
  });
}

async function refreshCommandServerDiscovery(reason: string): Promise<void> {
  if (!commandServer?.isListening()) {
    console.warn(`[exo] command server was not listening during ${reason}; restarting it.`);
    logMain("command server discovery refresh restarting server", { reason });
    startCommandServer();
    return;
  }

  try {
    const info = await commandServer.ensureDiscoveryFile();
    console.info(`[exo] command server discovery refreshed for ${reason}: ${info.path} (port ${info.port})`);
    logMain("command server discovery refreshed", { reason, path: info.path, port: info.port });
  } catch (error) {
    console.error(`[exo] failed to refresh command server discovery for ${reason}:`, error);
    logMain("command server discovery refresh failed", { reason, error: serializeError(error) });
  }
}

function resolveSingleInstanceData(): Record<string, string | number> {
  const runtimeConfig = resolveRuntimeConfig();
  return {
    pid: process.pid,
    runtimeRoot: runtimeConfig.runtimeRoot,
    workspaceRoot: runtimeConfig.workspace.workspaceRoot,
  };
}

function extractRuntimeRoot(value: unknown): string | undefined {
  if (!value || typeof value !== "object") {
    return undefined;
  }
  const runtimeRoot = (value as { runtimeRoot?: unknown }).runtimeRoot;
  return typeof runtimeRoot === "string" ? runtimeRoot : undefined;
}

function logWorkspaceStartup(model: WorkspaceModel) {
  if (process.env.NODE_ENV === "production") {
    return;
  }

  const details = {
    workspaceRoot: model.workspaceRoot,
    defaultTerminalCwd: model.defaultTerminalCwd,
    noteRoots: model.noteRoots.map((root) => root.path),
    projectRoots: model.projectRoots.map((root) => root.path),
    userDataPath: app.getPath("userData"),
    settingsPath: workspaceSettingsStore.resolvePath(),
    gpuDisabled: process.env.EXO_ENABLE_GPU !== "1",
  };
  console.info("[exo] workspace startup", details);
  logMain("workspace startup", details);
}

function createFirstRunWorkspaceModel(): WorkspaceModel {
  const userDataRoot = app.getPath("userData");
  const homeRoot = app.getPath("home");
  const notesRoot = path.join(userDataRoot, "onboarding-notes");

  return {
    workspaceRoot: userDataRoot,
    defaultTerminalCwd: homeRoot,
    noteRoots: [
      {
        id: "note-root-1",
        label: "onboarding-notes",
        path: notesRoot,
        kind: "notes",
      },
    ],
    projectRoots: [],
    indexedRoots: [],
    indexing: {
      enabled: false,
      mode: "off",
      backend: "qmd",
    },
    attachedWorkcells: [],
  };
}

function broadcastTerminalData() {
  terminalManager.on("created", (session) => {
    sendToRenderer("terminal:created", session);
  });
  terminalManager.on("data", (event) => {
    sendToRenderer("terminal:data", event);
  });
  terminalManager.on("exit", (event) => {
    sendToRenderer("terminal:exit", event);
  });
}

function sendToRenderer<C extends DesktopEventChannel>(channel: C, payload: DesktopEventPayloads[C]) {
  const mainWindow = appLifecycle.getMainWindow();
  if (!appLifecycle.isRendererReady() || !mainWindow || mainWindow.isDestroyed() || mainWindow.webContents.isDestroyed()) {
    return;
  }

  try {
    mainWindow.webContents.send(channel, payload);
  } catch (err) {
    console.warn(`[main] failed to send ${channel}:`, err);
  }
}

function logMain(message: string, details?: unknown) {
  const line = `${new Date().toISOString()} ${message}${details === undefined ? "" : ` ${JSON.stringify(details)}`}\n`;
  const logPath = path.join(app.getPath("userData"), "exo-main.log");
  appendFile(logPath, line, "utf8").catch(() => {});
}

function serializeError(error: unknown): unknown {
  if (error instanceof Error) {
    return {
      name: error.name,
      message: error.message,
      stack: error.stack,
    };
  }

  return error;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function registerIpcHandlers() {
  registerWorkspaceIpcHandlers({
    activateWorkspace: async (workspaceId) => {
      const entry = await workspaceSettingsStore.getWorkspace(workspaceId);
      if (!entry) {
        throw new Error("Workspace not found.");
      }
      return workspaceSettingsService.saveSettings(entry.settings);
    },
    createBranch: (filePath, frontmatter, body) =>
      createBranchFile(
        filePath,
        {
          filePath,
          title: typeof frontmatter.title === "string" ? frontmatter.title : path.basename(filePath, path.extname(filePath)),
          frontmatter,
          body,
          kind: "markdown",
        },
        workspaceModel.noteRoots.map((root) => root.path),
      ),
    createDirectory: createWorkspaceDirectory,
    createFile: createWorkspaceFile,
    deletePath: deleteWorkspacePath,
    embedIndex: () => indexingService.embed("settings"),
    ensureTarget: (sourceFilePath, target) => workspaceNotesService.ensureTarget(sourceFilePath, target),
    getAgentInstructionConfig: () => agentInstructionsService.getConfig(),
    listAgentHarnesses: async () => terminalManager.getRuntimeConfig().harnesses,
    listPluginInventory: () => readPluginInventory(),
    enablePlugin: (input) => updatePluginState("enable", input),
    disablePlugin: (input) => updatePluginState("disable", input),
    trustPlugin: (input) => updatePluginState("trust", input),
    addLocalPlugin: (input) => addWorkspaceLocalPlugin(input),
    removeLocalPlugin: (input) => removeWorkspaceLocalPlugin(input),
    replaceLocalPlugin: (input) => replaceWorkspaceLocalPlugin(input),
    readPluginSettings: (input) => readPluginSettings(input),
    updatePluginSettings: (input) => updatePluginSettings(input),
    resetPluginSettings: (input) => resetPluginSettings(input),
    getBranchFamily: (filePath) => workspaceNotesService.getBranchFamily(filePath),
    getGitStatus: (rootPath) => projectReviewService.getGitStatus(rootPath),
    getIndexStatus: () => indexingService.getMeasuredStatus(),
    getKnowledge: (filePath) => workspaceNotesService.getKnowledge(filePath),
    getMainWindow: () => appLifecycle.getMainWindow(),
    getModel: () => workspaceModel,
    getRuntimeStatus: () => terminalManager.getRuntimeConfig(),
    getSettings: () => workspaceSettingsService.currentSettings(),
    getSetupState: () => ({
      complete: workspaceSetupComplete,
      settingsPath: workspaceSettingsStore.resolvePath(),
    }),
    addAgentSkillSource: (input) => agentSkillsService.addSkillSource(input),
    installAgentLibrarySkill: (input) => agentSkillsService.installLibrarySkill(input),
    listAgentInstructionOverlays: () => agentInstructionsService.listOverlays(),
    listAgentSkills: () => agentSkillsService.listInventory(),
    listTree: listRootTree,
    listWorkspaces: () => workspaceSettingsStore.listWorkspaces(workspaceSettings),
    readAgentSkillFile: (skillId, relativePath) => agentSkillsService.readSkillFile(skillId, relativePath),
    getProfileState: () => readWorkspaceProfileState(),
    setActiveProfile: (input) => setWorkspaceActiveProfile(input),
    clearActiveProfile: () => clearWorkspaceActiveProfile(),
    setProfileAutoUpdate: (input) => setWorkspaceProfileAutoUpdate(input.autoUpdate),
    markProfileReviewRequired: (input) => markWorkspaceProfileReviewRequired(input.reviewRequired),
    previewProfile: (input) => previewWorkspaceProfile(input),
    copyProfile: (input) => copyWorkspaceProfile(input),
    readNote: readWorkspaceDocument,
    renamePath: renameWorkspacePath,
    resolveTarget: (sourceFilePath, target) => workspaceNotesService.resolveTarget(sourceFilePath, target),
    saveAgentInstructionConfig: (input) => agentInstructionsService.saveConfig(input),
    saveAgentSkillFile: (skillId, relativePath, body) => agentSkillsService.saveSkillFile(skillId, relativePath, body),
    saveNote: async (filePath, frontmatter, body) => {
      await saveWorkspaceDocument(filePath, frontmatter, body);
      indexingService.scheduleForFile(filePath, "note-save");
    },
    saveSettings: (settings) => workspaceSettingsService.saveSettings(settings),
    searchIndex: (query, options) => searchIndex(workspaceModel, resolveRuntimeConfig().runtimeRoot, query, options),
    searchNotes: (query) => searchNotes(workspaceModel, query),
    searchTag: (tag) => workspaceNotesService.searchTag(tag),
    searchWorkspace: (query) => searchWorkspace(workspaceModel, query),
    setAgentSkillEnabled: (input) => agentSkillsService.setSkillEnabled(input),
    statNote: async (filePath) => {
      try {
        const info = await stat(filePath);
        return { size: info.size, mtimeMs: info.mtimeMs };
      } catch {
        return null;
      }
    },
    suggestTargets: (sourceFilePath, query) => workspaceNotesService.suggestTargets(sourceFilePath, query),
    syncAgentSkillSource: (sourceId) => agentSkillsService.syncSkillSource(sourceId),
    syncIndex: () => indexingService.runSync("settings"),
    syncRuntime: () => terminalManager.syncRuntimeContext(),
    updateIndex: () => indexingService.update("settings"),
  });
  registerTerminalIpcHandlers(terminalManager);
}

async function readPluginInventory() {
  const readinessByCapabilityId = await pluginReadinessByCapabilityId();
  return listPluginInventory({
    workspaceRoot: workspaceModel.workspaceRoot,
    runtimeRoot: terminalManager.getRuntimeConfig().runtimeRoot,
    env: pluginDiscoveryEnv(),
    harnesses: terminalManager.getRuntimeConfig().harnesses,
    readinessByCapabilityId,
  });
}

async function pluginReadinessByCapabilityId(): Promise<Record<string, PluginInventoryReadinessSummary>> {
  try {
    const status = await indexingService.getMeasuredStatus();
    return { qmd: qmdReadinessSummary(status) };
  } catch (error) {
    return {
      qmd: {
        state: "error",
        label: "Status unavailable",
        detail: errorMessage(error),
      },
    };
  }
}

function qmdReadinessSummary(status: IndexStatus): PluginInventoryReadinessSummary {
  if (!status.enabled || status.mode === "off") {
    return {
      state: "disabled",
      label: "Off",
      detail: "Advanced QMD search is disabled. Core filename/path/text search remains available.",
      metrics: qmdReadinessMetrics(status),
    };
  }
  if (status.indexedRoots.length === 0) {
    return {
      state: "needsSetup",
      label: "Needs indexed roots",
      detail: "Add at least one notes or project root to use this advanced search provider.",
      metrics: qmdReadinessMetrics(status),
    };
  }
  if (status.errors.length > 0) {
    return {
      state: "error",
      label: "Index error",
      detail: status.errors[0],
      metrics: qmdReadinessMetrics(status),
    };
  }
  if (status.pendingEmbeddings > 0) {
    return {
      state: "indexing",
      label: "Embeddings needed",
      detail: `${status.pendingEmbeddings} documents still need embeddings for semantic or hybrid search quality.`,
      metrics: qmdReadinessMetrics(status),
    };
  }
  if (status.warnings.length > 0 || (status.mode !== "lexical" && !status.hasVectorIndex)) {
    return {
      state: "degraded",
      label: "Degraded",
      detail: status.warnings[0] ?? "Vector search is not ready; lexical behavior may still work.",
      metrics: qmdReadinessMetrics(status),
    };
  }
  return {
    state: "ready",
    label: "Ready",
    detail: "Advanced QMD search is configured for this workspace.",
    metrics: qmdReadinessMetrics(status),
  };
}

function qmdReadinessMetrics(status: IndexStatus): PluginInventoryReadinessSummary["metrics"] {
  return [
    { label: "Mode", value: status.mode },
    { label: "Roots", value: status.indexedRoots.length },
    { label: "Documents", value: status.documentCount },
    { label: "Pending embeddings", value: status.pendingEmbeddings },
    { label: "Vector index", value: status.hasVectorIndex ? "ready" : "not ready" },
  ];
}

async function updatePluginState(
  action: PluginStateAction,
  input: WorkspacePluginActionInput,
) {
  await applyPluginStateAction({
    workspaceRoot: workspaceModel.workspaceRoot,
    runtimeRoot: terminalManager.getRuntimeConfig().runtimeRoot,
    pluginId: input.capabilityId ?? input.pluginId,
    action,
    source: input.source,
    manifestPath: input.manifestPath,
    rootDirectory: input.rootDirectory,
    env: pluginDiscoveryEnv(),
  });
  return readPluginInventory();
}

async function addWorkspaceLocalPlugin(input: { sourceDirectory: string; target: "user" | "workspace" }) {
  await addLocalPlugin({
    workspaceRoot: workspaceModel.workspaceRoot,
    sourceDirectory: input.sourceDirectory,
    target: input.target,
    env: pluginDiscoveryEnv(),
  });
  return readPluginInventory();
}

async function removeWorkspaceLocalPlugin(input: WorkspacePluginActionInput) {
  await removeLocalPlugin({
    workspaceRoot: workspaceModel.workspaceRoot,
    plugin: {
      pluginId: input.pluginId,
      source: input.source,
      manifestPath: input.manifestPath,
      rootDirectory: input.rootDirectory,
    },
    env: pluginDiscoveryEnv(),
  });
  return readPluginInventory();
}

async function replaceWorkspaceLocalPlugin(input: {
  sourceDirectory: string;
  target: "user" | "workspace";
  existing: WorkspacePluginActionInput;
}) {
  await replaceLocalPlugin({
    workspaceRoot: workspaceModel.workspaceRoot,
    sourceDirectory: input.sourceDirectory,
    target: input.target,
    existing: {
      pluginId: input.existing.pluginId,
      source: input.existing.source,
      manifestPath: input.existing.manifestPath,
      rootDirectory: input.existing.rootDirectory,
    },
    env: pluginDiscoveryEnv(),
  });
  return readPluginInventory();
}

async function readPluginSettings(input: WorkspacePluginActionInput) {
  const options = pluginSettingsOptions(input);
  const result = await readManagedPluginSettings(options);
  return {
    ...result,
    schema: await requirePluginSettingsSchema(input),
    inventory: await readPluginInventory(),
  };
}

async function updatePluginSettings(input: WorkspacePluginSettingsInput) {
  const options = pluginSettingsOptions(input);
  const schema = await requireMutablePluginSettingsSchema(input);
  const result = await updateManagedPluginSettings({
    ...options,
    values: input.values ?? {},
  });
  return {
    ...result,
    schema,
    inventory: await readPluginInventory(),
  };
}

async function resetPluginSettings(input: WorkspacePluginActionInput) {
  const options = pluginSettingsOptions(input);
  const schema = await requireMutablePluginSettingsSchema(input);
  const result = await resetManagedPluginSettings(options);
  return {
    ...result,
    schema,
    inventory: await readPluginInventory(),
  };
}

function profileRuntimeRoot(): string {
  return terminalManager.getRuntimeConfig().runtimeRoot;
}

function profileStateNow(): string {
  return new Date().toISOString();
}

async function readWorkspaceProfileState() {
  return readProfileStateStore(profileRuntimeRoot());
}

async function setWorkspaceActiveProfile(input: ActiveProfileIdentity) {
  const store = await readWorkspaceProfileState();
  const nextStore = setActiveProfile(store, input, profileStateNow());
  await writeProfileStateStore(profileRuntimeRoot(), nextStore);
  return nextStore;
}

async function clearWorkspaceActiveProfile() {
  const store = await readWorkspaceProfileState();
  const nextStore = clearActiveProfile(store, profileStateNow());
  await writeProfileStateStore(profileRuntimeRoot(), nextStore);
  return nextStore;
}

async function setWorkspaceProfileAutoUpdate(autoUpdate: boolean) {
  const store = await readWorkspaceProfileState();
  const nextStore = setProfileAutoUpdate(store, autoUpdate, profileStateNow());
  await writeProfileStateStore(profileRuntimeRoot(), nextStore);
  return nextStore;
}

async function markWorkspaceProfileReviewRequired(reviewRequired: boolean) {
  const store = await readWorkspaceProfileState();
  const nextStore = markProfileReviewRequired(store, reviewRequired, profileStateNow());
  await writeProfileStateStore(profileRuntimeRoot(), nextStore);
  return nextStore;
}

async function copyWorkspaceProfile(input: ActiveProfileIdentity) {
  const result = await copyProfileToWorkspacePlugin({
    workspaceRoot: workspaceModel.workspaceRoot,
    runtimeRoot: profileRuntimeRoot(),
    sourceProfile: input,
    env: pluginDiscoveryEnv(),
  });
  return {
    ...result,
    inventory: await readPluginInventory(),
  };
}

async function previewWorkspaceProfile(input: ActiveProfileIdentity) {
  const inventory = await readPluginInventory();
  const item = inventory.items.find((candidate) => profileInventoryItemMatches(candidate, input));
  if (!item) {
    throw new Error(`Unable to find profile in current plugin inventory: ${input.profileId}`);
  }
  if (item.kind !== "profile") {
    throw new Error(`Selected capability is not a profile: ${input.capabilityId}`);
  }
  const profile = profileFromCapability(capabilityFromInventoryItem(item));
  if (!profile) {
    throw new Error(`Selected capability cannot be parsed as a profile: ${input.capabilityId}`);
  }
  return planProfilePreview(profile, inventory);
}

function profileInventoryItemMatches(item: PluginInventoryItem, identity: ActiveProfileIdentity): boolean {
  if (item.kind !== "profile") {
    return false;
  }
  const profileId = profileIdFromInventoryItem(item);
  return item.id === identity.capabilityId
    && profileId === identity.profileId
    && optionalIdentityMatch(item.pluginId, identity.pluginId)
    && optionalIdentityMatch(item.pluginSource, identity.source)
    && optionalIdentityMatch(item.manifestPath, identity.manifestPath)
    && optionalIdentityMatch(item.rootDirectory, identity.rootDirectory);
}

function profileIdFromInventoryItem(item: PluginInventoryItem): string {
  const profile = item.compatibility?.profile;
  if (profile && typeof profile === "object" && !Array.isArray(profile) && "id" in profile && typeof profile.id === "string") {
    return profile.id;
  }
  return item.id;
}

function optionalIdentityMatch(left: string | undefined, right: string | undefined): boolean {
  return !left || !right || left === right;
}

function capabilityFromInventoryItem(item: PluginInventoryItem): CapabilityMetadata {
  return {
    id: item.id,
    kind: "profile",
    label: item.label,
    description: item.description,
    lifecycle: item.lifecycle,
    owner: item.owner,
    surfaces: item.surfaces,
    permissions: item.permissions,
    compatibility: item.compatibility,
  };
}

function pluginSettingsOptions(input: WorkspacePluginActionInput) {
  return {
    workspaceRoot: workspaceModel.workspaceRoot,
    runtimeRoot: terminalManager.getRuntimeConfig().runtimeRoot,
    pluginId: input.capabilityId ?? input.pluginId,
    source: input.source,
    manifestPath: input.manifestPath,
    rootDirectory: input.rootDirectory,
    env: pluginDiscoveryEnv(),
  };
}

async function requirePluginSettingsSchema(input: WorkspacePluginActionInput) {
  const plugin = await requirePluginSettingsManifest(input);
  if (!plugin.manifest.settingsSchema || plugin.manifest.settingsSchema.fields.length === 0) {
    throw new Error(`Plugin does not declare settings: ${input.pluginId}`);
  }
  return plugin.manifest.settingsSchema;
}

async function requireMutablePluginSettingsSchema(input: WorkspacePluginActionInput) {
  const plugin = await requirePluginSettingsManifest(input);
  if (plugin.source === "built-in") {
    throw new Error(`Official plugin settings are read-only in Plugin Config v0: ${plugin.manifest.id}`);
  }
  if (!plugin.manifest.settingsSchema || plugin.manifest.settingsSchema.fields.length === 0) {
    throw new Error(`Plugin does not declare settings: ${input.pluginId}`);
  }
  return plugin.manifest.settingsSchema;
}

async function requirePluginSettingsManifest(input: WorkspacePluginActionInput) {
  const plugins = await discoverManagedPlugins({
    workspaceRoot: workspaceModel.workspaceRoot,
    env: pluginDiscoveryEnv(),
  });
  const plugin = plugins.find((candidate) => matchesPluginSettingsInput(candidate, input));
  if (!plugin) {
    throw new Error(`Plugin not found: ${input.pluginId}`);
  }
  return plugin;
}

function matchesPluginSettingsInput(plugin: DiscoveredPlugin, input: WorkspacePluginActionInput): boolean {
  return (plugin.manifest.id === input.pluginId || plugin.manifest.capabilities.some((capability) => capability.id === input.capabilityId))
    && (!input.source || plugin.source === input.source)
    && plugin.manifestPath === input.manifestPath
    && plugin.rootDirectory === input.rootDirectory;
}

function pluginDiscoveryEnv(): NodeJS.ProcessEnv {
  return {
    ...process.env,
    EXO_PROJECT_ROOT: process.env.EXO_PROJECT_ROOT ?? sourceProjectRoot,
    EXO_USER_DATA_PATH: app.getPath("userData"),
  };
}

function resolveSourceProjectRoot(): string | undefined {
  const resourcesPath = (process as NodeJS.Process & { resourcesPath?: string }).resourcesPath;
  for (const candidate of [
    process.cwd(),
    ...(resourcesPath ? [resourcesPath] : []),
    path.resolve(currentDirectory, "../../.."),
    path.resolve(currentDirectory, "../../../.."),
  ]) {
    if (existsSync(path.join(candidate, "plugins"))) {
      return candidate;
    }
  }
  return undefined;
}

function applyWorkspaceSettings(settings: WorkspaceSettings | null) {
  applyWorkspaceSettingsToEnv(settings);
  if (!isForcedTheme(process.env.EXO_FORCE_THEME)) {
    nativeTheme.themeSource = settings?.appearanceMode ?? DEFAULT_APPEARANCE_MODE;
  }
}

app.whenReady().then(async () => {
  workspaceSettingsStore = new WorkspaceSettingsStore({ userDataPath: app.getPath("userData") });
  workspaceWatcherService = new WorkspaceWatcherService((event) => {
    sendToRenderer("workspace:changed", event);
  });

  const forcedTheme = process.env.EXO_FORCE_THEME;
  if (isForcedTheme(forcedTheme)) {
    nativeTheme.themeSource = forcedTheme;
  }

  workspaceSettings = await workspaceSettingsStore.load();
  if (workspaceSettings) {
    applyWorkspaceSettings(workspaceSettings);
  }
  workspaceSetupComplete = workspaceSettings !== null || Boolean(process.env.EXO_NOTE_ROOTS);
  workspaceModel = workspaceSetupComplete ? resolveWorkspaceModel() : createFirstRunWorkspaceModel();
  const effectiveWorkspaceSettings = workspaceSettings ?? workspaceSettingsStore.fromModel(workspaceModel);
  applyWorkspaceSettings(effectiveWorkspaceSettings);
  if (workspaceSettings && !isForcedTheme(forcedTheme)) {
    nativeTheme.themeSource = workspaceSettings.appearanceMode;
  }
  if (workspaceSetupComplete) {
    await ensureNoteRoots(workspaceModel);
    workspaceSettings = await workspaceSettingsStore.save(workspaceSettings ?? workspaceSettingsStore.fromModel(workspaceModel));
  }
  logWorkspaceStartup(workspaceModel);
  const terminalPolicy = resolveTerminalRuntimePolicy(workspaceSettings ?? workspaceSettingsStore.fromModel(workspaceModel));
  terminalManager = new TerminalManager(
    workspaceModel.defaultTerminalCwd,
    terminalPolicy.bufferLineLimit,
    terminalPolicy.transcriptRetentionDays,
    terminalPolicy,
  );
  indexingService = new IndexingService({
    getWorkspaceModel: () => workspaceModel,
    getCurrentSettings: () => workspaceSettingsService.currentSettings(),
    getRuntimeRoot: () => resolveRuntimeConfig().runtimeRoot,
    saveWorkspaceSettings: (settings) => workspaceSettingsService.saveSettings(settings),
    sendState: (event) => sendToRenderer("workspace:index-sync-state", event),
    errorMessage,
  });
  workspaceSettingsService = new WorkspaceSettingsService({
    store: workspaceSettingsStore,
    getWorkspaceModel: () => workspaceModel,
    setWorkspaceModel: (model) => {
      workspaceModel = model;
    },
    getWorkspaceSettings: () => workspaceSettings,
    setWorkspaceSettings: (settings) => {
      workspaceSettings = settings;
    },
    setWorkspaceSetupComplete: (complete) => {
      workspaceSetupComplete = complete;
    },
    terminalManager,
    workspaceWatcherService,
    indexingService,
    ensureNoteRoots,
    restartCommandServer: startCommandServer,
    applyAppearanceMode: (settings) => {
      if (!isForcedTheme(process.env.EXO_FORCE_THEME)) {
        nativeTheme.themeSource = settings?.appearanceMode ?? DEFAULT_APPEARANCE_MODE;
      }
    },
  });
  workspaceNotesService = new WorkspaceNotesService({
    getWorkspaceModel: () => workspaceModel,
  });
  projectReviewService = new ProjectReviewService();
  agentInstructionsService = new AgentInstructionsService({
    getWorkspaceModel: () => workspaceModel,
    errorMessage,
  });
  agentSkillsService = new AgentSkillsService({
    disabledRootPath: path.join(app.getPath("userData"), "disabled-skills"),
    getWorkspaceModel: () => workspaceModel,
    homePath: process.env.HOME || app.getPath("home"),
    skillSourcesRootPath: path.join(app.getPath("userData"), "skill-sources"),
  });
  appLifecycle = new AppLifecycleController({
    currentDirectory,
    getTerminalDiagnostics: () => terminalManager?.diagnostics() ?? [],
    getCommandServerStatus: () => ({
      listening: commandServer?.isListening() ?? false,
      port: commandServer?.getPort() ?? null,
    }),
    openSettings: () => {
      sendToRenderer("command:open-settings", { section: "workspace" });
    },
    restartCommandServer: startCommandServer,
    logMain,
  });
  registerIpcHandlers();
  broadcastTerminalData();
  workspaceWatcherService.start(workspaceModel);
  await terminalManager.syncRuntimeContext();
  appLifecycle.createWindow();
  appLifecycle.setupTray();
  startCommandServer();

  nativeTheme.on("updated", () => {
    appLifecycle.updateBackgroundForTheme();
  });

  registerTerminalRecoveryService({ powerMonitor, terminalManager, logMain });

  app.on("activate", () => {
    appLifecycle.activate();
  });

  app.on("second-instance", (_event, _commandLine, workingDirectory, additionalData) => {
    logMain("second instance requested focus", {
      workingDirectory,
      requestedRuntimeRoot: extractRuntimeRoot(additionalData),
    });
    void refreshCommandServerDiscovery("second-instance");
    appLifecycle.showMainWindow();
  });
});

async function ensureNoteRoots(model: WorkspaceModel): Promise<void> {
  await Promise.all(model.noteRoots.map((root) => mkdir(root.path, { recursive: true })));
}

app.on("before-quit", () => {
  appLifecycle?.prepareToQuit();
  commandServer?.stop();
  workspaceWatcherService?.stop();
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});
