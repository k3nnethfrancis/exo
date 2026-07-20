import { describe, expect, it, vi } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { EditorState } from "@codemirror/state";
import { renderToStaticMarkup } from "react-dom/server";
import type {
  IndexStatus,
  InvocationRecord,
  NoteDocument,
  WorkspaceGraphContext,
  TreeNode,
  WorkspaceModel,
} from "@exo/core";
import {
  getWorkspaceRegistryEntry,
  listWorkspaceRegistryEntries,
  normalizeWorkspaceSettings,
  saveWorkspaceSettings,
} from "@exo/core";

class WorkspaceSettingsStore {
  constructor(private readonly options: { userDataPath: string; env?: NodeJS.ProcessEnv }) {}
  normalize = normalizeWorkspaceSettings;
  async save(request: { settings: NonNullable<ReturnType<typeof normalizeWorkspaceSettings>>; expectedRevision?: string | null }) {
    const settings = await saveWorkspaceSettings(request.settings, { ...this.options.env, EXO_USER_DATA_PATH: this.options.userDataPath });
    return { settings, revision: "test" };
  }
  listWorkspaces() { return listWorkspaceRegistryEntries({ ...this.options.env, EXO_USER_DATA_PATH: this.options.userDataPath }); }
  getWorkspace(id: string) { return getWorkspaceRegistryEntry(id, { ...this.options.env, EXO_USER_DATA_PATH: this.options.userDataPath }); }
}

import { TERMINAL_CUSTOM_GLYPHS, TERMINAL_FONT_FAMILY } from "./components/terminalFonts";
import {
  initialTerminalHydrationViewState,
  markTerminalHydrationApplied,
  shouldApplyTerminalHydration,
} from "./components/terminalHydration";
import { isTerminalGeneratedResponse } from "./components/terminalInputFilters";
import { TerminalOutputChunker, chunkTerminalData } from "./components/terminalOutputChunks";
import { normalizeTerminalPresentation } from "./components/terminalPresentation";
import { focusTerminal, registerTerminal, unregisterTerminal, writeTerminalData } from "./components/terminalRegistry";
import { nextSuggestionIndex, normalizeFrontmatterPropertyKey, shouldUseMarkdownRenderer } from "./components/NoteEditor";
import {
  WorkspaceSettingsDialog,
  indexSettingsStatusCopy,
  workspaceSettingsDialogIntroCopy,
  workspaceSettingsSavedFooterCopy,
} from "./components/WorkspaceSettingsDialog";
import { summarizeIndexStatus } from "./indexStatusPresentation";
import {
  clampSelectionToRenderedListText,
  collectListMetadata,
  listEnterEdit,
  markdownImageTarget,
  markdownPreviewMetadata,
  shouldSuppressGeneratedTitleLine,
  updateMarkdownPreviewMetadataForChanges,
  updateListMetadataForChanges,
  visibleLineNumbers,
  wikilinkExitEdit,
} from "./components/markdownLivePreview";
import {
  appendPendingTerminalData,
  mergeHydrationSnapshot,
  shouldBufferTerminalDataForHydration,
  shouldSkipTerminalHydration,
} from "./hooks/useTerminalSessions";
import { defaultTerminalCwdForNotesFolder } from "./hooks/useWorkspaceBootstrap";
import { workspaceSettingsFromDialog } from "./hooks/useWorkspaceSettingsController";
import { isTerminalInputEnabled, summarizeTerminalStatusLine, terminalSessionsEqual } from "./terminalSessions";
import { applyTheme } from "./theme/applyTheme";
import { contrastRatio } from "./theme/contrast";
import { THEME_FAMILIES, resolveTheme } from "./theme/registry";
import { terminalRenderStabilityBody, terminalRenderStabilityIssues } from "../../../tests/terminalRenderStability";
import {
  clampNumber,
  resolveSettingsTerminalRuntime,
  workspaceSettingsImmediateDraftKey,
  workspaceSettingsStructuralDraftKey,
  workspaceSettingsStructuralKeyFromSettings,
} from "./workspaceSettingsModel";
import { isNewTerminalShortcut } from "./hooks/useAppKeybindings";
import {
  buildNoteGraphContext,
  getWikilinkCompletionContext,
  graphReferencesForMarkdownMode,
  markdownPreviewExcerpt,
  suggestWikilinkTargetsFromTrees,
  wikilinkSuggestionEdit,
} from "./graphAffordances";
import type { WorkspaceSettingsDialogState } from "./workspaceSettingsDialogTypes";
import type { TerminalSessionInfo } from "../../shared/api";
import { hasInvocationDirtyConflict } from "./invocationReviewState";
import { presentInvocation } from "./invocationPresentation";

describe("desktop shell", () => {
  it("keeps a renderer test surface in place", () => {
    expect(true).toBe(true);
  });
});

describe("app keybindings", () => {
  it("recognizes Mod+T as the new terminal shortcut", () => {
    expect(isNewTerminalShortcut({ key: "t", metaKey: true, ctrlKey: false, shiftKey: false, altKey: false, repeat: false })).toBe(true);
    expect(isNewTerminalShortcut({ key: "T", metaKey: false, ctrlKey: true, shiftKey: false, altKey: false, repeat: false })).toBe(true);
  });

  it("ignores modified or repeated Mod+T events", () => {
    expect(isNewTerminalShortcut({ key: "t", metaKey: true, ctrlKey: false, shiftKey: true, altKey: false, repeat: false })).toBe(false);
    expect(isNewTerminalShortcut({ key: "t", metaKey: true, ctrlKey: false, shiftKey: false, altKey: true, repeat: false })).toBe(false);
    expect(isNewTerminalShortcut({ key: "t", metaKey: true, ctrlKey: false, shiftKey: false, altKey: false, repeat: true })).toBe(false);
    expect(isNewTerminalShortcut({ key: "n", metaKey: true, ctrlKey: false, shiftKey: false, altKey: false, repeat: false })).toBe(false);
  });
});

describe("editor document mode", () => {
  it("uses the markdown renderer for markdown documents from any root", () => {
    expect(shouldUseMarkdownRenderer({ kind: "markdown" })).toBe(true);
    expect(shouldUseMarkdownRenderer({ kind: "text" })).toBe(false);
    expect(shouldUseMarkdownRenderer(null)).toBe(false);
  });

  it("keeps new graph property keys within simple frontmatter field names", () => {
    expect(normalizeFrontmatterPropertyKey(" status ")).toBe("status");
    expect(normalizeFrontmatterPropertyKey("branch_state")).toBe("branch_state");
    expect(normalizeFrontmatterPropertyKey("needs-review")).toBe("needs-review");
    expect(normalizeFrontmatterPropertyKey("bad key")).toBe("");
    expect(normalizeFrontmatterPropertyKey("1bad")).toBe("");
    expect(normalizeFrontmatterPropertyKey("nested.value")).toBe("");
  });

  it("wraps agent completion selection with arrow-key navigation", () => {
    expect(nextSuggestionIndex(0, 3, 1)).toBe(1);
    expect(nextSuggestionIndex(2, 3, 1)).toBe(0);
    expect(nextSuggestionIndex(0, 3, -1)).toBe(2);
  });
});

