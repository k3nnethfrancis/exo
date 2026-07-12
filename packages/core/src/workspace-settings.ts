import { createHash, randomUUID } from "node:crypto";
import { chmod, mkdir, open, readFile, rename, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import type { IndexMode, LegacyWorkspaceLayoutSettings, WorkspaceCanvasLayoutSettings, WorkspaceLayoutSettings, WorkspaceModel, WorkspacePaneContent, WorkspacePaneNode, WorkspaceSettings, WorkspaceSettingsRevision } from "./types";
import { normalizeAgentCommands } from "./agent-invocation";
import {
  DEFAULT_TERMINAL_AGENT_STARTUP_GRACE_MS,
  DEFAULT_TERMINAL_AGENT_SUBMIT_DELAY_MS,
  DEFAULT_TERMINAL_IDLE_THRESHOLD_MS,
  DEFAULT_TERMINAL_INITIAL_COLUMNS,
  DEFAULT_TERMINAL_INITIAL_ROWS,
  DEFAULT_TERMINAL_INPUT_COALESCE_MS,
  DEFAULT_TERMINAL_MAX_READ_TAIL_CHARS,
  DEFAULT_TERMINAL_MINIMUM_COLUMNS,
  DEFAULT_TERMINAL_MINIMUM_ROWS,
  DEFAULT_TERMINAL_READ_TAIL_CHARS,
  DEFAULT_TERMINAL_UNRESPONSIVE_THRESHOLD_MS,
} from "./terminal-settings";
import { createIndexedRoot, DEFAULT_INDEXING } from "./workspace";

export const DEFAULT_APPEARANCE_MODE: WorkspaceSettings["appearanceMode"] = "system";
export const DEFAULT_COLOR_THEME_ID: WorkspaceSettings["colorThemeId"] = "exo-neutral";
export const DEFAULT_EDITOR_FONT_SIZE = 15;
export const DEFAULT_TERMINAL_FONT_SIZE = 13;
export const DEFAULT_TERMINAL_HISTORY_LINES = 100_000;
export const MIN_TERMINAL_HISTORY_LINES = 500;
export const DEFAULT_TERMINAL_TRANSCRIPT_RETENTION: WorkspaceSettings["terminalTranscriptRetention"] = "forever";
export const DEFAULT_TERMINAL_TRANSCRIPT_RETENTION_DAYS = 14;
export const DEFAULT_EXPLORER_SCALE = 1;
export interface WorkspaceRegistryEntry {
  id: string;
  label: string;
  notesFolder: string;
  settings: WorkspaceSettings;
  updatedAt: string;
}

export interface WorkspaceRegistry {
  activeWorkspaceId: string | null;
  workspaces: WorkspaceRegistryEntry[];
}

export function workspaceEnvOverrides(env: NodeJS.ProcessEnv = process.env): boolean {
  return Boolean(
    env.EXO_WORKSPACE_ROOT ||
      env.EXO_DEFAULT_TERMINAL_CWD ||
      env.EXO_NOTE_ROOTS ||
      env.EXO_PROJECT_ROOTS ||
      env.EXO_INDEXED_ROOTS ||
      env.EXO_INDEX_ENABLED ||
      env.EXO_INDEX_MODE,
  );
}

export function resolveWorkspaceSettingsPath(env: NodeJS.ProcessEnv = process.env): string {
  return env.EXO_SETTINGS_PATH ?? path.join(resolveDesktopUserDataPath(env), "workspace-settings.json");
}

export function resolveWorkspaceRegistryPath(env: NodeJS.ProcessEnv = process.env): string {
  return path.join(path.dirname(resolveWorkspaceSettingsPath(env)), "workspace-registry.json");
}

export function resolveWorkspaceSettingsTransactionPath(env: NodeJS.ProcessEnv = process.env): string {
  return path.join(path.dirname(resolveWorkspaceSettingsPath(env)), "workspace-settings-transaction.json");
}

export async function loadWorkspaceSettings(env: NodeJS.ProcessEnv = process.env): Promise<WorkspaceSettings | null> {
  await recoverWorkspaceSettingsTransaction(env);
  return loadWorkspaceSettingsFile(env);
}

async function loadWorkspaceSettingsFile(env: NodeJS.ProcessEnv): Promise<WorkspaceSettings | null> {
  try {
    const raw = await readFile(resolveWorkspaceSettingsPath(env), "utf8");
    return normalizeWorkspaceSettings(JSON.parse(raw) as Partial<WorkspaceSettings>);
  } catch {
    return null;
  }
}

export function workspaceSettingsRevision(settings: WorkspaceSettings | null): WorkspaceSettingsRevision {
  if (!settings) {
    return null;
  }
  const normalized = normalizeWorkspaceSettings(settings);
  return normalized
    ? createHash("sha256").update(JSON.stringify(normalized)).digest("hex")
    : null;
}

export async function saveWorkspaceSettings(settings: WorkspaceSettings, env: NodeJS.ProcessEnv = process.env): Promise<WorkspaceSettings> {
  await recoverWorkspaceSettingsTransaction(env);
  const normalized = normalizeWorkspaceSettings(settings);
  if (!normalized) {
    throw new Error("Workspace settings are incomplete.");
  }
  const registry = await loadWorkspaceRegistryFile(env);
  const transaction: WorkspaceSettingsTransaction = {
    version: 1,
    settings: normalized,
    registry: registryWithActiveWorkspace(registry, normalized),
  };
  await writeJsonAtomically(resolveWorkspaceSettingsTransactionPath(env), transaction);
  try {
    await applyWorkspaceSettingsTransaction(transaction, env);
    await removeFileDurably(resolveWorkspaceSettingsTransactionPath(env));
    return normalized;
  } catch (error) {
    try {
      await recoverWorkspaceSettingsTransaction(env);
      return normalized;
    } catch (recoveryError) {
      throw new WorkspaceSettingsTransactionError(recoveryError, error);
    }
  }
}

export async function loadWorkspaceRegistry(env: NodeJS.ProcessEnv = process.env): Promise<WorkspaceRegistry> {
  await recoverWorkspaceSettingsTransaction(env);
  return loadWorkspaceRegistryFile(env);
}

async function loadWorkspaceRegistryFile(env: NodeJS.ProcessEnv): Promise<WorkspaceRegistry> {
  try {
    const raw = await readFile(resolveWorkspaceRegistryPath(env), "utf8");
    return normalizeWorkspaceRegistry(JSON.parse(raw));
  } catch {
    return { activeWorkspaceId: null, workspaces: [] };
  }
}

export async function listWorkspaceRegistryEntries(env: NodeJS.ProcessEnv = process.env, currentSettings?: WorkspaceSettings | null): Promise<WorkspaceRegistryEntry[]> {
  const registry = await loadWorkspaceRegistry(env);
  if (registry.workspaces.length > 0) {
    return registry.workspaces;
  }
  const normalized = normalizeWorkspaceSettings(currentSettings);
  return normalized ? [workspaceEntryFromSettings(normalized)] : [];
}

export async function getWorkspaceRegistryEntry(workspaceId: string, env: NodeJS.ProcessEnv = process.env): Promise<WorkspaceRegistryEntry | null> {
  const registry = await loadWorkspaceRegistry(env);
  return registry.workspaces.find((entry) => entry.id === workspaceId) ?? null;
}

export async function recoverWorkspaceSettingsTransaction(env: NodeJS.ProcessEnv = process.env): Promise<boolean> {
  const transactionPath = resolveWorkspaceSettingsTransactionPath(env);
  let raw: string;
  try {
    raw = await readFile(transactionPath, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return false;
    }
    throw error;
  }
  const transaction = parseWorkspaceSettingsTransaction(raw);
  await applyWorkspaceSettingsTransaction(transaction, env);
  await removeFileDurably(transactionPath);
  return true;
}

function registryWithActiveWorkspace(registry: WorkspaceRegistry, settings: WorkspaceSettings): WorkspaceRegistry {
  const entry = workspaceEntryFromSettings(settings);
  return {
    activeWorkspaceId: entry.id,
    workspaces: [entry, ...registry.workspaces.filter((workspace) => workspace.id !== entry.id)],
  };
}

function normalizeWorkspaceRegistry(value: unknown): WorkspaceRegistry {
  const parsed = value && typeof value === "object" ? value as Partial<WorkspaceRegistry> : {};
  const workspaces = Array.isArray(parsed.workspaces)
    ? parsed.workspaces.reduce<WorkspaceRegistryEntry[]>((entries, entry) => {
        const normalized = normalizeRegistryEntry(entry);
        if (normalized) {
          entries.push(normalized);
        }
        return entries;
      }, [])
    : [];
  return {
    activeWorkspaceId: typeof parsed.activeWorkspaceId === "string" ? parsed.activeWorkspaceId : workspaces[0]?.id ?? null,
    workspaces,
  };
}

function parseWorkspaceSettingsTransaction(raw: string): WorkspaceSettingsTransaction {
  const parsed = JSON.parse(raw) as Partial<WorkspaceSettingsTransaction>;
  const settings = normalizeWorkspaceSettings(parsed.settings);
  const registry = normalizeWorkspaceRegistry(parsed.registry);
  if (parsed.version !== 1 || !settings || registry.workspaces.length === 0) {
    throw new Error("Workspace settings transaction is invalid.");
  }
  return { version: 1, settings, registry };
}

async function applyWorkspaceSettingsTransaction(transaction: WorkspaceSettingsTransaction, env: NodeJS.ProcessEnv): Promise<void> {
  await writeJsonAtomically(resolveWorkspaceSettingsPath(env), transaction.settings);
  await writeJsonAtomically(resolveWorkspaceRegistryPath(env), transaction.registry);
}

interface WorkspaceSettingsTransaction {
  version: 1;
  settings: WorkspaceSettings;
  registry: WorkspaceRegistry;
}

export class WorkspaceSettingsTransactionError extends Error {
  readonly code = "workspace-settings-recovery-pending";

  constructor(readonly recoveryError: unknown, originalError: unknown) {
    super("Workspace settings were committed but could not be fully applied. Recovery will resume on the next settings read.", { cause: originalError });
    this.name = "WorkspaceSettingsTransactionError";
  }
}

async function writeJsonAtomically(targetPath: string, value: unknown): Promise<void> {
  await mkdir(path.dirname(targetPath), { recursive: true });
  const temporaryPath = path.join(
    path.dirname(targetPath),
    `.${path.basename(targetPath)}.${process.pid}.${randomUUID()}.tmp`,
  );
  try {
    await writeFile(temporaryPath, JSON.stringify(value, null, 2), { mode: 0o600 });
    await chmod(temporaryPath, 0o600);
    const temporaryFile = await open(temporaryPath, "r");
    try {
      await temporaryFile.sync();
    } finally {
      await temporaryFile.close();
    }
    await rename(temporaryPath, targetPath);
    await syncDirectory(path.dirname(targetPath));
  } catch (error) {
    await rm(temporaryPath, { force: true }).catch(() => undefined);
    throw error;
  }
}

async function removeFileDurably(targetPath: string): Promise<void> {
  await rm(targetPath, { force: true });
  await syncDirectory(path.dirname(targetPath));
}

async function syncDirectory(directoryPath: string): Promise<void> {
  if (process.platform === "win32") {
    return;
  }
  const directory = await open(directoryPath, "r");
  try {
    await directory.sync();
  } finally {
    await directory.close();
  }
}

export async function loadActiveWorkspaceSettings(env: NodeJS.ProcessEnv = process.env): Promise<WorkspaceSettings | null> {
  const directSettings = await loadWorkspaceSettings(env);
  if (directSettings) {
    return directSettings;
  }
  const registry = await loadWorkspaceRegistry(env);
  const active = registry.workspaces.find((entry) => entry.id === registry.activeWorkspaceId) ?? registry.workspaces[0];
  return active?.settings ?? null;
}

/**
 * Converts persisted workspace choices into the filesystem model shared by
 * the desktop app and app-off operator commands. Settings remain user data;
 * this function only gives them stable root identities for one operation.
 */
export function workspaceModelFromSettings(settings: WorkspaceSettings): WorkspaceModel {
  return {
    workspaceRoot: settings.workspaceRoot,
    defaultTerminalCwd: settings.defaultTerminalCwd,
    noteRoots: settings.noteRoots.map((targetPath, index) => ({
      id: `note-root-${index + 1}`,
      label: path.basename(targetPath) || targetPath,
      path: targetPath,
      kind: "notes" as const,
    })),
    projectRoots: settings.projectRoots.map((targetPath, index) => ({
      id: `project-root-${index + 1}`,
      label: path.basename(targetPath) || targetPath,
      path: targetPath,
      kind: "projects" as const,
    })),
    indexedRoots: settings.indexedRoots,
    indexing: settings.indexing,
    attachedWorkcells: [],
  };
}

export function normalizeWorkspaceSettings(input: Partial<WorkspaceSettings> | null | undefined): WorkspaceSettings | null {
  if (!input) {
    return null;
  }

  const workspaceRoot = typeof input.workspaceRoot === "string" ? input.workspaceRoot.trim() : "";
  const defaultTerminalCwd = typeof input.defaultTerminalCwd === "string" ? input.defaultTerminalCwd.trim() : "";
  const noteRoots = Array.isArray(input.noteRoots)
    ? input.noteRoots.map((entry) => (typeof entry === "string" ? entry.trim() : "")).filter(Boolean)
    : [];
  const projectRoots = Array.isArray(input.projectRoots)
    ? input.projectRoots
        .map((entry) => (typeof entry === "string" ? entry.trim() : ""))
        .filter(Boolean)
        .filter((entry) => !isBroadDefaultProjectRoot(workspaceRoot, entry))
    : [];
  const indexedRoots = Array.isArray(input.indexedRoots)
    ? input.indexedRoots.reduce<WorkspaceSettings["indexedRoots"]>((roots, entry, index) => {
        if (!entry || typeof entry !== "object" || typeof entry.path !== "string" || !entry.path.trim()) {
          return roots;
        }
        roots.push(createIndexedRoot(entry.path, {
          id: typeof entry.id === "string" ? entry.id : `index-root-${index + 1}`,
          label: typeof entry.label === "string" ? entry.label : undefined,
          kind: entry.kind === "notes" || entry.kind === "docs" || entry.kind === "code" || entry.kind === "mixed" ? entry.kind : "mixed",
          pattern: typeof entry.pattern === "string" ? entry.pattern : undefined,
          ignore: Array.isArray(entry.ignore) ? entry.ignore.filter((item): item is string => typeof item === "string") : [],
        }));
        return roots;
      }, [])
    : [];
  const mode: IndexMode = input.indexing?.mode === "lexical" || input.indexing?.mode === "semantic" || input.indexing?.mode === "hybrid" ? input.indexing.mode : input.indexing?.mode === "off" ? "off" : indexedRoots.length > 0 ? "lexical" : "off";
  const indexing = input.indexing && typeof input.indexing === "object"
    ? { enabled: Boolean(input.indexing.enabled) && mode !== "off", mode, backend: "qmd" as const }
    : indexedRoots.length > 0
      ? { enabled: true, mode: "lexical" as const, backend: "qmd" as const }
      : DEFAULT_INDEXING;

  if (!workspaceRoot || !defaultTerminalCwd || noteRoots.length === 0) {
    return null;
  }

  // A newer Exo may own settings this build does not recognize yet.
  return {
    ...input,
    workspaceRoot,
    defaultTerminalCwd,
    noteRoots,
    projectRoots,
    agentCommands: normalizeAgentCommands(input.agentCommands),
    indexedRoots,
    indexing,
    appearanceMode: input.appearanceMode === "light" || input.appearanceMode === "dark" || input.appearanceMode === "system" ? input.appearanceMode : DEFAULT_APPEARANCE_MODE,
    colorThemeId: normalizeColorThemeId(input.colorThemeId),
    editorFontSize: clampSettingsNumber(input.editorFontSize, DEFAULT_EDITOR_FONT_SIZE, 11, 24),
    terminalFontSize: clampSettingsNumber(input.terminalFontSize, DEFAULT_TERMINAL_FONT_SIZE, 10, 22),
    terminalHistoryLines: normalizeTerminalHistoryLines(input.terminalHistoryLines),
    terminalTranscriptRetention: input.terminalTranscriptRetention === "days" ? "days" : DEFAULT_TERMINAL_TRANSCRIPT_RETENTION,
    terminalTranscriptRetentionDays: clampSettingsNumber(input.terminalTranscriptRetentionDays, DEFAULT_TERMINAL_TRANSCRIPT_RETENTION_DAYS, 1, 3650),
    terminalInputCoalesceMs: terminalIntegerAtLeast(input.terminalInputCoalesceMs, DEFAULT_TERMINAL_INPUT_COALESCE_MS, 0),
    terminalAgentStartupGraceMs: terminalIntegerAtLeast(input.terminalAgentStartupGraceMs, DEFAULT_TERMINAL_AGENT_STARTUP_GRACE_MS, 0),
    terminalAgentSubmitDelayMs: terminalIntegerAtLeast(input.terminalAgentSubmitDelayMs, DEFAULT_TERMINAL_AGENT_SUBMIT_DELAY_MS, 0),
    terminalInitialColumns: terminalIntegerAtLeast(input.terminalInitialColumns, DEFAULT_TERMINAL_INITIAL_COLUMNS, 20),
    terminalInitialRows: terminalIntegerAtLeast(input.terminalInitialRows, DEFAULT_TERMINAL_INITIAL_ROWS, 8),
    terminalMinimumColumns: terminalIntegerAtLeast(input.terminalMinimumColumns, DEFAULT_TERMINAL_MINIMUM_COLUMNS, 1),
    terminalMinimumRows: terminalIntegerAtLeast(input.terminalMinimumRows, DEFAULT_TERMINAL_MINIMUM_ROWS, 1),
    terminalReadTailChars: terminalIntegerAtLeast(input.terminalReadTailChars, DEFAULT_TERMINAL_READ_TAIL_CHARS, 0),
    terminalMaxReadTailChars: Math.max(
      terminalIntegerAtLeast(input.terminalReadTailChars, DEFAULT_TERMINAL_READ_TAIL_CHARS, 0),
      terminalIntegerAtLeast(input.terminalMaxReadTailChars, DEFAULT_TERMINAL_MAX_READ_TAIL_CHARS, 0),
    ),
    terminalUnresponsiveThresholdMs: terminalIntegerAtLeast(input.terminalUnresponsiveThresholdMs, DEFAULT_TERMINAL_UNRESPONSIVE_THRESHOLD_MS, 1_000),
    terminalIdleThresholdMs: terminalIntegerAtLeast(input.terminalIdleThresholdMs, DEFAULT_TERMINAL_IDLE_THRESHOLD_MS, 1_000),
    explorerScale: clampSettingsNumber(input.explorerScale, DEFAULT_EXPLORER_SCALE, 0.82, 1.35),
    exploreIndexSearchOnEnter: typeof input.exploreIndexSearchOnEnter === "boolean" ? input.exploreIndexSearchOnEnter : indexing.enabled && indexing.mode !== "off" && indexedRoots.length > 0,
    indexUpdateStrategy: input.indexUpdateStrategy === "manual" ? "manual" : "on-save",
    layout: normalizeWorkspaceLayout(input.layout),
  };
}

function normalizeColorThemeId(value: unknown): WorkspaceSettings["colorThemeId"] {
  return value === "exo-solar" || value === "exo-neutral" ? value : DEFAULT_COLOR_THEME_ID;
}

export function workspaceEntryFromSettings(settings: WorkspaceSettings): WorkspaceRegistryEntry {
  const notesFolder = settings.noteRoots[0] || settings.workspaceRoot;
  return {
    id: workspaceIdForNotesFolder(notesFolder),
    label: path.basename(notesFolder) || notesFolder,
    notesFolder,
    settings,
    updatedAt: new Date().toISOString(),
  };
}

function normalizeRegistryEntry(value: unknown): WorkspaceRegistryEntry | null {
  if (!value || typeof value !== "object") {
    return null;
  }
  const candidate = value as Partial<WorkspaceRegistryEntry>;
  const settings = normalizeWorkspaceSettings(candidate.settings);
  if (!settings) {
    return null;
  }
  const notesFolder = typeof candidate.notesFolder === "string" && candidate.notesFolder.trim()
    ? candidate.notesFolder.trim()
    : settings.noteRoots[0] || settings.workspaceRoot;
  return {
    id: typeof candidate.id === "string" && candidate.id.trim() ? candidate.id : workspaceIdForNotesFolder(notesFolder),
    label: typeof candidate.label === "string" && candidate.label.trim() ? candidate.label.trim() : path.basename(notesFolder) || notesFolder,
    notesFolder,
    settings,
    updatedAt: typeof candidate.updatedAt === "string" && candidate.updatedAt.trim() ? candidate.updatedAt : new Date().toISOString(),
  };
}

function resolveDesktopUserDataPath(env: NodeJS.ProcessEnv): string {
  if (env.EXO_USER_DATA_PATH) {
    return env.EXO_USER_DATA_PATH;
  }
  const home = os.homedir();
  if (process.platform === "darwin") {
    return path.join(home, "Library", "Application Support", "@exo", "desktop");
  }
  if (process.platform === "win32") {
    return path.join(env.APPDATA ?? path.join(home, "AppData", "Roaming"), "@exo", "desktop");
  }
  return path.join(env.XDG_CONFIG_HOME ?? path.join(home, ".config"), "@exo", "desktop");
}

function workspaceIdForNotesFolder(notesFolder: string): string {
  let hash = 0;
  for (const char of path.resolve(notesFolder)) {
    hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
  }
  return `workspace-${hash.toString(36)}`;
}

function clampSettingsNumber(value: unknown, fallback: number, min: number, max: number): number {
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) ? Math.max(min, Math.min(max, parsed)) : fallback;
}

