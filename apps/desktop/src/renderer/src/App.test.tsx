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
  NoteKnowledge,
  TreeNode,
  WorkspaceModel,
} from "@exo/core";

import {
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
  DEFAULT_TERMINAL_UNRESPONSIVE_THRESHOLD_MS,
  resolveTerminalRuntimePolicy,
  WorkspaceSettingsStore,
} from "../../main/settings-store";
import { BrowserPane } from "./components/BrowserPane";
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
import { normalizeFrontmatterPropertyKey, shouldUseMarkdownRenderer } from "./components/NoteEditor";
import {
  WorkspaceSettingsDialog,
  indexSettingsStatusCopy,
  workspaceSettingsDialogIntroCopy,
  workspaceSettingsSavedFooterCopy,
} from "./components/WorkspaceSettingsDialog";
import {
  clampSelectionToRenderedListText,
  listEnterEdit,
  shouldSuppressGeneratedTitleLine,
  wikilinkExitEdit,
} from "./components/markdownLivePreview";
import {
  appendPendingTerminalData,
  mergeHydrationSnapshot,
  shouldBufferTerminalDataForHydration,
  shouldSkipTerminalHydration,
} from "./hooks/useTerminalSessions";
import type { DragManager } from "./hooks/useDragManager";
import { defaultTerminalCwdForNotesFolder } from "./hooks/useWorkspaceBootstrap";
import { isTerminalInputEnabled, summarizeTerminalStatusLine, terminalSessionsEqual } from "./terminalSessions";
import { applyTheme } from "./theme/applyTheme";
import { contrastRatio } from "./theme/contrast";
import { THEME_FAMILIES, resolveTheme } from "./theme/registry";
import { terminalRenderStabilityBody, terminalRenderStabilityIssues } from "../../../tests/terminalRenderStability";
import {
  DEFAULT_TERMINAL_HISTORY_LINES as RENDERER_DEFAULT_TERMINAL_HISTORY_LINES,
  clampNumber,
  resolveSettingsTerminalRuntime,
  workspaceSettingsImmediateDraftKey,
  workspaceSettingsStructuralDraftKey,
  workspaceSettingsStructuralKeyFromSettings,
} from "./workspaceSettingsModel";
import { collectLeaves, openOrUpdateBrowserPane, type PaneNode } from "./hooks/usePaneTree";
import {
  addTerminalSessionAsSplit,
  buildTerminalMonitorTree,
  buildTerminalTabsTree,
  collectTerminalSessionIds,
  restoreTerminalTreeSnapshot,
} from "./paneTreeSelectors";
import { isNewTerminalShortcut } from "./hooks/useAppKeybindings";
import {
  buildNoteGraphContext,
  getWikilinkCompletionContext,
  graphReferencesForMarkdownMode,
  markdownPreviewExcerpt,
  suggestWikilinkTargetsFromTrees,
  wikilinkSuggestionEdit,
} from "./graphAffordances";
import { runToolSurfaceAction } from "./toolDockModel";
import type { ToolSurfaceDescriptor } from "@exo/core/surface-descriptor";
import type { WorkspaceSettingsDialogState } from "./workspaceSettingsDialogTypes";
import type { TerminalSessionInfo } from "../../shared/api";
import { hasInvocationDirtyConflict } from "./invocationReviewState";

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
});