describe("agent invocation review", () => {
  it("flags agent-written disk changes only when the open editor buffer is dirty", () => {
    const record = invocationRecord({
      changedFileRefs: [{ path: "/vault/current.md", kind: "modified", attribution: "likely", diffRefId: "diff-1" }],
    });

    expect(hasInvocationDirtyConflict(record, "/vault/current.md", { dirty: true }, new Set())).toBe(true);
    expect(hasInvocationDirtyConflict(record, "/vault/current.md", { dirty: false }, new Set())).toBe(false);
    expect(hasInvocationDirtyConflict(record, "/vault/other.md", { dirty: true }, new Set())).toBe(false);
    expect(hasInvocationDirtyConflict(record, "/vault/current.md", { dirty: true }, new Set(["inv-1:/vault/current.md"]))).toBe(false);
  });

  it("presents failure recovery as the exact provider resume command", () => {
    const presentation = presentInvocation(invocationRecord({
      status: "failed",
      failureReason: "Claude could not edit the note.",
      providerSessionId: "ce4b9e26-2574-4433-a054-1110cd403792",
      command: {
        ...invocationRecord().command,
        command: "claude -p --permission-mode acceptEdits --output-format json",
      },
    }));

    expect(presentation).toMatchObject({
      title: "@claude failed",
      detail: "Claude could not edit the note. · Fresh context",
      tone: "danger",
      dismissible: true,
    });
    expect(presentation.resumeCommand).toBe("claude --permission-mode acceptEdits --resume 'ce4b9e26-2574-4433-a054-1110cd403792'");
  });

  it("does not claim a failed resume continued context", () => {
    expect(presentInvocation(invocationRecord({
      status: "failed",
      failureReason: "Authentication failed",
      continuity: { policy: "continuous", outcome: "resume-failed", resumedFromInvocationId: "inv-0" },
    })).detail).toBe("Authentication failed · Could not continue context");
  });

  it("keeps running and pending-review states intentionally persistent", () => {
    expect(presentInvocation(invocationRecord({ status: "running" }))).toMatchObject({
      title: "@claude running",
      dismissible: false,
      resumeCommand: null,
    });
    expect(presentInvocation(invocationRecord({
      review: { status: "pending", beforeSha256: "before", afterSha256: "after" },
      changedFileRefs: [{ path: "/vault/current.md", kind: "modified", attribution: "likely" }],
    }))).toMatchObject({
      title: "Review @claude changes",
      dismissible: false,
    });
  });
});

describe("workspace settings footer copy", () => {
  it("only mentions Apply when structural changes are pending", () => {
    expect(workspaceSettingsSavedFooterCopy(true)).toContain("Apply");
    expect(workspaceSettingsSavedFooterCopy(false)).toBe("Settings saved.");
  });

  it("keeps the dialog intro from mentioning Apply when no Apply action is visible", () => {
    expect(workspaceSettingsDialogIntroCopy("index", false)).not.toContain("Apply");
    expect(workspaceSettingsDialogIntroCopy("index", false)).toContain("Choose how Exo searches");
    expect(workspaceSettingsDialogIntroCopy("appearance", false)).not.toContain("Apply");
    expect(workspaceSettingsDialogIntroCopy("index", true)).toContain("apply");
  });

  it("keeps invocation configuration in the Settings dialog", () => {
    const html = renderToStaticMarkup(
      <WorkspaceSettingsDialog
        indexBusy={null}
        indexStatus={null}
        onChooseFolder={() => {}}
        onClose={() => {}}
        onOpenWorkspaceSwitcher={() => {}}
        onRunIndexUpdate={() => {}}
        onSave={() => {}}
        settings={workspaceSettingsDialogFixture({
          section: "agents",
          agentCommands: [{
            id: "claude",
            label: "Claude",
            handle: "claude",
            command: "claude -p",
            adapter: "claude-code",
            continuityPolicy: "continuous",
            cwdPolicy: "workspace_root",
            promptDelivery: "stdin",
            version: 1,
            enabled: true,
          }, {
            id: "codex",
            label: "Codex",
            handle: "codex",
            command: "codex exec",
            adapter: "codex-cli",
            continuityPolicy: "fresh",
            cwdPolicy: "workspace_root",
            promptDelivery: "stdin",
            version: 1,
            enabled: true,
          }],
        })}
        setSettings={() => {}}
        structuralDraftKey={workspaceSettingsStructuralDraftKey}
      />,
    );

    expect(html).toContain("Agents");
    expect(html).toContain("@claude");
    expect(workspaceSettingsDialogIntroCopy("agents", false)).toBe("Configure the agents available from @ mentions.");
    expect(html).toContain("claude -p");
    expect(html).toContain("Keep context");
    expect(html).toContain("Unavailable");
  });

  it("explains pending embeddings after a failed sync instead of only saying pending", () => {
    const copy = indexSettingsStatusCopy(indexStatusFixture({
      pendingEmbeddings: 12,
      recentJobs: [
        {
          id: "index-job-1",
          kind: "sync",
          reason: "settings",
          status: "completed",
          startedAt: "2026-07-03T10:00:00.000Z",
          completedAt: "2026-07-03T10:00:02.000Z",
          durationMs: 2_000,
          documentCount: 42,
          pendingEmbeddings: 12,
          warnings: ["Embedding failed (no such module: vec0); lexical search remains available."],
        },
      ],
    }), null);

    expect(copy?.text).toContain("12 notes waiting after embedding failed");
    expect(copy?.text).toContain("Build embeddings");
    expect(copy?.text).toContain("lexical search remains available");
    expect(copy?.text).not.toContain("ready");
  });

  it("shows in-progress index action status before a fresh status arrives", () => {
    expect(indexSettingsStatusCopy(null, "syncing")?.text).toContain("Status will refresh when it finishes");
    expect(indexSettingsStatusCopy(indexStatusFixture(), "updating")?.text).toContain("Embedding status will update");
    expect(indexSettingsStatusCopy(indexStatusFixture(), "embedding")?.text).toContain("semantic embeddings");
    expect(indexSettingsStatusCopy(indexStatusFixture(), "embedding")?.text).toContain("QMD");
    expect(indexSettingsStatusCopy(indexStatusFixture(), "syncing")?.text).not.toContain("rebuild");
  });

  it("explains automatic and manual pending-embedding behavior without adding a setting", () => {
    const pending = indexStatusFixture({ pendingEmbeddings: 3 });
    const automatic = indexSettingsStatusCopy(pending, null, "on-save")?.text;
    const manual = indexSettingsStatusCopy(pending, null, "manual")?.text;

    expect(automatic).toContain("3 notes waiting");
    expect(automatic).toContain("catch up automatically while Exo is idle");
    expect(automatic).toContain("lexical search remains available");
    expect(automatic).toContain("Build embeddings runs now");
    expect(manual).toContain("3 notes waiting");
    expect(manual).toContain("Automatic updates are paused");
    expect(manual).toContain("lexical search remains available");
    expect(manual).toContain("Sync now or Build embeddings");
  });

  it("shows the waiting-note count in the app search badge", () => {
    expect(summarizeIndexStatus(indexStatusFixture({ pendingEmbeddings: 1 }), null)).toMatchObject({
      label: "1 note waiting",
      tone: "warn",
      busy: false,
    });
    expect(summarizeIndexStatus(indexStatusFixture({ pendingEmbeddings: 12 }), null).label).toBe("12 notes waiting");
  });

  it("keeps provider failures out of the settings surface", () => {
    const copy = indexSettingsStatusCopy(indexStatusFixture({ errors: ["ENOENT: mkdir '/.exo'"] }), null);

    expect(copy?.text).toBe("QMD is unavailable. Simple search still works; switch engines or sync QMD to recover.");
    expect(copy?.text).not.toContain("ENOENT");
  });

  it("renders index guidance and precise activity labels", () => {
    const html = renderToStaticMarkup(
      <WorkspaceSettingsDialog
        indexBusy={null}
        indexStatus={indexStatusFixture({
          pendingEmbeddings: 3,
          recentJobs: [
            {
              id: "index-job-1",
              kind: "sync",
              reason: "settings",
              status: "completed",
              startedAt: "2026-07-03T10:00:00.000Z",
              completedAt: "2026-07-03T10:00:02.000Z",
              durationMs: 2_000,
              documentCount: 10,
              pendingEmbeddings: 3,
              warnings: [],
            },
          ],
        })}
        onChooseFolder={() => {}}
        onClose={() => {}}
        onOpenWorkspaceSwitcher={() => {}}
        onRunIndexUpdate={() => {}}
        onSave={() => {}}
        settings={workspaceSettingsDialogFixture({
          section: "index",
          indexedRoots: ["/workspace/notes"],
          indexMode: "hybrid",
          searchEngine: "qmd",
          appliedWorkspaceKey: workspaceSettingsStructuralDraftKey(workspaceSettingsDialogFixture({
            indexedRoots: ["/workspace/notes"],
            indexMode: "hybrid",
            searchEngine: "qmd",
          })),
        })}
        setSettings={() => {}}
        structuralDraftKey={workspaceSettingsStructuralDraftKey}
      />,
    );

    expect(html).toContain("3 notes waiting");
    expect(html).toContain("catch up automatically while Exo is idle");
    expect(html).toContain("Search engine");
    expect(html).toContain("QMD retrieval");
    expect(html).not.toContain("3 pending embeddings");
    expect(html).toContain("Search maintenance");
    expect(html).toContain("QMD");
    expect(html).not.toContain("Press Apply");
  });

  it("keeps QMD maintenance out of Simple search settings", () => {
    const html = renderToStaticMarkup(
      <WorkspaceSettingsDialog
        indexBusy={null}
        indexStatus={indexStatusFixture()}
        onChooseFolder={() => {}}
        onClose={() => {}}
        onOpenWorkspaceSwitcher={() => {}}
        onRunIndexUpdate={() => {}}
        onSave={() => {}}
        settings={workspaceSettingsDialogFixture({ section: "index", searchEngine: "filesystem" })}
        setSettings={() => {}}
        structuralDraftKey={workspaceSettingsStructuralDraftKey}
      />,
    );

    expect(html).toContain("Simple search is active");
    expect(html).not.toContain("Search maintenance");
    expect(html).not.toContain("Sync now");
  });
});