function normalizeTerminalHistoryLines(value: unknown): number {
  const parsed = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(parsed)) {
    return DEFAULT_TERMINAL_HISTORY_LINES;
  }
  return Math.max(MIN_TERMINAL_HISTORY_LINES, Math.floor(parsed));
}

function terminalIntegerAtLeast(value: unknown, fallback: number, min: number): number {
  const parsed = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(parsed)) {
    return fallback;
  }
  return Math.max(min, Math.floor(parsed));
}

const DEFAULT_SIDEBAR_WIDTH = 175;
const PREVIOUS_DEFAULT_SIDEBAR_WIDTH = 140;
const OLD_DEFAULT_SIDEBAR_WIDTH = 260;
const MIN_SIDEBAR_WIDTH = 140;
const MAX_SIDEBAR_WIDTH = 800;
const DEFAULT_UTILITY_WIDTH = 430;
const MIN_UTILITY_WIDTH = 320;
const MAX_UTILITY_WIDTH = 900;

function normalizeSidebarWidth(value: unknown): number {
  if (value === OLD_DEFAULT_SIDEBAR_WIDTH || value === PREVIOUS_DEFAULT_SIDEBAR_WIDTH) {
    return DEFAULT_SIDEBAR_WIDTH;
  }
  return clampSettingsNumber(value, DEFAULT_SIDEBAR_WIDTH, MIN_SIDEBAR_WIDTH, MAX_SIDEBAR_WIDTH);
}