describe("workspace settings footer copy", () => {
  it("only mentions Apply when structural changes are pending", () => {
    expect(workspaceSettingsSavedFooterCopy(true)).toContain("Apply");
    expect(workspaceSettingsSavedFooterCopy(false)).toBe("Settings saved.");
  });

  it("keeps the dialog intro from mentioning Apply when no Apply action is visible", () => {
    expect(workspaceSettingsDialogIntroCopy("index", false)).not.toContain("Apply");
    expect(workspaceSettingsDialogIntroCopy("index", false)).toContain("Core search is always on");
    expect(workspaceSettingsDialogIntroCopy("appearance", false)).not.toContain("Apply");
    expect(workspaceSettingsDialogIntroCopy("index", true)).toContain("Apply");
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

    expect(copy?.text).toContain("Documents were refreshed");
    expect(copy?.text).toContain("Build embeddings only");
    expect(copy?.text).toContain("lexical search remains available");
  });

  it("shows in-progress index action status before a fresh status arrives", () => {
    expect(indexSettingsStatusCopy(null, "syncing")?.text).toContain("Status will refresh when it finishes");
    expect(indexSettingsStatusCopy(indexStatusFixture(), "updating")?.text).toContain("Embedding status will refresh");
    expect(indexSettingsStatusCopy(indexStatusFixture(), "embedding")?.text).toContain("documents already in QMD");
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
          appliedWorkspaceKey: workspaceSettingsStructuralDraftKey(workspaceSettingsDialogFixture({
            indexedRoots: ["/workspace/notes"],
            indexMode: "hybrid",
          })),
        })}
        setSettings={() => {}}
        structuralDraftKey={workspaceSettingsStructuralDraftKey}
      />,
    );

    expect(html).toContain("Sync now refreshes documents and embeddings");
    expect(html).toContain("Core search +");
    expect(html).toContain("QMD provider mode");
    expect(html).toContain("advanced provider");
    expect(html).toContain("3 pending embeddings");
    expect(html).not.toContain("Press Apply");
  });
});

describe("browser preview panes", () => {
  const dragManager: DragManager = {
    drag: null,
    dragActive: false,
    hoverEdge: null,
    startDrag: vi.fn(),
  };

  it("creates a browser pane when none exists", () => {
    const tree: PaneNode = {
      kind: "leaf",
      id: "editor-1",
      content: { kind: "editor", openPaths: ["/workspace/readme.md"], activePath: "/workspace/readme.md" },
    };

    const result = openOrUpdateBrowserPane(tree, "editor-1", "file:///workspace/a.html");
    const leaves = collectLeaves(result.tree);

    expect(leaves).toHaveLength(2);
    expect(leaves.find((leaf) => leaf.content.kind === "browser")?.content).toMatchObject({
      kind: "browser",
      url: "file:///workspace/a.html",
    });
    expect(result.focusLeafId).toBe(leaves.find((leaf) => leaf.content.kind === "browser")?.id);
  });

  it("updates and focuses the existing browser pane instead of creating another one", () => {
    const tree: PaneNode = {
      kind: "split",
      id: "split-1",
      direction: "horizontal",
      ratio: 0.58,
      children: [
        {
          kind: "leaf",
          id: "editor-1",
          content: { kind: "editor", openPaths: ["/workspace/readme.md"], activePath: "/workspace/readme.md" },
        },
        {
          kind: "leaf",
          id: "browser-1",
          content: { kind: "browser", url: "file:///workspace/a.html" },
        },
      ],
    };

    const result = openOrUpdateBrowserPane(tree, "editor-1", "file:///workspace/b.html");
    const leaves = collectLeaves(result.tree);
    const browserLeaves = leaves.filter((leaf) => leaf.content.kind === "browser");

    expect(browserLeaves).toHaveLength(1);
    expect(browserLeaves[0]).toMatchObject({
      id: "browser-1",
      content: { kind: "browser", url: "file:///workspace/b.html" },
    });
    expect(result.focusLeafId).toBe("browser-1");
  });

  it("renders preview iframes with sandbox and no-referrer policy", () => {
    const html = renderToStaticMarkup(
      <BrowserPane
        compact={false}
        dragManager={dragManager}
        onClosePane={null}
        onFocus={() => {}}
        onNavigate={async (target) => target}
        paneId="browser-1"
        url="http://localhost:5173/report.html"
      />,
    );

    expect(html).toContain("sandbox=\"allow-forms allow-scripts\"");
    expect(html).toContain("referrerPolicy=\"no-referrer\"");
  });

});

