import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import { DEFAULT_INDEXING, createIndexedRoot, normalizeIndexMode, type IndexedRoot, type WorkspaceModel, type WorkspaceSettings } from "@exo/core";

export const DEFAULT_APPEARANCE_MODE: WorkspaceSettings["appearanceMode"] = "system";
export const DEFAULT_EDITOR_FONT_SIZE = 15;
export const DEFAULT_TERMINAL_FONT_SIZE = 13;
export const DEFAULT_TERMINAL_HISTORY_MODE: WorkspaceSettings["terminalHistoryMode"] = "full";
export const FULL_TERMINAL_SCROLLBACK_LINES = 1_000_000;
export const DEFAULT_TERMINAL_HISTORY_LINES = FULL_TERMINAL_SCROLLBACK_LINES;
export const DEFAULT_TERMINAL_TRANSCRIPT_RETENTION: WorkspaceSettings["terminalTranscriptRetention"] = "forever";
export const DEFAULT_TERMINAL_TRANSCRIPT_RETENTION_DAYS = 14;
export const DEFAULT_TERMINAL_STREAMING_MODE: WorkspaceSettings["terminalStreamingMode"] = "visible";
export const DEFAULT_EXPLORER_SCALE = 1;

export interface WorkspaceSettingsStoreOptions {
  userDataPath: string;
  env?: NodeJS.ProcessEnv;
}

export interface TerminalRuntimePolicy {
  scrollbackLines: number;
  bufferLineLimit: number | null;
  transcriptRetentionDays: number;
}

export interface WorkspaceRegistryEntry {
  id: string;
  label: string;
  notesFolder: string;
  settings: WorkspaceSettings;
  updatedAt: string;
}

interface WorkspaceRegistry {
  activeWorkspaceId: string | null;
  workspaces: WorkspaceRegistryEntry[];
}

export class WorkspaceSettingsStore {
  private readonly env: NodeJS.ProcessEnv;

  constructor(private readonly options: WorkspaceSettingsStoreOptions) {
    this.env = options.env ?? process.env;
  }

  resolvePath(): string {
    return this.env.EXO_SETTINGS_PATH ?? path.join(this.options.userDataPath, "workspace-settings.json");
  }

  resolveRegistryPath(): string {
    return path.join(path.dirname(this.resolvePath()), "workspace-registry.json");
  }

