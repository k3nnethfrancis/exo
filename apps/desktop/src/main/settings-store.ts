import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import { DEFAULT_INDEXING, createIndexedRoot, normalizeIndexMode, type IndexedRoot, type WorkspaceModel, type WorkspaceSettings } from "@exo/core";

export const DEFAULT_APPEARANCE_MODE: WorkspaceSettings["appearanceMode"] = "system";
export const DEFAULT_EDITOR_FONT_SIZE = 15;
export const DEFAULT_TERMINAL_FONT_SIZE = 13;
export const DEFAULT_TERMINAL_SCROLLBACK_LINES = 5_000;
export const DEFAULT_TERMINAL_BUFFER_CHARS = 80_000;
export const DEFAULT_EXPLORER_SCALE = 1;

export interface WorkspaceSettingsStoreOptions {
  userDataPath: string;
  env?: NodeJS.ProcessEnv;
}

export class WorkspaceSettingsStore {
  private readonly env: NodeJS.ProcessEnv;

  constructor(private readonly options: WorkspaceSettingsStoreOptions) {
    this.env = options.env ?? process.env;
  }

  resolvePath(): string {
    return this.env.EXO_SETTINGS_PATH ?? path.join(this.options.userDataPath, "workspace-settings.json");
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
    const terminalScrollbackLines = clampSettingsNumber(input.terminalScrollbackLines, DEFAULT_TERMINAL_SCROLLBACK_LINES, 500, 100_000);
    const terminalBufferChars = clampSettingsNumber(input.terminalBufferChars, DEFAULT_TERMINAL_BUFFER_CHARS, 12_000, 2_000_000);
    const explorerScale = clampSettingsNumber(input.explorerScale, DEFAULT_EXPLORER_SCALE, 0.82, 1.35);
    const exploreIndexSearchOnEnter =
      typeof input.exploreIndexSearchOnEnter === "boolean"
        ? input.exploreIndexSearchOnEnter
        : indexing.enabled && indexing.mode !== "off" && indexedRoots.length > 0;

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
      terminalScrollbackLines,
      terminalBufferChars,
      explorerScale,
      exploreIndexSearchOnEnter,
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
      terminalScrollbackLines: DEFAULT_TERMINAL_SCROLLBACK_LINES,
      terminalBufferChars: DEFAULT_TERMINAL_BUFFER_CHARS,
      explorerScale: DEFAULT_EXPLORER_SCALE,
      exploreIndexSearchOnEnter: model.indexing.enabled && model.indexing.mode !== "off" && model.indexedRoots.length > 0,
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
    return normalized;
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