function indexStatusFixture(overrides: Partial<IndexStatus> = {}): IndexStatus {
  return {
    enabled: true,
    mode: "hybrid",
    backend: "qmd",
    dbPath: "/workspace/.exo/qmd/index.sqlite",
    runtimePath: "/workspace/.exo/qmd",
    indexedRoots: [
      {
        id: "index-root-1",
        label: "notes",
        path: "/workspace/notes",
        kind: "mixed",
        pattern: "**/*.md",
        ignore: [],
        backend: "qmd",
      },
    ],
    documentCount: 10,
    pendingEmbeddings: 0,
    hasVectorIndex: true,
    lastUpdated: "2026-07-03T10:00:00.000Z",
    warnings: [],
    errors: [],
    ...overrides,
  };
}

function workspaceSettingsDialogFixture(
  overrides: Partial<WorkspaceSettingsDialogState> = {},
): WorkspaceSettingsDialogState {
  return {
    section: "workspace",
    settingsRevision: null,
    workspaceRoot: "/workspace",
    defaultTerminalCwd: "/workspace",
    noteRoots: ["/workspace/notes"],
    indexedRoots: [],
    indexMode: "off",
    searchEngine: "filesystem",
    appearanceMode: "system",
    colorThemeId: "exo-neutral",
    editorFontSize: "15",
    terminalFontSize: "13",
    explorerScale: "1",
    exploreIndexSearchOnEnter: false,
    indexUpdateStrategy: "on-save",
    agentCommands: [],
    saveStatus: "idle",
    errorMessage: null,
    appliedWorkspaceKey: "",
    applyStatus: "idle",
    applyErrorMessage: null,
    ...overrides,
  };
}

describe("terminal renderer registry", () => {
  it("refreshes the terminal surface before focusing after pane handoff", () => {
    const terminal = { focus: vi.fn() };
    const refresh = vi.fn();

    registerTerminal("terminal-1", 1, terminal as never, vi.fn(), refresh);
    try {
      expect(focusTerminal("terminal-1")).toBe(true);
      expect(refresh).toHaveBeenCalledBefore(terminal.focus);
      expect(terminal.focus).toHaveBeenCalledTimes(1);
    } finally {
      unregisterTerminal("terminal-1");
    }
  });

  it("does not refresh unrelated registered terminal surfaces during pane handoff", () => {
    const refreshOne = vi.fn();
    const refreshTwo = vi.fn();

    registerTerminal("terminal-1", 1, { focus: vi.fn() } as never, vi.fn(), refreshOne);
    registerTerminal("terminal-2", 1, { focus: vi.fn() } as never, vi.fn(), refreshTwo);
    try {
      expect(focusTerminal("terminal-1")).toBe(true);
      expect(refreshOne).toHaveBeenCalledTimes(1);
      expect(refreshTwo).not.toHaveBeenCalled();
    } finally {
      unregisterTerminal("terminal-1");
      unregisterTerminal("terminal-2");
    }
  });

  it("accepts only the registered attach generation for mounted terminal writes", () => {
    const write = vi.fn();

    registerTerminal("terminal-1", 1, { focus: vi.fn() } as never, write);
    try {
      expect(writeTerminalData("terminal-1", 2, "new generation")).toBe(false);
      expect(writeTerminalData("terminal-1", 1, "current generation")).toBe(true);
      registerTerminal("terminal-1", 2, { focus: vi.fn() } as never, write);
      expect(writeTerminalData("terminal-1", 1, "stale generation")).toBe(false);
      expect(write).toHaveBeenCalledTimes(1);
      expect(write).toHaveBeenCalledWith("current generation");
    } finally {
      unregisterTerminal("terminal-1");
    }
  });
});

describe("workspace terminal settings", () => {
  it("keeps terminal runtime bounds out of persisted settings", () => {
    const store = new WorkspaceSettingsStore({ userDataPath: "/tmp/exo-test", env: {} });
    const settings = store.normalize({
      workspaceRoot: "/tmp/exo-test/workspace",
      defaultTerminalCwd: "/tmp/exo-test/workspace",
      noteRoots: ["/tmp/exo-test/workspace/notes"],
      projectRoots: [],
      indexedRoots: [],
      indexing: { enabled: false, mode: "off", backend: "qmd" },
    });

    expect(settings).not.toBeNull();
    expect(resolveSettingsTerminalRuntime(settings!)).toMatchObject({
      scrollbackLines: 100_000,
      readTailChars: 20_000,
    });
    for (const key of ["terminalHistoryLines", "terminalTranscriptRetention", "terminalTranscriptRetentionDays", "terminalStreamingMode", "terminalAgentTransport", "terminalScrollbackLines", "terminalBufferChars"]) {
      expect(settings).not.toHaveProperty(key);
    }
  });

  it("drops retired terminal tuning without changing internal runtime defaults", () => {
    const store = new WorkspaceSettingsStore({ userDataPath: "/tmp/exo-test", env: {} });
    const settings = store.normalize({
      workspaceRoot: "/tmp/exo-test/workspace",
      defaultTerminalCwd: "/tmp/exo-test/workspace",
      noteRoots: ["/tmp/exo-test/workspace/notes"],
      projectRoots: [],
      indexedRoots: [],
      indexing: { enabled: false, mode: "off", backend: "qmd" },
      terminalHistoryLines: 24_000,
      terminalTranscriptRetention: "days",
      terminalTranscriptRetentionDays: 30,
    });

    expect(settings).not.toBeNull();
    expect(resolveSettingsTerminalRuntime(settings!)).toMatchObject({
      scrollbackLines: 100_000,
      readTailChars: 20_000,
    });
    for (const key of ["terminalHistoryLines", "terminalTranscriptRetention", "terminalTranscriptRetentionDays"]) {
      expect(settings).not.toHaveProperty(key);
    }
  });
});