  normalize(input: Partial<WorkspaceSettings> | null | undefined): WorkspaceSettings | null {
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
    const indexedRoots = normalizeIndexedRoots(input.indexedRoots);
    const indexing = normalizeIndexing(input.indexing, indexedRoots.length);
    const appearanceMode =
      input.appearanceMode === "light" || input.appearanceMode === "dark" || input.appearanceMode === "system"
        ? input.appearanceMode
        : DEFAULT_APPEARANCE_MODE;
    const editorFontSize = clampSettingsNumber(input.editorFontSize, DEFAULT_EDITOR_FONT_SIZE, 11, 24);
    const terminalFontSize = clampSettingsNumber(input.terminalFontSize, DEFAULT_TERMINAL_FONT_SIZE, 10, 22);
    const terminalHistoryMode = input.terminalHistoryMode === "custom" ? "custom" : DEFAULT_TERMINAL_HISTORY_MODE;
    const normalizedTerminalHistoryLines = clampSettingsNumber(
      input.terminalHistoryLines,
      DEFAULT_TERMINAL_HISTORY_LINES,
      500,
      FULL_TERMINAL_SCROLLBACK_LINES,
    );
    const terminalHistoryLines =
      terminalHistoryMode === "full" ? DEFAULT_TERMINAL_HISTORY_LINES : normalizedTerminalHistoryLines;
    const terminalTranscriptRetention = input.terminalTranscriptRetention === "days" ? "days" : DEFAULT_TERMINAL_TRANSCRIPT_RETENTION;
    const terminalTranscriptRetentionDays = clampSettingsNumber(
      input.terminalTranscriptRetentionDays,
      DEFAULT_TERMINAL_TRANSCRIPT_RETENTION_DAYS,
      1,
      3650,
    );
    const terminalStreamingMode =
      input.terminalStreamingMode === "all" || input.terminalStreamingMode === "paused"
        ? input.terminalStreamingMode
        : DEFAULT_TERMINAL_STREAMING_MODE;
    const explorerScale = clampSettingsNumber(input.explorerScale, DEFAULT_EXPLORER_SCALE, 0.82, 1.35);
    const exploreIndexSearchOnEnter =
      typeof input.exploreIndexSearchOnEnter === "boolean"
        ? input.exploreIndexSearchOnEnter
        : indexing.enabled && indexing.mode !== "off" && indexedRoots.length > 0;
    const indexUpdateStrategy = input.indexUpdateStrategy === "manual" ? "manual" : "on-save";

    if (!workspaceRoot || !defaultTerminalCwd || noteRoots.length === 0) {
      return null;
    }

    return {
      workspaceRoot,
      defaultTerminalCwd,
      noteRoots,
      projectRoots,
      indexedRoots,
      indexing,
      appearanceMode,
      editorFontSize,
      terminalFontSize,
      terminalHistoryMode,
      terminalHistoryLines,
      terminalTranscriptRetention,
      terminalTranscriptRetentionDays,
      terminalStreamingMode,
      explorerScale,
      exploreIndexSearchOnEnter,
      indexUpdateStrategy,
    };
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
    };
  }

  async load(): Promise<WorkspaceSettings | null> {
    try {
      const raw = await readFile(this.resolvePath(), "utf8");
      return this.normalize(JSON.parse(raw) as Partial<WorkspaceSettings>);
    } catch {
      return null;
    }
  }

  async save(settings: WorkspaceSettings): Promise<WorkspaceSettings> {
    const normalized = this.normalize(settings);
    if (!normalized) {
      throw new Error("Workspace settings are incomplete.");
    }

    const settingsPath = this.resolvePath();
    await mkdir(path.dirname(settingsPath), { recursive: true });
    await writeFile(settingsPath, JSON.stringify(normalized, null, 2));
    await this.saveActiveWorkspace(normalized);
    return normalized;
  }

  async listWorkspaces(currentSettings?: WorkspaceSettings | null): Promise<WorkspaceRegistryEntry[]> {
    const registry = await this.loadRegistry();
    if (registry.workspaces.length > 0) {
      return registry.workspaces;
    }
    const normalized = this.normalize(currentSettings);
    return normalized ? [workspaceEntryFromSettings(normalized)] : [];
  }

  async getWorkspace(workspaceId: string): Promise<WorkspaceRegistryEntry | null> {
    const registry = await this.loadRegistry();
    return registry.workspaces.find((entry) => entry.id === workspaceId) ?? null;
  }

  private async saveActiveWorkspace(settings: WorkspaceSettings): Promise<void> {
    const entry = workspaceEntryFromSettings(settings);
    const registry = await this.loadRegistry();
    const nextWorkspaces = registry.workspaces.filter((workspace) => workspace.id !== entry.id);
    nextWorkspaces.unshift(entry);
    const nextRegistry: WorkspaceRegistry = {
      activeWorkspaceId: entry.id,
      workspaces: nextWorkspaces,
    };
    const registryPath = this.resolveRegistryPath();
    await mkdir(path.dirname(registryPath), { recursive: true });
    await writeFile(registryPath, JSON.stringify(nextRegistry, null, 2));
  }

  private async loadRegistry(): Promise<WorkspaceRegistry> {
    try {
      const raw = await readFile(this.resolveRegistryPath(), "utf8");
      const parsed = JSON.parse(raw) as Partial<WorkspaceRegistry>;
      const workspaces = Array.isArray(parsed.workspaces)
        ? parsed.workspaces.reduce<WorkspaceRegistryEntry[]>((entries, entry) => {
            const normalized = normalizeRegistryEntry(entry, this);
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
    } catch {
      return { activeWorkspaceId: null, workspaces: [] };
    }
  }
}

export function applyWorkspaceSettingsToEnv(settings: WorkspaceSettings | null, env: NodeJS.ProcessEnv = process.env): void {
  if (!settings) {
    return;
  }

  env.EXO_WORKSPACE_ROOT = settings.workspaceRoot;
  env.EXO_DEFAULT_TERMINAL_CWD = settings.defaultTerminalCwd;
  env.EXO_NOTE_ROOTS = settings.noteRoots.join(path.delimiter);
  env.EXO_PROJECT_ROOTS = settings.projectRoots.join(path.delimiter);
  env.EXO_INDEXED_ROOTS = JSON.stringify(settings.indexedRoots);
  env.EXO_INDEX_ENABLED = settings.indexing.enabled ? "1" : "0";
  env.EXO_INDEX_MODE = settings.indexing.mode;
}

export function isForcedTheme(value: string | undefined): value is WorkspaceSettings["appearanceMode"] {
  return value === "light" || value === "dark" || value === "system";
}

function clampSettingsNumber(value: unknown, fallback: number, min: number, max: number): number {
  const parsed = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(parsed)) {
    return fallback;
  }
  return Math.max(min, Math.min(max, parsed));
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

function isBroadDefaultProjectRoot(workspaceRoot: string, targetPath: string): boolean {
  return path.resolve(targetPath) === path.resolve(workspaceRoot, "projects");
}

function normalizeIndexedRoots(value: unknown): IndexedRoot[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.reduce<IndexedRoot[]>((roots, entry, index) => {
    if (!entry || typeof entry !== "object") {
      return roots;
    }
    const candidate = entry as Partial<IndexedRoot>;
    if (typeof candidate.path !== "string" || !candidate.path.trim()) {
      return roots;
    }
    roots.push(createIndexedRoot(candidate.path, {
      id: typeof candidate.id === "string" ? candidate.id : `index-root-${index + 1}`,
      label: typeof candidate.label === "string" ? candidate.label : undefined,
      kind: candidate.kind === "notes" || candidate.kind === "docs" || candidate.kind === "code" || candidate.kind === "mixed" ? candidate.kind : "mixed",
      pattern: typeof candidate.pattern === "string" ? candidate.pattern : undefined,
      ignore: Array.isArray(candidate.ignore) ? candidate.ignore.filter((item): item is string => typeof item === "string") : [],
    }));
    return roots;
  }, []);
}

function normalizeIndexing(value: unknown, indexedRootCount: number): WorkspaceSettings["indexing"] {
  if (!value || typeof value !== "object") {
    return indexedRootCount > 0 ? { enabled: true, mode: "lexical", backend: "qmd" } : DEFAULT_INDEXING;
  }

  const candidate = value as Partial<WorkspaceSettings["indexing"]>;
  const mode = normalizeIndexMode(candidate.mode);
  return {
    enabled: Boolean(candidate.enabled) && mode !== "off",
    mode,
    backend: "qmd",
  };
}

function workspaceEntryFromSettings(settings: WorkspaceSettings): WorkspaceRegistryEntry {
  const notesFolder = settings.noteRoots[0] || settings.workspaceRoot;
  return {
    id: workspaceIdForNotesFolder(notesFolder),
    label: path.basename(notesFolder) || notesFolder,
    notesFolder,
    settings,
    updatedAt: new Date().toISOString(),
  };
}

function normalizeRegistryEntry(value: unknown, store: WorkspaceSettingsStore): WorkspaceRegistryEntry | null {
  if (!value || typeof value !== "object") {
    return null;
  }
  const candidate = value as Partial<WorkspaceRegistryEntry>;
  const settings = store.normalize(candidate.settings);
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

function workspaceIdForNotesFolder(notesFolder: string): string {
  let hash = 0;
  for (const char of path.resolve(notesFolder)) {
    hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
  }
  return `workspace-${hash.toString(36)}`;
}