function normalizeWorkspaceLayout(input: unknown): WorkspaceLayoutSettings | undefined {
  if (!input || typeof input !== "object") {
    return undefined;
  }
  const canvasLayout = normalizeWorkspaceCanvasLayout(input);
  if (canvasLayout) {
    return canvasLayout;
  }
  const candidate = input as Partial<LegacyWorkspaceLayoutSettings>;
  const editorTree = normalizePaneNode(candidate.editorTree, 0);
  const terminalTree = normalizePaneNode(candidate.terminalTree, 0);
  if (!editorTree || !terminalTree || !hasLeafKind(editorTree, "editor") || !hasLeafKind(terminalTree, "terminal")) {
    return undefined;
  }
  return {
    editorTree,
    terminalTree,
    terminalCollapsed: Boolean(candidate.terminalCollapsed),
    terminalMonitorMode: Boolean(candidate.terminalMonitorMode),
    sidePanesFlipped: Boolean(candidate.sidePanesFlipped),
    zoneSplitRatio: clampSettingsNumber(candidate.zoneSplitRatio, 0.6, 0.15, 0.85),
    sidebarCollapsed: Boolean(candidate.sidebarCollapsed),
    sidebarWidth: normalizeSidebarWidth(candidate.sidebarWidth),
    inspectorCollapsed: typeof candidate.inspectorCollapsed === "boolean" ? candidate.inspectorCollapsed : true,
  };
}