describe("workspace settings renderer model", () => {
  it("does not revive retired terminal settings through dialog saves", () => {
    const current = normalizeWorkspaceSettings({
      workspaceRoot: "/workspace",
      defaultTerminalCwd: "/workspace",
      noteRoots: ["/workspace/notes"],
      projectRoots: [],
      indexedRoots: [],
      indexing: { enabled: false, mode: "off", backend: "qmd" },
      terminalHistoryLines: 24_000,
      terminalTranscriptRetention: "days",
      terminalTranscriptRetentionDays: 30,
    });

    expect(current).not.toBeNull();
    const next = workspaceSettingsFromDialog(
      workspaceSettingsDialogFixture({ appearanceMode: "dark", terminalFontSize: "16" }),
      { includeStructural: false },
      current,
    );

    expect(next).toMatchObject({ appearanceMode: "dark", terminalFontSize: 16 });
    expect(next).not.toHaveProperty("terminalHistoryLines");
    expect(next).not.toHaveProperty("terminalTranscriptRetention");
    expect(next).not.toHaveProperty("terminalTranscriptRetentionDays");
  });

  it("keeps structural draft keys aligned with saved settings keys", () => {
    const store = new WorkspaceSettingsStore({ userDataPath: "/tmp/exo-test", env: {} });
    const settings = store.normalize({
      workspaceRoot: "/workspace",
      defaultTerminalCwd: "/workspace/project",
      noteRoots: ["/workspace/notes"],
      indexedRoots: [{
        id: "index-notes",
        label: "notes",
        path: "/workspace/notes",
        kind: "notes",
        pattern: "**/*.md",
        ignore: [],
        backend: "qmd",
      }],
      indexing: { enabled: true, mode: "lexical", backend: "qmd" },
    });

    expect(settings).not.toBeNull();
    expect(workspaceSettingsStructuralDraftKey({
      section: "workspace",
      settingsRevision: null,
      workspaceRoot: "/workspace",
      defaultTerminalCwd: "/workspace/project",
      noteRoots: ["/workspace/notes"],
      indexedRoots: ["/workspace/notes"],
      indexMode: "lexical",
      searchEngine: "qmd",
      appearanceMode: "system",
      colorThemeId: "exo-neutral",
      editorFontSize: "15",
      terminalFontSize: "13",
      explorerScale: "1",
      exploreIndexSearchOnEnter: true,
      indexUpdateStrategy: "on-save",
      agentCommands: [],
      saveStatus: "idle",
      errorMessage: null,
      appliedWorkspaceKey: "",
      applyStatus: "idle",
      applyErrorMessage: null,
    })).toBe(workspaceSettingsStructuralKeyFromSettings(settings!));
  });

  it("tracks color theme in immediate settings saves", () => {
    const base = {
      section: "appearance" as const,
      settingsRevision: null,
      workspaceRoot: "/workspace",
      defaultTerminalCwd: "/workspace",
      noteRoots: ["/workspace/notes"],
      projectRoots: [],
      indexedRoots: [],
      indexMode: "off" as const,
      searchEngine: "filesystem" as const,
      appearanceMode: "system" as const,
      colorThemeId: "exo-neutral" as const,
      editorFontSize: "15",
      terminalFontSize: "13",
      explorerScale: "1",
      exploreIndexSearchOnEnter: false,
      indexUpdateStrategy: "on-save" as const,
      agentCommands: [],
      saveStatus: "idle" as const,
      errorMessage: null,
      appliedWorkspaceKey: "",
      applyStatus: "idle" as const,
      applyErrorMessage: null,
    };

    expect(workspaceSettingsImmediateDraftKey(base)).not.toBe(
      workspaceSettingsImmediateDraftKey({ ...base, colorThemeId: "exo-solar" }),
    );
  });

  it("uses fixed internal scrollback and ignores legacy history fields", () => {
    const store = new WorkspaceSettingsStore({ userDataPath: "/tmp/exo-test", env: {} });
    const settings = store.normalize({
      workspaceRoot: "/workspace",
      defaultTerminalCwd: "/workspace",
      noteRoots: ["/workspace/notes"],
      projectRoots: [],
      indexedRoots: [],
      indexing: { enabled: false, mode: "off", backend: "qmd" },
      // Old persisted settings may include both fields. Runtime bounds stay
      // internal and neither is retained as a user preference.
      terminalHistoryMode: "full",
      terminalHistoryLines: 1_000_000,
    } as Parameters<WorkspaceSettingsStore["normalize"]>[0] & { terminalHistoryMode: "full" });

    expect(settings ? resolveSettingsTerminalRuntime(settings).scrollbackLines : null).toBe(100_000);
    expect(clampNumber(Number.NaN, 10, 20)).toBe(10);
    expect(clampNumber(25, 10, 20)).toBe(20);
    expect(clampNumber(15, 10, 20)).toBe(15);
  });
});

describe("renderer theme registry", () => {
  it("resolves named themes and applies runtime css variables", () => {
    const properties = new Map<string, string>();
    const root = {
      dataset: {} as Record<string, string>,
      style: {
        setProperty: (name: string, value: string) => properties.set(name, value),
        getPropertyValue: (name: string) => properties.get(name) ?? "",
      },
    } as unknown as HTMLElement;
    const theme = resolveTheme("exo-solar", "dark");

    applyTheme(root, theme);

    expect(root.dataset.colorTheme).toBe("exo-solar");
    expect(root.style.getPropertyValue("--editor-bg")).toBe("#1f1f1f");
    expect(resolveTheme("unknown-theme", "light").id).toBe("exo-neutral-light");
  });

  it("keeps core text, syntax, and terminal foreground pairs above AA contrast", () => {
    for (const family of THEME_FAMILIES) {
      for (const theme of Object.values(family.variants)) {
        if (!theme) {
          continue;
        }
        const editorBg = theme.css["--editor-bg"];
        const terminalBg = theme.terminal.background;

        expect(contrastRatio(theme.css["--text-primary"], editorBg), theme.id).toBeGreaterThanOrEqual(4.5);
        expect(contrastRatio(theme.terminal.foreground, terminalBg), theme.id).toBeGreaterThanOrEqual(4.5);
        for (const [slot, color] of Object.entries(theme.syntax)) {
          expect(contrastRatio(color, editorBg), `${theme.id} syntax ${slot}`).toBeGreaterThanOrEqual(4.5);
        }
      }
    }
  });
});

describe("workspace registry", () => {
  it("persists saved workspaces for the switcher", async () => {
    const userDataPath = await mkdtemp(path.join(os.tmpdir(), "exo-workspace-registry-"));
    const store = new WorkspaceSettingsStore({ userDataPath, env: {} });

    try {
      const firstSettings = store.normalize({
        workspaceRoot: "/tmp/exo-test/notes-alpha",
        defaultTerminalCwd: "/tmp/exo-test/notes-alpha",
        noteRoots: ["/tmp/exo-test/notes-alpha"],
        projectRoots: ["/tmp/exo-test/project-alpha"],
        indexedRoots: [],
        indexing: { enabled: false, mode: "off", backend: "qmd" },
      });
      const secondSettings = store.normalize({
        workspaceRoot: "/tmp/exo-test/notes-beta",
        defaultTerminalCwd: "/tmp/exo-test/project-beta",
        noteRoots: ["/tmp/exo-test/notes-beta"],
        projectRoots: ["/tmp/exo-test/project-beta"],
        indexedRoots: [],
        indexing: { enabled: false, mode: "off", backend: "qmd" },
      });

      expect(firstSettings).not.toBeNull();
      expect(secondSettings).not.toBeNull();
      const firstSnapshot = await store.save({ settings: firstSettings!, expectedRevision: null });
      await store.save({ settings: secondSettings!, expectedRevision: firstSnapshot.revision });

      const workspaces = await store.listWorkspaces();
      expect(workspaces.map((workspace) => workspace.label)).toEqual(["notes-beta", "notes-alpha"]);
      expect(workspaces[0].settings.defaultTerminalCwd).toBe("/tmp/exo-test/project-beta");
      await expect(store.getWorkspace(workspaces[1].id)).resolves.toMatchObject({
        notesFolder: "/tmp/exo-test/notes-alpha",
      });
    } finally {
      await rm(userDataPath, { recursive: true, force: true });
    }
  });
});