describe("terminal monitor layout", () => {
  it("builds one readable terminal leaf per session in monitor mode", () => {
    const tree = buildTerminalMonitorTree(["term-a", "term-b", "term-c"], "term-b");
    const leaves = collectLeaves(tree);

    expect(leaves).toHaveLength(3);
    expect(leaves.every((leaf) => leaf.content.kind === "terminal")).toBe(true);
    expect(leaves.map((leaf) => leaf.content.kind === "terminal" ? leaf.content.terminalIds : [])).toEqual([
      ["term-a"],
      ["term-b"],
      ["term-c"],
    ]);
    expect(collectTerminalSessionIds(tree)).toEqual(new Set(["term-a", "term-b", "term-c"]));
  });

  it("derives stable monitor leaf identity from terminal session ids", () => {
    const firstTree = buildTerminalMonitorTree(["term-a", "term-b", "term-c"], "term-b");
    const secondTree = buildTerminalMonitorTree(["term-a", "term-b", "term-c"], "term-b");

    expect(collectLeaves(firstTree).map((leaf) => leaf.id)).toEqual([
      "terminal-session:term-a",
      "terminal-session:term-b",
      "terminal-session:term-c",
    ]);
    expect(collectLeaves(secondTree).map((leaf) => leaf.id)).toEqual(
      collectLeaves(firstTree).map((leaf) => leaf.id),
    );
  });

  it("collapses monitor sessions back to a normal tab group", () => {
    const tree = buildTerminalTabsTree(["term-a", "term-b", "term-c"], "term-b");
    const leaves = collectLeaves(tree);

    expect(leaves).toHaveLength(1);
    expect(leaves[0].content).toEqual({
      kind: "terminal",
      terminalIds: ["term-a", "term-b", "term-c"],
      activeTerminalId: "term-b",
    });
  });

  it("restores the pre-monitor terminal layout while preserving existing session placement", () => {
    const preMonitorTree: PaneNode = {
      kind: "split",
      id: "manual-split",
      direction: "horizontal",
      ratio: 0.35,
      children: [
        {
          kind: "leaf",
          id: "manual-left",
          content: {
            kind: "terminal",
            terminalIds: ["term-a", "term-b"],
            activeTerminalId: "term-b",
          },
        },
        {
          kind: "leaf",
          id: "manual-right",
          content: {
            kind: "terminal",
            terminalIds: ["term-c"],
            activeTerminalId: "term-c",
          },
        },
      ],
    };

    const monitorTree = buildTerminalMonitorTree(["term-a", "term-b", "term-c"], "term-c");
    expect(collectLeaves(monitorTree).map((leaf) => leaf.id)).toEqual([
      "terminal-session:term-a",
      "terminal-session:term-b",
      "terminal-session:term-c",
    ]);

    const restored = restoreTerminalTreeSnapshot(preMonitorTree, ["term-a", "term-c", "term-d"], "term-c");
    const restoredLeaves = collectLeaves(restored);

    expect(restored.id).toBe("manual-split");
    expect(restoredLeaves.map((leaf) => leaf.id)).toEqual(["manual-left", "manual-right"]);
    expect(restoredLeaves.map((leaf) => leaf.content.kind === "terminal" ? leaf.content.terminalIds : [])).toEqual([
      ["term-a", "term-d"],
      ["term-c"],
    ]);
    expect(restoredLeaves.map((leaf) => leaf.content.kind === "terminal" ? leaf.content.activeTerminalId : null)).toEqual([
      "term-d",
      "term-c",
    ]);
  });

  it("adds new monitor terminals as split leaves instead of hidden tabs", () => {
    const start = buildTerminalMonitorTree(["term-a"], "term-a");
    const result = addTerminalSessionAsSplit(start, "term-b");
    const leaves = collectLeaves(result.tree);

    expect(result.leafId).toBe(leaves.find((leaf) =>
      leaf.content.kind === "terminal" && leaf.content.terminalIds.includes("term-b"),
    )?.id);
    expect(leaves.map((leaf) => leaf.content.kind === "terminal" ? leaf.content.terminalIds : [])).toEqual([
      ["term-a"],
      ["term-b"],
    ]);
  });

  it("fills an empty monitor leaf with the first terminal instead of creating an empty split", () => {
    const start = buildTerminalTabsTree([], null);
    const result = addTerminalSessionAsSplit(start, "term-a");
    const leaves = collectLeaves(result.tree);

    expect(leaves).toHaveLength(1);
    expect(leaves[0].content).toEqual({
      kind: "terminal",
      terminalIds: ["term-a"],
      activeTerminalId: "term-a",
    });
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
    workspaceRoot: "/workspace",
    defaultTerminalCwd: "/workspace",
    noteRoots: ["/workspace/notes"],
    projectRoots: [],
    indexedRoots: [],
    indexMode: "off",
    appearanceMode: "system",
    colorThemeId: "exo-neutral",
    editorFontSize: "15",
    terminalFontSize: "13",
    terminalHistoryLines: String(RENDERER_DEFAULT_TERMINAL_HISTORY_LINES),
    terminalTranscriptRetention: "forever",
    terminalTranscriptRetentionDays: "14",
    terminalInputCoalesceMs: String(DEFAULT_TERMINAL_INPUT_COALESCE_MS),
    terminalInitialColumns: String(DEFAULT_TERMINAL_INITIAL_COLUMNS),
    terminalInitialRows: String(DEFAULT_TERMINAL_INITIAL_ROWS),
    terminalMinimumColumns: String(DEFAULT_TERMINAL_MINIMUM_COLUMNS),
    terminalMinimumRows: String(DEFAULT_TERMINAL_MINIMUM_ROWS),
    terminalReadTailChars: String(DEFAULT_TERMINAL_READ_TAIL_CHARS),
    terminalMaxReadTailChars: String(DEFAULT_TERMINAL_MAX_READ_TAIL_CHARS),
    terminalUnresponsiveThresholdMs: String(DEFAULT_TERMINAL_UNRESPONSIVE_THRESHOLD_MS),
    terminalIdleThresholdMs: String(DEFAULT_TERMINAL_IDLE_THRESHOLD_MS),
    explorerScale: "1",
    exploreIndexSearchOnEnter: false,
    indexUpdateStrategy: "on-save",
    saveStatus: "idle",
    errorMessage: null,
    appliedWorkspaceKey: "",
    applyStatus: "idle",
    applyErrorMessage: null,
    ...overrides,
  };
}

function toolSurfaceDescriptor(action: ToolSurfaceDescriptor["action"]): ToolSurfaceDescriptor {
  return {
    id: "test-tool",
    label: "Test tool",
    title: "Test tool",
    kind: "toolDockPane",
    placement: "toolDock",
    owner: "localPlugin",
    action,
    enabled: true,
    visible: true,
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
  it("defaults to the clean terminal policy", () => {
    const store = new WorkspaceSettingsStore({ userDataPath: "/tmp/exo-test", env: {} });
    const settings = store.normalize({
      workspaceRoot: "/tmp/exo-test/workspace",
      defaultTerminalCwd: "/tmp/exo-test/workspace",
      noteRoots: ["/tmp/exo-test/workspace/notes"],
      projectRoots: [],
      indexedRoots: [],
      indexing: { enabled: false, mode: "off", backend: "qmd" },
    });

    expect(settings?.terminalHistoryLines).toBe(DEFAULT_TERMINAL_HISTORY_LINES);
    expect(settings?.terminalTranscriptRetention).toBe(DEFAULT_TERMINAL_TRANSCRIPT_RETENTION);
    expect(Object.prototype.hasOwnProperty.call(settings, "terminalStreamingMode")).toBe(false);
    expect(Object.prototype.hasOwnProperty.call(settings, "terminalAgentTransport")).toBe(false);
    expect(Object.prototype.hasOwnProperty.call(settings, "terminalScrollbackLines")).toBe(false);
    expect(Object.prototype.hasOwnProperty.call(settings, "terminalBufferChars")).toBe(false);
    expect(settings ? resolveTerminalRuntimePolicy(settings) : null).toMatchObject({
      bufferLineLimit: DEFAULT_TERMINAL_HISTORY_LINES,
      transcriptRetentionDays: 0,
    });
  });

  it("derives terminal internals from custom history settings", () => {
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

    expect(settings?.terminalHistoryLines).toBe(24_000);
    expect(settings?.terminalTranscriptRetention).toBe("days");
    expect(settings?.terminalTranscriptRetentionDays).toBe(30);
    expect(settings ? resolveTerminalRuntimePolicy(settings) : null).toMatchObject({
      scrollbackLines: 24_000,
      bufferLineLimit: 24_000,
      transcriptRetentionDays: 30,
      inputCoalesceMs: DEFAULT_TERMINAL_INPUT_COALESCE_MS,
      initialColumns: DEFAULT_TERMINAL_INITIAL_COLUMNS,
      initialRows: DEFAULT_TERMINAL_INITIAL_ROWS,
      minimumColumns: DEFAULT_TERMINAL_MINIMUM_COLUMNS,
      minimumRows: DEFAULT_TERMINAL_MINIMUM_ROWS,
      readTailChars: DEFAULT_TERMINAL_READ_TAIL_CHARS,
      maxReadTailChars: DEFAULT_TERMINAL_MAX_READ_TAIL_CHARS,
      unresponsiveThresholdMs: DEFAULT_TERMINAL_UNRESPONSIVE_THRESHOLD_MS,
      idleThresholdMs: DEFAULT_TERMINAL_IDLE_THRESHOLD_MS,
    });
  });
});

describe("workspace settings renderer model", () => {
  it("keeps structural draft keys aligned with saved settings keys", () => {
    const store = new WorkspaceSettingsStore({ userDataPath: "/tmp/exo-test", env: {} });
    const settings = store.normalize({
      workspaceRoot: "/workspace",
      defaultTerminalCwd: "/workspace/project",
      noteRoots: ["/workspace/notes"],
      projectRoots: ["/workspace/project"],
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
      workspaceRoot: "/workspace",
      defaultTerminalCwd: "/workspace/project",
      noteRoots: ["/workspace/notes"],
      projectRoots: ["/workspace/project"],
      indexedRoots: ["/workspace/notes"],
      indexMode: "lexical",
      appearanceMode: "system",
      colorThemeId: "exo-neutral",
      editorFontSize: "15",
      terminalFontSize: "13",
      terminalHistoryLines: String(RENDERER_DEFAULT_TERMINAL_HISTORY_LINES),
      terminalTranscriptRetention: "forever",
      terminalTranscriptRetentionDays: "14",
      terminalInputCoalesceMs: String(DEFAULT_TERMINAL_INPUT_COALESCE_MS),
      terminalInitialColumns: String(DEFAULT_TERMINAL_INITIAL_COLUMNS),
      terminalInitialRows: String(DEFAULT_TERMINAL_INITIAL_ROWS),
      terminalMinimumColumns: String(DEFAULT_TERMINAL_MINIMUM_COLUMNS),
      terminalMinimumRows: String(DEFAULT_TERMINAL_MINIMUM_ROWS),
      terminalReadTailChars: String(DEFAULT_TERMINAL_READ_TAIL_CHARS),
      terminalMaxReadTailChars: String(DEFAULT_TERMINAL_MAX_READ_TAIL_CHARS),
      terminalUnresponsiveThresholdMs: String(DEFAULT_TERMINAL_UNRESPONSIVE_THRESHOLD_MS),
      terminalIdleThresholdMs: String(DEFAULT_TERMINAL_IDLE_THRESHOLD_MS),
      explorerScale: "1",
      exploreIndexSearchOnEnter: true,
      indexUpdateStrategy: "on-save",
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
      workspaceRoot: "/workspace",
      defaultTerminalCwd: "/workspace",
      noteRoots: ["/workspace/notes"],
      projectRoots: [],
      indexedRoots: [],
      indexMode: "off" as const,
      appearanceMode: "system" as const,
      colorThemeId: "exo-neutral" as const,
      editorFontSize: "15",
      terminalFontSize: "13",
      terminalHistoryLines: String(RENDERER_DEFAULT_TERMINAL_HISTORY_LINES),
      terminalTranscriptRetention: "forever" as const,
      terminalTranscriptRetentionDays: "14",
      terminalInputCoalesceMs: String(DEFAULT_TERMINAL_INPUT_COALESCE_MS),
      terminalInitialColumns: String(DEFAULT_TERMINAL_INITIAL_COLUMNS),
      terminalInitialRows: String(DEFAULT_TERMINAL_INITIAL_ROWS),
      terminalMinimumColumns: String(DEFAULT_TERMINAL_MINIMUM_COLUMNS),
      terminalMinimumRows: String(DEFAULT_TERMINAL_MINIMUM_ROWS),
      terminalReadTailChars: String(DEFAULT_TERMINAL_READ_TAIL_CHARS),
      terminalMaxReadTailChars: String(DEFAULT_TERMINAL_MAX_READ_TAIL_CHARS),
      terminalUnresponsiveThresholdMs: String(DEFAULT_TERMINAL_UNRESPONSIVE_THRESHOLD_MS),
      terminalIdleThresholdMs: String(DEFAULT_TERMINAL_IDLE_THRESHOLD_MS),
      explorerScale: "1",
      exploreIndexSearchOnEnter: false,
      indexUpdateStrategy: "on-save" as const,
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

  it("resolves numeric scrollback and ignores legacy history mode", () => {
    const store = new WorkspaceSettingsStore({ userDataPath: "/tmp/exo-test", env: {} });
    const settings = store.normalize({
      workspaceRoot: "/workspace",
      defaultTerminalCwd: "/workspace",
      noteRoots: ["/workspace/notes"],
      projectRoots: [],
      indexedRoots: [],
      indexing: { enabled: false, mode: "off", backend: "qmd" },
      // Old persisted settings may include this field. New code ignores it
      // and preserves the explicit numeric scrollback value.
      terminalHistoryMode: "full",
      terminalHistoryLines: 1_000_000,
    } as Parameters<WorkspaceSettingsStore["normalize"]>[0] & { terminalHistoryMode: "full" });

    expect(settings ? resolveSettingsTerminalRuntime(settings).scrollbackLines : null).toBe(1_000_000);
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
      await store.save(firstSettings!);
      await store.save(secondSettings!);

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
    const graphContext = buildNoteGraphContext(noteDocument(), noteKnowledge());

    expect(graphReferencesForMarkdownMode(true, false, graphContext)).toEqual({
      backlinks: [{ label: "Source", target: "/vault/source.md" }],
      references: [{ label: "goals", target: "goals" }],
    });
    expect(graphReferencesForMarkdownMode(true, true, graphContext)).toBeNull();
  });

  it("keeps backlink entries navigable by their file path target", () => {
    const references = graphReferencesForMarkdownMode(true, false, buildNoteGraphContext(noteDocument(), noteKnowledge()));

    expect(references?.backlinks[0]).toEqual({ label: "Source", target: "/vault/source.md" });
  });

  it("derives active-note graph context from the bounded renderer snapshot adapter", () => {
    const graphContext = buildNoteGraphContext(noteDocument({ frontmatter: { status: "draft", tags: ["lab"] } }), {
      ...noteKnowledge(),
      tags: [{ tag: "lab" }],
    });

    expect(graphContext?.snapshot.schema.backlinks).toBe("derived");
    expect(graphContext?.properties).toEqual({ status: "draft", tags: ["lab"] });
    expect(graphContext?.outgoingLinks.map((item) => item.target).sort()).toEqual(["goals", "https://example.com"]);
    expect(graphContext?.externalLinks.map((item) => item.target)).toEqual(["https://example.com"]);
    expect(graphContext?.backlinks).toEqual([{ label: "Source", target: "/vault/source.md" }]);
    expect(graphContext?.neighborhood.nodes.map((item) => item.kind).sort()).toEqual([
      "external",
      "note",
      "note",
      "tag",
      "unresolved",
    ]);
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
    noteRoots: [{ id: "notes", label: "Notes", path: noteRoot, kind: "notes" }],
    projectRoots: [],
    indexedRoots: [],
    indexing: { enabled: false, mode: "off", backend: "qmd" },
    attachedWorkcells: [],
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

function noteKnowledge(): NoteKnowledge {
  return {
    wikilinks: [{ label: "goals", target: "goals" }],
    markdownLinks: [{ label: "external", target: "https://example.com" }],
    tags: [],
    backlinks: [{ title: "Source", filePath: "/vault/source.md" }],
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
    ...overrides,
  };
}

function terminalSessionFixture(overrides: Partial<TerminalSessionInfo> = {}): TerminalSessionInfo {
  return {
    id: "term-a",
    title: "Terminal",
    cwd: "/workspace",
    terminalKind: "shell",
    harnessId: null,
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
        terminalKind: "shell",
        harnessId: null,
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
      title: "Claude",
      cwd: "/workspace",
      terminalKind: "agent",
      harnessId: "claude",
      kind: "claude",
      command: "claude",
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
        kind: "codex",
        terminalKind: "agent",
        harnessId: "codex",
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
        kind: "codex",
        terminalKind: "agent",
        harnessId: "codex",
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