function normalizeWorkspaceCanvasLayout(input: unknown): WorkspaceCanvasLayoutSettings | null {
  if (!input || typeof input !== "object") {
    return null;
  }
  const candidate = input as Partial<WorkspaceCanvasLayoutSettings>;
  if (candidate.version !== 2) {
    return null;
  }
  const canvas = normalizePaneNode(candidate.canvas, 0);
  if (!canvas || !hasLeafKind(canvas, "editor")) {
    return null;
  }
  return {
    version: 2,
    canvas,
    sidebarCollapsed: Boolean(candidate.sidebarCollapsed),
    sidebarWidth: normalizeSidebarWidth(candidate.sidebarWidth),
    utilityWidth: clampSettingsNumber(candidate.utilityWidth, DEFAULT_UTILITY_WIDTH, MIN_UTILITY_WIDTH, MAX_UTILITY_WIDTH),
  };
}

function normalizePaneNode(input: unknown, depth: number): WorkspacePaneNode | null {
  if (!input || typeof input !== "object" || depth > 8) {
    return null;
  }
  const candidate = input as Partial<WorkspacePaneNode>;
  const id = typeof candidate.id === "string" && candidate.id.trim() ? candidate.id : `layout-pane-${depth}`;
  if (candidate.kind === "leaf") {
    const content = normalizePaneContent("content" in candidate ? candidate.content : null);
    return content ? { kind: "leaf", id, content } : null;
  }
  if (candidate.kind === "split") {
    const children = Array.isArray(candidate.children) ? candidate.children : [];
    if (children.length !== 2) {
      return null;
    }
    const left = normalizePaneNode(children[0], depth + 1);
    const right = normalizePaneNode(children[1], depth + 1);
    if (!left || !right) {
      return null;
    }
    return {
      kind: "split",
      id,
      direction: candidate.direction === "vertical" ? "vertical" : "horizontal",
      ratio: clampSettingsNumber(candidate.ratio, 0.5, 0.15, 0.85),
      children: [left, right],
    };
  }
  return null;
}