describe("workspace onboarding model", () => {
  it("defaults terminal cwd to the parent of the selected notes folder", () => {
    expect(defaultTerminalCwdForNotesFolder("/Users/tester/lab/notes")).toBe("/Users/tester/lab");
    expect(defaultTerminalCwdForNotesFolder("/Users/tester/lab/notes/")).toBe("/Users/tester/lab");
    expect(defaultTerminalCwdForNotesFolder("/notes")).toBe("/notes");
  });

});

describe("terminal input filtering", () => {
  it("identifies xterm-generated device response sequences", () => {
    expect(isTerminalGeneratedResponse("\x1b[>0;276;0c")).toBe(true);
    expect(isTerminalGeneratedResponse("0;276;0c")).toBe(true);
    expect(isTerminalGeneratedResponse("\x1b[0n")).toBe(true);
    expect(isTerminalGeneratedResponse("\x1b[24;80R")).toBe(true);
    expect(isTerminalGeneratedResponse("\x1b]10;rgb:5858/6e6e/7575\x1b\\")).toBe(true);
    expect(isTerminalGeneratedResponse("\x1b]11;rgb:fdfd/f6f6/e3e3\x1b\\")).toBe(true);
    expect(isTerminalGeneratedResponse("\x1b]12;rgb:5858/6e6e/7575\x1b\\")).toBe(true);
    expect(isTerminalGeneratedResponse("\x1b]4;2;rgb:0000/8080/0000\x1b\\")).toBe(true);
    expect(isTerminalGeneratedResponse("\x1b]10;rgb:5858/6e6e/7575\x1b\\\x1b]11;rgb:fdfd/f6f6/e3e3\x1b\\")).toBe(true);
    expect(isTerminalGeneratedResponse("\x1b]10;rgb:5858/6e6e/7575\x07")).toBe(true);
    expect(isTerminalGeneratedResponse("]10;rgb:5858/6e6e/7575\\")).toBe(true);
    expect(isTerminalGeneratedResponse("]10;rgb:5858/6e6e/7575\\]11;rgb:fdfd/f6f6/e3e3\\")).toBe(true);
    expect(isTerminalGeneratedResponse("\x1b]10;not-rgb\x1b\\")).toBe(false);
    expect(isTerminalGeneratedResponse("hello")).toBe(false);
    expect(isTerminalGeneratedResponse("try this out")).toBe(false);
  });
});

describe("markdown live preview title suppression", () => {
  it("only suppresses exact generated daily-title H1 lines", () => {
    expect(shouldSuppressGeneratedTitleLine("# 2026-06-14", "2026-06-14")).toBe(true);
    expect(shouldSuppressGeneratedTitleLine("# Daily Review", "2026-06-14")).toBe(false);
    expect(shouldSuppressGeneratedTitleLine("## 2026-06-14", "2026-06-14")).toBe(false);
    expect(shouldSuppressGeneratedTitleLine("# 2026-06-14", null)).toBe(false);
  });

  it("keeps spaces in Markdown image filenames while removing an optional title", () => {
    expect(markdownImageTarget("attachments/chart one.png")).toBe("attachments/chart one.png");
    expect(markdownImageTarget('attachments/chart one.png "Quarterly chart"')).toBe("attachments/chart one.png");
    expect(markdownImageTarget("  attachments/chart%20one.png  ")).toBe("attachments/chart%20one.png");
  });
});

describe("markdown live preview viewport work", () => {
  it("limits decoration work to the visible editor lines", () => {
    const state = EditorState.create({ doc: Array.from({ length: 5_000 }, (_, index) => `line ${index + 1}`).join("\n") });

    expect(visibleLineNumbers(state.doc, [{ from: 0, to: 20 }])).toEqual([1, 2, 3]);
    expect(visibleLineNumbers(state.doc, [{ from: state.doc.length - 20, to: state.doc.length }])).toEqual([4_998, 4_999, 5_000]);
  });

  it("repairs list metadata locally across line joins and line-number shifts", () => {
    const initial = EditorState.create({
      doc: [
        "# Before",
        "",
        "- first",
        "  - nested",
        "",
        "Paragraph",
        "",
        "- distant",
      ].join("\n"),
    });
    const joinAt = initial.doc.line(3).to;
    const transaction = initial.update({ changes: { from: joinAt, to: joinAt + 1, insert: " " } });

    const repaired = updateListMetadataForChanges(
      initial.doc,
      transaction.newDoc,
      transaction.changes,
      collectListMetadata(initial.doc),
    );

    expect([...repaired].sort(([left], [right]) => left - right)).toEqual([...collectListMetadata(transaction.newDoc)]);
    expect(repaired.get(7)).toMatchObject({ marker: "-", isListStart: true });
  });

  it("repairs both list blocks when deleting their blank-line boundary", () => {
    const initial = EditorState.create({ doc: "- first\n\n  - second\ncontinuation" });
    const boundary = initial.doc.line(1).to;
    const transaction = initial.update({ changes: { from: boundary, to: boundary + 1 } });

    const repaired = updateListMetadataForChanges(
      initial.doc,
      transaction.newDoc,
      transaction.changes,
      collectListMetadata(initial.doc),
    );

    expect([...repaired].sort(([left], [right]) => left - right)).toEqual([...collectListMetadata(transaction.newDoc)]);
  });

  it("remaps distant table and fence metadata without changing full-collection results", () => {
    const initial = EditorState.create({
      doc: [
        "# Before",
        "",
        "Paragraph above structures.",
        "",
        "| Name | Value |",
        "| --- | ---: |",
        "| alpha | 1 |",
        "",
        "```ts",
        "const answer = 42;",
        "```",
        "",
        "- item",
      ].join("\n"),
    });
    const transaction = initial.update({ changes: { from: initial.doc.line(2).from, insert: "A new line.\n" } });

    const repaired = updateMarkdownPreviewMetadataForChanges(
      initial.doc,
      transaction.newDoc,
      transaction.changes,
      markdownPreviewMetadata(initial.doc),
    );

    expect(repaired).toEqual(markdownPreviewMetadata(transaction.newDoc));
  });

  it("recollects table and fence metadata when their structure changes", () => {
    const tableInitial = EditorState.create({
      doc: "# Tables\n\n| Name | Value |\n| --- | ---: |\n| alpha | 1 |\n",
    });
    const separator = tableInitial.doc.line(4);
    const tableTransaction = tableInitial.update({ changes: { from: separator.from, to: separator.to, insert: "not a table" } });
    const tableRepaired = updateMarkdownPreviewMetadataForChanges(
      tableInitial.doc,
      tableTransaction.newDoc,
      tableTransaction.changes,
      markdownPreviewMetadata(tableInitial.doc),
    );
    expect(tableRepaired).toEqual(markdownPreviewMetadata(tableTransaction.newDoc));

    const fenceInitial = EditorState.create({ doc: "# Fence\n\n```ts\nconst answer = 42;\n```\n" });
    const closingFence = fenceInitial.doc.line(5);
    const fenceTransaction = fenceInitial.update({ changes: { from: closingFence.from, to: closingFence.to, insert: "plain text" } });
    const fenceRepaired = updateMarkdownPreviewMetadataForChanges(
      fenceInitial.doc,
      fenceTransaction.newDoc,
      fenceTransaction.changes,
      markdownPreviewMetadata(fenceInitial.doc),
    );
    expect(fenceRepaired).toEqual(markdownPreviewMetadata(fenceTransaction.newDoc));
  });

  it("updates table content and remaps fence content without rescanning unrelated lines", () => {
    const initial = EditorState.create({
      doc: [
        "# Structured edits",
        "",
        "| Name | Value |",
        "| --- | ---: |",
        "| alpha | 1 |",
        "",
        "```ts",
        "const answer = 42;",
        "```",
      ].join("\n"),
    });
    const tableCell = initial.doc.line(5);
    const fenceBody = initial.doc.line(8);
    const transaction = initial.update({ changes: [
      { from: tableCell.from + tableCell.text.indexOf("alpha"), to: tableCell.from + tableCell.text.indexOf("alpha") + 5, insert: "beta" },
      { from: fenceBody.from + fenceBody.text.indexOf("42"), to: fenceBody.from + fenceBody.text.indexOf("42") + 2, insert: "43" },
    ] });

    const repaired = updateMarkdownPreviewMetadataForChanges(
      initial.doc,
      transaction.newDoc,
      transaction.changes,
      markdownPreviewMetadata(initial.doc),
    );

    expect(repaired).toEqual(markdownPreviewMetadata(transaction.newDoc));
    expect(repaired.tableContexts.get(5)?.rows).toEqual([["beta", "1"]]);
  });
});

describe("terminal output chunking", () => {
  it("preserves the terminal render-stability corpus across renderer write chunks", () => {
    const renderStabilityOutput = terminalRenderStabilityBody();

    const chunks = chunkTerminalData(renderStabilityOutput, 7);

    expect(chunks.join("")).toBe(renderStabilityOutput);
    expect(terminalRenderStabilityIssues(chunks.join(""), { requireExpectedFragments: true })).toEqual([]);
    expect(chunks.every((chunk) => !endsWithHighSurrogate(chunk) && !startsWithLowSurrogate(chunk))).toBe(true);
  });

  it("does not split surrogate-pair emoji across xterm write chunks", () => {
    const chunks = chunkTerminalData(`ab🙂cd`, 3);

    expect(chunks).toEqual(["ab", "🙂c", "d"]);
    expect(chunks.join("")).toBe("ab🙂cd");
    expect(chunks.every((chunk) => !endsWithHighSurrogate(chunk) && !startsWithLowSurrogate(chunk))).toBe(true);
  });

  it("does not split CSI cursor-position sequences across xterm write chunks", () => {
    const chunks = chunkTerminalData("abcd\x1b[12;34Hef", 7);

    expect(chunks).toEqual(["abcd", "\x1b[12;34H", "ef"]);
    expect(chunks.join("")).toBe("abcd\x1b[12;34Hef");
  });

  it("does not split OSC sequences across xterm write chunks", () => {
    const chunks = chunkTerminalData("ab\x1b]10;rgb:ffff/ffff/ffff\x1b\\cd", 8);

    expect(chunks).toEqual(["ab", "\x1b]10;rgb:ffff/ffff/ffff\x1b\\", "cd"]);
    expect(chunks.join("")).toBe("ab\x1b]10;rgb:ffff/ffff/ffff\x1b\\cd");
  });

  it("carries surrogate pairs split across terminal data events", () => {
    const chunker = new TerminalOutputChunker();
    const emoji = "🙂";
    const high = emoji.charAt(0);
    const low = emoji.charAt(1);

    expect(chunker.chunks(`prompt ${high}`, 64)).toEqual(["prompt "]);
    expect(chunker.chunks(`${low} ready`, 64)).toEqual(["🙂 ready"]);
  });

  it("clears pending surrogate data when the terminal stream resets", () => {
    const chunker = new TerminalOutputChunker();
    const emoji = "🙂";

    expect(chunker.chunks(emoji.charAt(0), 64)).toEqual([]);
    chunker.reset();
    expect(chunker.chunks("fresh", 64)).toEqual(["fresh"]);
  });
});

describe("terminal presentation normalization", () => {
  it("asks Claude action markers to render as text without changing other emoji", () => {
    expect(normalizeTerminalPresentation("⏺ Hey 🙂")).toBe("⏺︎ Hey 🙂");
  });

  it("does not duplicate explicit text or emoji presentation selectors", () => {
    expect(normalizeTerminalPresentation("⏺︎ text ⏺️ emoji")).toBe("⏺︎ text ⏺️ emoji");
  });
});

describe("terminal font configuration", () => {
  it("uses font fallback instead of xterm custom glyph drawing for agent TUIs", () => {
    expect(TERMINAL_CUSTOM_GLYPHS).toBe(false);
    expect(TERMINAL_FONT_FAMILY).toContain('"Apple Symbols"');
    expect(TERMINAL_FONT_FAMILY).toContain('"Apple Color Emoji"');
    expect(TERMINAL_FONT_FAMILY).toContain('"Symbols Nerd Font');
    expect(TERMINAL_FONT_FAMILY).toMatch(/^"IBM Plex Mono"/);
  });
});

function endsWithHighSurrogate(value: string): boolean {
  const code = value.charCodeAt(value.length - 1);
  return code >= 0xd800 && code <= 0xdbff;
}

function startsWithLowSurrogate(value: string): boolean {
  const code = value.charCodeAt(0);
  return code >= 0xdc00 && code <= 0xdfff;
}

describe("markdown editor list behavior", () => {
  it("continues unordered lists on Enter", () => {
    const state = EditorState.create({ doc: "- account strategy" });
    const edit = listEnterEdit(state, state.doc.length);

    expect(edit).toEqual({
      from: state.doc.length,
      to: state.doc.length,
      insert: "\n- ",
      selection: state.doc.length + 3,
      exitList: false,
    });
  });

  it("increments ordered lists on Enter", () => {
    const state = EditorState.create({ doc: "  9. account strategy" });
    const edit = listEnterEdit(state, state.doc.length);

    expect(edit).toEqual({
      from: state.doc.length,
      to: state.doc.length,
      insert: "\n  10. ",
      selection: state.doc.length + 7,
      exitList: false,
    });
  });

  it("continues task lists as unchecked task items on Enter", () => {
    const state = EditorState.create({ doc: "- [x] follow up" });
    const edit = listEnterEdit(state, state.doc.length);

    expect(edit).toEqual({
      from: state.doc.length,
      to: state.doc.length,
      insert: "\n- [ ] ",
      selection: state.doc.length + 7,
      exitList: false,
    });
  });

  it("exits empty list items on Enter", () => {
    const state = EditorState.create({ doc: "  - " });
    const edit = listEnterEdit(state, state.doc.length);

    expect(edit).toEqual({
      from: 0,
      to: state.doc.length,
      insert: "",
      selection: 0,
      exitList: true,
    });
  });

  it("exits empty task list items on Enter", () => {
    const state = EditorState.create({ doc: "  - [ ] " });
    const edit = listEnterEdit(state, state.doc.length);

    expect(edit).toEqual({
      from: 0,
      to: state.doc.length,
      insert: "",
      selection: 0,
      exitList: true,
    });
  });

  it("clamps shortcut selections to rendered list text", () => {
    const state = EditorState.create({ doc: "- some important text" });
    const anchor = state.doc.length;
    const selection = clampSelectionToRenderedListText(state, anchor, 0);

    expect(selection?.anchor).toBe(anchor);
    expect(selection?.head).toBe("- ".length);
  });
});