function normalizePaneContent(input: unknown): WorkspacePaneContent | null {
  const candidate = input && typeof input === "object"
    ? input as { kind?: unknown; openPaths?: unknown; activePath?: unknown; terminalIds?: unknown; activeTerminalId?: unknown; url?: unknown }
    : {};
  if (candidate.kind === "terminal") {
    const terminalIds = Array.isArray(candidate.terminalIds)
      ? candidate.terminalIds.filter((item): item is string => typeof item === "string" && item.trim().length > 0)
      : [];
    const activeTerminalId = typeof candidate.activeTerminalId === "string" && terminalIds.includes(candidate.activeTerminalId)
      ? candidate.activeTerminalId
      : terminalIds.at(-1) ?? null;
    return { kind: "terminal", terminalIds, activeTerminalId };
  }
  if (candidate.kind === "editor") {
    const openPaths = Array.isArray(candidate.openPaths)
      ? candidate.openPaths.filter((item): item is string => typeof item === "string" && item.trim().length > 0)
      : [];
    const activePath = typeof candidate.activePath === "string" && openPaths.includes(candidate.activePath)
      ? candidate.activePath
      : openPaths.at(-1) ?? null;
    return { kind: "editor", openPaths, activePath };
  }
  if (candidate.kind === "browser") {
    const url = typeof candidate.url === "string" && candidate.url.trim() ? candidate.url.trim() : "about:blank";
    return { kind: "browser", url };
  }
  return null;
}

function hasLeafKind(node: WorkspacePaneNode, kind: WorkspacePaneContent["kind"]): boolean {
  if (node.kind === "leaf") {
    return node.content.kind === kind;
  }
  return hasLeafKind(node.children[0], kind) || hasLeafKind(node.children[1], kind);
}

function isBroadDefaultProjectRoot(workspaceRoot: string, targetPath: string): boolean {
  return path.resolve(targetPath) === path.resolve(workspaceRoot, "projects");
}