describe("markdown editor wikilink behavior", () => {
  it("exits a wikilink without inserting trailing whitespace", () => {
    const state = EditorState.create({ doc: "Discuss [[customer-name]]today" });
    const pos = "Discuss [[customer-name".length;

    expect(wikilinkExitEdit(state, pos)).toEqual({
      insertAt: "Discuss [[customer-name]]".length,
      insert: "",
      selection: "Discuss [[customer-name]]".length,
    });
  });

  it("does not treat the closing edge of a wikilink as editable interior", () => {
    const state = EditorState.create({ doc: "Discuss [[customer-name]] today" });
    const pos = "Discuss [[customer-name]]".length;

    expect(wikilinkExitEdit(state, pos)).toBeNull();
  });

  it("does not handle Tab or Enter outside wikilinks", () => {
    const state = EditorState.create({ doc: "Discuss customer-name" });

    expect(wikilinkExitEdit(state, state.doc.length)).toBeNull();
  });

  it("finds the active wikilink query and accepts a selected suggestion", () => {
    const state = EditorState.create({ doc: "See [[go]] next" });
    const pos = "See [[go".length;
    const context = getWikilinkCompletionContext(state, pos);

    expect(context).toEqual({ from: "See ".length, to: "See [[go]]".length, query: "go" });
    expect(wikilinkSuggestionEdit(context!, { label: "goals", target: "goals" })).toEqual({
      insert: "[[goals]]",
      selection: "See [[goals]]".length,
    });
    expect(wikilinkSuggestionEdit(context!, { label: "Self-Improving Business Systems", target: "garden/blog/self-improving-business-systems" })).toEqual({
      insert: "[[garden/blog/self-improving-business-systems|Self-Improving Business Systems]]",
      selection: context!.from + "[[garden/blog/self-improving-business-systems|Self-Improving Business Systems]]".length,
    });
  });

  it("does not open wikilink completion outside bracket boundaries", () => {
    const state = EditorState.create({ doc: "[[goals]]" });

    expect(getWikilinkCompletionContext(state, 0)).toBeNull();
    expect(getWikilinkCompletionContext(state, 1)).toBeNull();
    expect(getWikilinkCompletionContext(state, 2)).toEqual({ from: 0, to: "[[goals]]".length, query: "goals" });
    expect(getWikilinkCompletionContext(state, "[[goals]]".length)).toBeNull();
  });

  it("filters wikilink popup candidates from the in-memory note tree", () => {
    const model = workspaceModel("/vault");
    const noteTrees: Record<string, TreeNode[]> = {
      "/vault": [
        { id: "goals", name: "goals.md", path: "/vault/goals.md", kind: "file" },
        { id: "garden", name: "garden.md", path: "/vault/garden.md", kind: "file" },
        { id: "daily", name: "daily.md", path: "/vault/logs/daily.md", kind: "file" },
        { id: "guide", name: "guide.md", path: "/vault/projects/guide.md", kind: "file" },
      ],
    };

    expect(suggestWikilinkTargetsFromTrees(model, noteTrees, "g").map((item) => item.target)).toEqual([
      "garden",
      "goals",
      "projects/guide",
    ]);
    expect(suggestWikilinkTargetsFromTrees(model, noteTrees, "missing")).toEqual([]);
  });

  it("hides generated graph references in raw markdown mode", () => {
    const graphContext = buildNoteGraphContext(graphContextFixture());

    expect(graphReferencesForMarkdownMode(true, false, graphContext)).toEqual({
      backlinks: [{ label: "Source", target: "/vault/source.md" }],
      references: [{ label: "goals", target: "goals" }],
    });
    expect(graphReferencesForMarkdownMode(true, true, graphContext)).toBeNull();
  });

  it("keeps backlink entries navigable by their file path target", () => {
    const references = graphReferencesForMarkdownMode(true, false, buildNoteGraphContext(graphContextFixture()));

    expect(references?.backlinks[0]).toEqual({ label: "Source", target: "/vault/source.md" });
  });

  it("renders one graph reference per target rather than one per mention", () => {
    const base = graphContextFixture();
    const fixture: WorkspaceGraphContext = {
      ...base,
      outgoing: [
        ...base.outgoing,
        { source: base.note.id, target: "goals", label: "Goals alias", resolution: "unresolved" },
        { source: base.note.id, target: "later", label: "Later", resolution: "unresolved" },
        { source: base.note.id, target: "goals", label: "goals", resolution: "unresolved" },
      ],
    };

    expect(graphReferencesForMarkdownMode(true, false, buildNoteGraphContext(fixture))?.references).toEqual([
      { label: "goals", target: "goals" },
      { label: "Later", target: "later" },
    ]);
  });

  it("derives active-note graph context from the bounded renderer snapshot adapter", () => {
    const graphContext = buildNoteGraphContext(graphContextFixture({ frontmatter: { status: "draft", tags: ["lab"] }, tags: ["lab"] }));

    expect(graphContext?.properties).toEqual({ status: "draft", tags: ["lab"] });
    expect(graphContext?.outgoingLinks.map((item) => item.target).sort()).toEqual(["goals", "https://example.com"]);
    expect(graphContext?.externalLinks.map((item) => item.target)).toEqual(["https://example.com"]);
    expect(graphContext?.backlinks).toEqual([{ label: "Source", target: "/vault/source.md" }]);
    expect(graphContext?.neighborhood.focusPath).toBe("/vault/current.md");
    expect(graphContext?.neighborhood.nodes.map((item) => item.kind)).toEqual(["note", "note"]);
    expect(graphContext?.neighborhood.edges).toContainEqual(expect.objectContaining({
      source: "note:notes:source.md",
      target: "note:notes:current.md",
    }));
  });

  it("returns a lightweight hover preview fallback for empty or missing note bodies", () => {
    expect(markdownPreviewExcerpt("")).toBe("Empty note");
    expect(markdownPreviewExcerpt("# Goals\n\nUse [[daily|daily notes]] and [docs](docs.md).")).toBe(
      "Goals Use daily notes and docs.",
    );
  });
});

function workspaceModel(noteRoot: string): WorkspaceModel {
  return {
    workspaceRoot: noteRoot,
    defaultTerminalCwd: noteRoot,
    noteRoots: [{ id: "notes", label: "Notes", path: noteRoot }],
    indexedRoots: [],
    indexing: { enabled: false, mode: "off", backend: "qmd" },
  };
}

function noteDocument(overrides: Partial<NoteDocument> = {}): NoteDocument {
  return {
    filePath: "/vault/current.md",
    title: "Current",
    frontmatter: {},
    body: "",
    kind: "markdown",
    ...overrides,
  };
}

function graphContextFixture(overrides: Partial<WorkspaceGraphContext["note"]> = {}): WorkspaceGraphContext {
  const note = {
    id: "note:notes:current.md" as const,
    filePath: "/vault/current.md",
    rootId: "notes",
    relativePath: "current.md",
    title: "Current",
    tags: [],
    frontmatter: {},
    ...overrides,
  };
  const source = { ...note, id: "note:notes:source.md" as const, filePath: "/vault/source.md", relativePath: "source.md", title: "Source" };
  return {
    note,
    outgoing: [
      { source: note.id, target: "goals", label: "goals", resolution: "unresolved" },
      { source: note.id, target: "https://example.com", label: "external", resolution: "external" },
    ],
    backlinks: [{ source: source.id, target: source.filePath, label: "Source", resolution: "resolved", note: source }],
    unresolved: [{ source: note.id, target: "goals", label: "goals", resolution: "unresolved" }],
    neighborhood: [note, source],
  };
}

function invocationRecord(overrides: Partial<InvocationRecord> = {}): InvocationRecord {
  return {
    id: "inv-1",
    status: "process-exited",
    context: "note",
    taggedDocumentPath: "/vault/current.md",
    originalMentionText: "@claude review this",
    mentionProvenance: "human-authored",
    message: "review this",
    promptDelivery: "terminalInputAfterLaunch",
    command: {
      id: "claude",
      label: "Claude",
      handle: "claude",
      command: "claude",
      adapter: "claude-code",
      continuityPolicy: "continuous",
      cwdPolicy: "workspace_root",
      promptDelivery: "terminalInputAfterLaunch",
      version: 1,
      enabled: true,
      executableFingerprint: "fingerprint",
    },
    cwd: "/vault",
    createdAt: "2026-07-08T00:00:00.000Z",
    startedAt: "2026-07-08T00:00:01.000Z",
    endedAt: "2026-07-08T00:00:02.000Z",
    changedFileRefs: [],
    diffRefs: [],
    attribution: { status: "pending" },
    continuity: { policy: "continuous", outcome: "fresh" },
    ...overrides,
  };
}

function terminalSessionFixture(overrides: Partial<TerminalSessionInfo> = {}): TerminalSessionInfo {
  return {
    id: "term-a",
    title: "Terminal",
    cwd: "/workspace",
    kind: "shell",
    command: "zsh",
    status: "running",
    health: "idle",
    healthDetail: "No recent terminal output; terminal may simply be waiting for input.",
    attachGeneration: 1,
    ...overrides,
  };
}

describe("terminal session sync", () => {
  it("detects unchanged terminal session snapshots", () => {
    const sessions = [
      {
        id: "term-a",
        title: "Shell",
        cwd: "/workspace",
        kind: "shell",
        command: "zsh",
        status: "running",
        health: "healthy",
        healthDetail: "running",
        attachGeneration: 1,
      },
    ] as const;

    expect(terminalSessionsEqual([...sessions], [...sessions])).toBe(true);
    expect(terminalSessionsEqual([...sessions], [{ ...sessions[0], healthDetail: "stale output" }])).toBe(false);
  });

  it("blocks terminal input while a running session is unhealthy", () => {
    const unhealthySession = {
      id: "term-a",
      title: "Terminal",
      cwd: "/workspace",
      kind: "shell",
      command: "zsh",
      status: "running",
      health: "unhealthy",
      healthDetail: "Terminal process is unavailable.",
      attachGeneration: 1,
    } as const;

    expect(isTerminalInputEnabled(unhealthySession)).toBe(false);
    expect(isTerminalInputEnabled({ ...unhealthySession, health: "idle" })).toBe(true);
    expect(isTerminalInputEnabled({ ...unhealthySession, status: "exited", health: "exited" })).toBe(false);
  });

  it("summarizes exited terminal state for the bottom status bar", () => {
    const sessions = [
      terminalSessionFixture({
        id: "term-codex",
        title: "Codex",
        status: "exited",
        health: "exited",
        healthDetail: "Process exited.",
      }),
    ];

    expect(summarizeTerminalStatusLine(sessions, "term-codex", new Set())).toEqual({
      label: "Terminal exited",
      tone: "warn",
      title: "Codex: Process exited.",
      busy: false,
      sessionId: "term-codex",
    });
  });

  it("prioritizes terminal loading state without requiring a floating overlay", () => {
    const sessions = [
      terminalSessionFixture({ id: "term-shell", title: "Shell" }),
      terminalSessionFixture({
        id: "term-codex",
        title: "Codex",
        status: "exited",
        health: "exited",
        healthDetail: "Process exited.",
      }),
    ];

    expect(summarizeTerminalStatusLine(sessions, "term-shell", new Set(["term-shell"]))).toEqual({
      label: "Loading terminal",
      tone: "info",
      title: "Shell: loading terminal output.",
      busy: true,
      sessionId: "term-shell",
    });
    expect(summarizeTerminalStatusLine([sessions[0]], "term-shell", new Set())).toBeNull();
  });

  it("does not let stale terminal hydration mask an unavailable session", () => {
    const sessions = [
      terminalSessionFixture({
        id: "term-shell",
        title: "Shell",
        status: "running",
        health: "unhealthy",
        healthDetail: "Unable to find live tmux pane.",
      }),
    ];

    expect(summarizeTerminalStatusLine(sessions, "term-shell", new Set(["term-shell"]))).toEqual({
      label: "Terminal unavailable",
      tone: "error",
      title: "Shell: Unable to find live tmux pane.",
      busy: false,
      sessionId: "term-shell",
    });
  });

  it("preserves terminal data that arrives before or during hydration", () => {
    expect(mergeHydrationSnapshot("", "claude ready\n")).toBe("claude ready\n");
    expect(mergeHydrationSnapshot("boot\nclaude", "claude ready\n")).toBe("boot\nclaude ready\n");
    expect(mergeHydrationSnapshot("boot\nclaude ready\n", "claude ready\n")).toBe("boot\nclaude ready\n");
  });

  it("caps pending terminal data to the newest content", () => {
    expect(appendPendingTerminalData({ generation: 1, data: "abcdef" }, 1, "ghij", 6)).toEqual({
      generation: 1,
      data: "efghij",
    });
    expect(appendPendingTerminalData({ generation: 1, data: "abcdef" }, 2, "ghij", 6)).toEqual({
      generation: 2,
      data: "ghij",
    });
  });

  it("does not split terminal Unicode while capping pending hydration data", () => {
    const emoji = "🙂";
    const high = emoji.charAt(0);
    const low = emoji.charAt(1);

    expect(appendPendingTerminalData({ generation: 1, data: `abc${high}` }, 1, low, 4).data).toBe(`bc${emoji}`);
    expect(appendPendingTerminalData({ generation: 1, data: `abc${emoji}` }, 1, "de", 4).data).toBe(`${emoji}de`);
    expect(appendPendingTerminalData({ generation: 1, data: `abc${emoji}` }, 1, "de", 3).data).toBe("de");
    expect(appendPendingTerminalData({ generation: 1, data: `abc${high}` }, 1, "", 1).data).toBe("");
  });

  it("skips mounted hydrated terminal reads unless refresh forces a snapshot", () => {
    const hydrated = new Set(["term-a"]);
    const pending = new Set<string>();

    expect(shouldSkipTerminalHydration("term-a", hydrated, pending)).toBe(true);
    expect(shouldSkipTerminalHydration("term-a", hydrated, pending, { force: true })).toBe(false);
    expect(shouldSkipTerminalHydration("term-b", hydrated, pending)).toBe(false);
    expect(shouldSkipTerminalHydration("term-a", hydrated, new Set(["term-a"]), { force: true })).toBe(true);
  });

  it("applies hydration only for first mount or explicit refresh", () => {
    const initial = initialTerminalHydrationViewState();
    const bootstrap = { snapshot: "first prompt\n", version: 1, reason: "bootstrap" as const };
    const liveMetadataRefresh = { snapshot: "stale prompt\n", version: 2, reason: "bootstrap" as const };
    const refresh = { snapshot: "refreshed prompt\n", version: 3, reason: "refresh" as const };

    expect(shouldApplyTerminalHydration(initial, { snapshot: "", version: 0, reason: "bootstrap" })).toBe(false);
    expect(shouldApplyTerminalHydration(initial, bootstrap)).toBe(true);

    const live = markTerminalHydrationApplied(initial, bootstrap);
    expect(shouldApplyTerminalHydration(live, liveMetadataRefresh)).toBe(false);
    expect(shouldApplyTerminalHydration(live, refresh)).toBe(true);
  });

  it("does not keep React-owned live terminal data after hydration is live", () => {
    expect(shouldBufferTerminalDataForHydration(false, undefined, true)).toBe(true);
    expect(shouldBufferTerminalDataForHydration(true, undefined, true)).toBe(false);
    expect(shouldBufferTerminalDataForHydration(true, "bootstrap", false)).toBe(false);
    expect(shouldBufferTerminalDataForHydration(true, "bootstrap", true)).toBe(false);
    expect(shouldBufferTerminalDataForHydration(true, "refresh", true)).toBe(false);
  });
});
