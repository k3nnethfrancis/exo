import { describe, expect, it, vi } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { EditorState } from "@codemirror/state";
import type { AgentHarnessDetection, ManagedAgentKind, NoteKnowledge, PluginInventory, PluginInventoryItem, TreeNode, WorkspaceModel } from "@exo/core";

import {
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
  DEFAULT_TERMINAL_UNRESPONSIVE_THRESHOLD_MS,
  resolveTerminalRuntimePolicy,
  WorkspaceSettingsStore,
} from "../../main/settings-store";
import { buildProjectReviewChanges, uniqueCwdMatchedSession } from "./changedFileReview";
import { TERMINAL_CUSTOM_GLYPHS, TERMINAL_FONT_FAMILY } from "./components/terminalFonts";
import {
  initialTerminalHydrationViewState,
  markTerminalHydrationApplied,
  shouldApplyTerminalHydration,
} from "./components/terminalHydration";
import { isTerminalGeneratedResponse } from "./components/terminalInputFilters";
import { TerminalOutputChunker, chunkTerminalData } from "./components/terminalOutputChunks";
import { normalizeTerminalPresentation } from "./components/terminalPresentation";
import { focusTerminal, registerTerminal, unregisterTerminal } from "./components/terminalRegistry";
import { createTerminalToolDockActions, launchableTerminalAgentHarnesses } from "./components/TerminalRail";
import { shouldUseMarkdownRenderer } from "./components/NoteEditor";
import { workspaceSettingsSavedFooterCopy } from "./components/WorkspaceSettingsDialog";
import { listEnterEdit, shouldSuppressGeneratedTitleLine, wikilinkExitEdit } from "./components/markdownLivePreview";
import {
  appendPendingTerminalData,
  mergeHydrationSnapshot,
  shouldBufferTerminalDataForHydration,
  shouldSkipTerminalHydration,
} from "./hooks/useTerminalSessions";
import { defaultTerminalCwdForNotesFolder } from "./hooks/useWorkspaceBootstrap";
import { isReconnectableSession, isTerminalInputEnabled, terminalSessionsEqual } from "./terminalSessions";
import {
  buildPluginCategoryFilters,
  buildPluginDetailSections,
  filterPluginInventoryItems,
  groupPluginInventoryItems,
} from "./pluginManagerModel";
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
import { buildExplorerChangeState } from "./explorerChangeState";
import { collectLeaves, openOrUpdateBrowserPane, type PaneNode } from "./hooks/usePaneTree";
import {
  getWikilinkCompletionContext,
  graphReferencesForMarkdownMode,
  markdownPreviewExcerpt,
  suggestWikilinkTargetsFromTrees,
  wikilinkSuggestionEdit,
} from "./graphAffordances";

describe("desktop shell", () => {
  it("keeps a renderer test surface in place", () => {
    expect(true).toBe(true);
  });
});

describe("editor document mode", () => {
  it("uses the markdown renderer for markdown documents from any root", () => {
    expect(shouldUseMarkdownRenderer({ kind: "markdown" })).toBe(true);
    expect(shouldUseMarkdownRenderer({ kind: "text" })).toBe(false);
    expect(shouldUseMarkdownRenderer(null)).toBe(false);
  });
});

describe("workspace settings footer copy", () => {
  it("only mentions Apply when structural changes are pending", () => {
    expect(workspaceSettingsSavedFooterCopy(true)).toContain("Apply");
    expect(workspaceSettingsSavedFooterCopy(false)).toBe("Settings saved.");
  });
});

describe("browser preview panes", () => {
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

});

describe("plugin manager model", () => {
  it("groups and filters inventory rows by category with core first", () => {
    const items = [
      pluginInventoryItem("codex", "Codex", "agentHarness", "Agent harnesses", "bundled"),
      pluginInventoryItem("core.terminal", "Terminal host", "core", "Core", "core"),
      pluginInventoryItem("graph-health.template", "Graph Health", "routineTemplate", "Routine templates", "localManifest"),
      pluginInventoryItem("qmd", "QMD", "searchProvider", "Search providers", "bundled"),
    ];
    const groups = groupPluginInventoryItems(items);

    expect(groups.map((group) => group.id)).toEqual(["core", "searchProvider", "agentHarness", "routineTemplate"]);
    expect(groups.find((group) => group.id === "agentHarness")?.items.map((item) => item.id)).toEqual(["codex"]);
    expect(buildPluginCategoryFilters(items)).toEqual([
      { id: "core", label: "Core", count: 1 },
      { id: "searchProvider", label: "Search providers", count: 1 },
      { id: "agentHarness", label: "Agent harnesses", count: 1 },
      { id: "routineTemplate", label: "Routine templates", count: 1 },
      { id: "profile", label: "Profiles", count: 0 },
      { id: "graphVisualization", label: "Graph visualizations", count: 0 },
      { id: "other", label: "Other", count: 0 },
    ]);
    expect(filterPluginInventoryItems(items, "searchProvider").map((item) => item.id)).toEqual(["qmd"]);
  });

  it("summarizes search provider and harness metadata for read-only details", () => {
    const searchSections = buildPluginDetailSections({
      ...pluginInventoryItem("local-search", "Local Search", "searchProvider", "Search providers", "localManifest"),
      kind: "searchProvider",
      permissions: ["workspace:read", "notes:read"],
      surfaces: ["desktop", "mcp"],
      compatibility: {
        provider: "local",
        backend: "sqlite",
        modes: ["lexical", "hybrid"],
      },
    });
    const harnessSections = buildPluginDetailSections({
      ...pluginInventoryItem("pi", "Pi", "agentHarness", "Agent harnesses", "bundled"),
      kind: "agentHarness",
      status: "missing-dependency",
      statusLabel: "Needs inference backend",
      compatibility: {
        managedAgentKind: "pi",
        setupSummary: "Configure a compatible inference backend.",
      },
      dependencies: [
        { id: "backend", label: "Inference backend", required: true, status: "missing", statusLabel: "Missing" },
      ],
    });

    expect(searchSections.find((section) => section.id === "search-provider")?.rows).toEqual(
      expect.arrayContaining([
        { label: "Provider", value: "local" },
        { label: "Backend", value: "sqlite" },
        { label: "Surfaces", value: "desktop, mcp" },
        { label: "Permissions", value: "workspace:read, notes:read" },
      ]),
    );
    expect(harnessSections.find((section) => section.id === "agent-harness")?.rows).toEqual(
      expect.arrayContaining([
        { label: "Harness", value: "pi" },
        { label: "Readiness", value: "Needs inference backend" },
        { label: "Launchability", value: "Not launchable until setup/trust/dependencies are satisfied" },
        { label: "Setup", value: "Configure a compatible inference backend." },
      ]),
    );
  });

  it("summarizes profile metadata for the read-only detail panel", () => {
    const profileItem: PluginInventoryItem = {
      ...pluginInventoryItem("exograph-baseline.profile", "Exograph Baseline", "profile", "Profiles", "localManifest"),
      kind: "profile",
      compatibility: {
        profile: {
          recommendedPlugins: [{ id: "qmd", required: false }],
          metadataSchemas: [{ id: "note", label: "Note", scope: { paths: ["**/*.md"] } }],
          skills: [{ id: "graph-evolve", label: "Graph Evolve", harnesses: ["claude"], sourcePath: "skills/graph-evolve" }],
          routineTemplateIds: ["graph-health.template"],
          reviewPolicy: { fileChanges: "propose", requireHumanReview: true, allowedPaths: ["**/*.md"] },
          outputPolicy: { fileChanges: "propose", artifacts: "record", allowedPaths: [".exo/artifacts/**"] },
        },
      },
    };
    const sections = buildPluginDetailSections(profileItem, pluginInventory([profileItem, pluginInventoryItem("qmd", "QMD", "searchProvider", "Search providers", "bundled")]));

    expect(sections.find((section) => section.id === "profile-preview")?.rows).toEqual(
      expect.arrayContaining([
        { label: "Mode", value: "Preview only" },
        { label: "Ready recommendations", value: "1" },
        { label: "Would write", value: "none" },
      ]),
    );
    expect(sections.find((section) => section.id === "profile-recommendations")?.rows).toEqual(
      expect.arrayContaining([
        { label: "Recommended plugins", value: "qmd" },
        { label: "Metadata schemas", value: "Note" },
        { label: "Skills", value: "Graph Evolve (claude)" },
      ]),
    );
    expect(sections.find((section) => section.id === "profile-policies")?.rows).toEqual(
      expect.arrayContaining([{ label: "Output", value: "propose; artifacts record" }]),
    );
  });

  it("summarizes routine template metadata for the read-only detail panel", () => {
    const sections = buildPluginDetailSections({
      ...pluginInventoryItem("graph-health.template", "Graph Health", "routineTemplate", "Routine templates", "localManifest"),
      kind: "routineTemplate",
      compatibility: {
        routineTemplate: {
          harnessId: "claude",
          requiredSkills: [{ id: "graph-health", label: "Graph Health", required: true }],
          trigger: { kind: "schedule", schedule: "0 9 * * 1", timezone: "US/Pacific" },
          permissions: { permissions: ["workspace:read", "notes:read", "artifacts:write"] },
          outputPolicy: { fileChanges: "propose", artifacts: "record", allowedPaths: [".exo/artifacts/**"] },
        },
      },
    });

    expect(sections.find((section) => section.id === "routine-template")?.rows).toEqual(
      expect.arrayContaining([
        { label: "Default harness", value: "claude" },
        { label: "Skills", value: "Graph Health" },
        { label: "Trigger", value: "schedule: 0 9 * * 1 (US/Pacific)" },
        { label: "Permissions", value: "workspace:read, notes:read, artifacts:write" },
        { label: "Output policy", value: "file changes propose; artifacts record" },
      ]),
    );
  });

  it("summarizes graph visualization metadata for the read-only detail panel", () => {
    const sections = buildPluginDetailSections({
      ...pluginInventoryItem("default-graph.view", "Default Graph", "graphVisualization", "Graph visualizations", "localManifest"),
      kind: "graphVisualization",
      compatibility: {
        graphDataVersion: "0.1",
        acceptedNodeKinds: ["note", "tag"],
        acceptedEdgeKinds: ["wikilink"],
        hostSurface: "editorPane",
      },
    });

    expect(sections.find((section) => section.id === "graph-compatibility")?.rows).toEqual([
      { label: "Graph data", value: "0.1" },
      { label: "Host", value: "editorPane" },
      { label: "Node kinds", value: "note, tag" },
      { label: "Edge kinds", value: "wikilink" },
    ]);
  });
});

function pluginInventoryItem(
  id: string,
  label: string,
  categoryId: string,
  categoryLabel: string,
  source: PluginInventoryItem["source"],
): PluginInventoryItem {
  return {
    id,
    label,
    description: `${label} description`,
    kind: categoryId === "core" ? "core" : categoryId as PluginInventoryItem["kind"],
    categoryId,
    categoryLabel,
    source,
    sourceLabel: source,
    distribution: source === "core" ? "core" : source === "bundled" ? "official" : "developer",
    distributionLabel: source === "core" ? "Core" : source === "bundled" ? "Official" : "Developer",
    lifecycle: "built-in",
    owner: "@exo/test",
    surfaces: ["desktop"],
    permissions: [],
    enabled: true,
    trust: "trusted",
    status: "available",
    statusLabel: "Available",
  };
}

function pluginInventory(items: PluginInventoryItem[]): PluginInventory {
  return {
    generatedAt: "2026-06-26T00:00:00.000Z",
    items,
    errors: [],
    counts: {
      total: items.length,
      core: items.filter((item) => item.source === "core").length,
      bundled: items.filter((item) => item.source === "bundled").length,
      localManifest: items.filter((item) => item.source === "localManifest").length,
      official: items.filter((item) => item.distribution === "official").length,
      local: items.filter((item) => item.distribution === "local").length,
      developer: items.filter((item) => item.distribution === "developer").length,
      disabled: items.filter((item) => !item.enabled).length,
      untrusted: items.filter((item) => item.trust === "untrusted").length,
    },
  };
}

function harness(id: ManagedAgentKind, launchable: boolean, overrides: Partial<AgentHarnessDetection> = {}): AgentHarnessDetection {
  return {
    id,
    adapterId: id === "claude" ? "claude-code" : id,
    family: id === "claude" ? "claude-code" : id,
    label: id,
    productName: id,
    enabled: true,
    configured: launchable,
    detected: launchable,
    launchable,
    status: launchable ? "configured" : "not-found",
    statusLabel: launchable ? "Configured" : "Not found",
    ...overrides,
  };
}

describe("terminal harness launchers", () => {
  it("shows launchers only for enabled launchable agent harnesses", () => {
    const launchable = launchableTerminalAgentHarnesses([
      harness("shell", true),
      harness("codex", false),
      harness("pi", true),
      harness("hermes", true, { visible: false }),
    ]);

    expect(launchable.map((candidate) => candidate.id)).toEqual(["pi"]);
  });

  it("builds terminal tool dock actions without changing launcher behavior", () => {
    const onToggleCollapsed = vi.fn();
    const onOpenAgentConfigEditor = vi.fn();
    const onCreateTerminal = vi.fn();
    const actions = createTerminalToolDockActions({
      collapsed: false,
      harnesses: [
        harness("shell", true),
        harness("claude", true),
        harness("codex", false),
        harness("pi", true),
        harness("hermes", true, { visible: false }),
      ],
      onToggleCollapsed,
      onOpenAgentConfigEditor,
      onCreateTerminal,
    });

    expect(actions.map((action) => action.testId)).toEqual([
      "terminal-collapse",
      "launch-shell",
      "launch-claude",
      "launch-pi",
      "open-agent-config",
    ]);

    actions.find((action) => action.testId === "terminal-collapse")?.onSelect();
    actions.find((action) => action.testId === "launch-shell")?.onSelect();
    actions.find((action) => action.testId === "launch-pi")?.onSelect();
    actions.find((action) => action.testId === "open-agent-config")?.onSelect();

    expect(onToggleCollapsed).toHaveBeenCalledTimes(1);
    expect(onCreateTerminal).toHaveBeenNthCalledWith(1, "shell");
    expect(onCreateTerminal).toHaveBeenNthCalledWith(2, "pi");
    expect(onOpenAgentConfigEditor).toHaveBeenCalledTimes(1);
  });
});

describe("terminal renderer registry", () => {
  it("refreshes the terminal surface before focusing after pane handoff", () => {
    const terminal = { focus: vi.fn() };
    const refresh = vi.fn();

    registerTerminal("terminal-1", terminal as never, vi.fn(), refresh);
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

    registerTerminal("terminal-1", { focus: vi.fn() } as never, vi.fn(), refreshOne);
    registerTerminal("terminal-2", { focus: vi.fn() } as never, vi.fn(), refreshTwo);
    try {
      expect(focusTerminal("terminal-1")).toBe(true);
      expect(refreshOne).toHaveBeenCalledTimes(1);
      expect(refreshTwo).not.toHaveBeenCalled();
    } finally {
      unregisterTerminal("terminal-1");
      unregisterTerminal("terminal-2");
    }
  });
});

describe("explorer changed file state", () => {
  it("marks changed file rows and collapsed ancestor directories", () => {
    const rootPath = "/workspace/projects/sample-project";
    const state = buildExplorerChangeState(
      [
        {
          id: "src",
          name: "src",
          path: `${rootPath}/src`,
          kind: "directory",
          children: [
            {
              id: "demo",
              name: "demo.ts",
              path: `${rootPath}/src/demo.ts`,
              kind: "file",
            },
          ],
        },
        {
          id: "readme",
          name: "README.md",
          path: `${rootPath}/README.md`,
          kind: "file",
        },
      ],
      [
        {
          rootPath,
          rootLabel: "sample-project",
          path: "src/demo.ts",
          absolutePath: `${rootPath}/src/demo.ts`,
          status: "M",
          firstChangedLine: 2,
        },
      ],
    );

    expect(state.byPath.get(`${rootPath}/src/demo.ts`)).toMatchObject({ status: "M", firstChangedLine: 2 });
    expect(state.byPath.has(`${rootPath}/README.md`)).toBe(false);
    expect(state.descendantCountByPath.get(`${rootPath}/src`)).toBe(1);
  });

  it("clears descendant state when project changes are clean", () => {
    const rootPath = "/workspace/projects/sample-project";
    const state = buildExplorerChangeState(
      [
        {
          id: "src",
          name: "src",
          path: `${rootPath}/src`,
          kind: "directory",
          children: [
            {
              id: "demo",
              name: "demo.ts",
              path: `${rootPath}/src/demo.ts`,
              kind: "file",
            },
          ],
        },
      ],
      [],
    );

    expect(state.byPath.size).toBe(0);
    expect(state.descendantCountByPath.has(`${rootPath}/src`)).toBe(false);
  });

  it("counts dirty descendants even when changed child nodes are not loaded", () => {
    const rootPath = "/workspace/projects/sample-project";
    const state = buildExplorerChangeState(
      [
        {
          id: "src",
          name: "src",
          path: `${rootPath}/src`,
          kind: "directory",
          children: [],
        },
      ],
      [
        {
          rootPath,
          rootLabel: "sample-project",
          path: "src/deep/demo.ts",
          absolutePath: `${rootPath}/src/deep/demo.ts`,
          status: "??",
        },
      ],
    );

    expect(state.descendantCountByPath.get(`${rootPath}/src`)).toBe(1);
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
      agentStartupGraceMs: DEFAULT_TERMINAL_AGENT_STARTUP_GRACE_MS,
      agentSubmitDelayMs: DEFAULT_TERMINAL_AGENT_SUBMIT_DELAY_MS,
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
      terminalAgentStartupGraceMs: String(DEFAULT_TERMINAL_AGENT_STARTUP_GRACE_MS),
      terminalAgentSubmitDelayMs: String(DEFAULT_TERMINAL_AGENT_SUBMIT_DELAY_MS),
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
      terminalAgentStartupGraceMs: String(DEFAULT_TERMINAL_AGENT_STARTUP_GRACE_MS),
      terminalAgentSubmitDelayMs: String(DEFAULT_TERMINAL_AGENT_SUBMIT_DELAY_MS),
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
  it("keeps symbol, emoji, and custom box-drawing fallbacks enabled for agent TUIs", () => {
    expect(TERMINAL_CUSTOM_GLYPHS).toBe(true);
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
});

describe("markdown editor wikilink behavior", () => {
  it("exits a wikilink by inserting one trailing space", () => {
    const state = EditorState.create({ doc: "Discuss [[customer-name]]today" });
    const pos = "Discuss [[customer-name".length;

    expect(wikilinkExitEdit(state, pos)).toEqual({
      insertAt: "Discuss [[customer-name]]".length,
      insert: " ",
      selection: "Discuss [[customer-name]] ".length,
    });
  });

  it("exits a wikilink through an existing trailing space", () => {
    const state = EditorState.create({ doc: "Discuss [[customer-name]] today" });
    const pos = "Discuss [[customer-name]]".length;

    expect(wikilinkExitEdit(state, pos)).toEqual({
      insertAt: "Discuss [[customer-name]]".length,
      insert: "",
      selection: "Discuss [[customer-name]] ".length,
    });
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
    const knowledge = noteKnowledge();

    expect(graphReferencesForMarkdownMode(true, false, knowledge)).toEqual({
      backlinks: [{ label: "Source", target: "/vault/source.md" }],
      references: [{ label: "goals", target: "goals" }],
    });
    expect(graphReferencesForMarkdownMode(true, true, knowledge)).toBeNull();
  });

  it("keeps backlink entries navigable by their file path target", () => {
    const references = graphReferencesForMarkdownMode(true, false, noteKnowledge());

    expect(references?.backlinks[0]).toEqual({ label: "Source", target: "/vault/source.md" });
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

function noteKnowledge(): NoteKnowledge {
  return {
    wikilinks: [{ label: "goals", target: "goals" }],
    markdownLinks: [{ label: "external", target: "https://example.com" }],
    tags: [],
    backlinks: [{ title: "Source", filePath: "/vault/source.md" }],
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
      },
    ] as const;

    expect(terminalSessionsEqual([...sessions], [...sessions])).toBe(true);
    expect(terminalSessionsEqual([...sessions], [{ ...sessions[0], healthDetail: "stale output" }])).toBe(false);
  });

  it("blocks terminal input while a running session is unhealthy but allows reconnect", () => {
    const unhealthySession = {
      id: "term-a",
      title: "Claude",
      cwd: "/workspace",
      kind: "claude",
      command: "claude",
      status: "running",
      health: "unhealthy",
      healthDetail: "Tmux session is alive but Exo's attach bridge is detached; reconnect the terminal.",
    } as const;

    expect(isTerminalInputEnabled(unhealthySession)).toBe(false);
    expect(isReconnectableSession(unhealthySession)).toBe(true);
    expect(isTerminalInputEnabled({ ...unhealthySession, health: "idle" })).toBe(true);
    expect(isTerminalInputEnabled({ ...unhealthySession, status: "exited", health: "exited" })).toBe(false);
  });

  it("preserves terminal data that arrives before or during hydration", () => {
    expect(mergeHydrationSnapshot("", "claude ready\n")).toBe("claude ready\n");
    expect(mergeHydrationSnapshot("boot\nclaude", "claude ready\n")).toBe("boot\nclaude ready\n");
    expect(mergeHydrationSnapshot("boot\nclaude ready\n", "claude ready\n")).toBe("boot\nclaude ready\n");
  });

  it("caps pending terminal data to the newest content", () => {
    expect(appendPendingTerminalData("abcdef", "ghij", 6)).toBe("efghij");
  });

  it("does not split terminal Unicode while capping pending hydration data", () => {
    const emoji = "🙂";
    const high = emoji.charAt(0);
    const low = emoji.charAt(1);

    expect(appendPendingTerminalData(`abc${high}`, low, 4)).toBe(`bc${emoji}`);
    expect(appendPendingTerminalData(`abc${emoji}`, "de", 4)).toBe(`${emoji}de`);
    expect(appendPendingTerminalData(`abc${emoji}`, "de", 3)).toBe("de");
    expect(appendPendingTerminalData(`abc${high}`, "", 1)).toBe("");
  });

  it("skips mounted hydrated terminal reads unless reconnect forces a snapshot", () => {
    const hydrated = new Set(["term-a"]);
    const pending = new Set<string>();

    expect(shouldSkipTerminalHydration("term-a", hydrated, pending)).toBe(true);
    expect(shouldSkipTerminalHydration("term-a", hydrated, pending, { force: true })).toBe(false);
    expect(shouldSkipTerminalHydration("term-b", hydrated, pending)).toBe(false);
    expect(shouldSkipTerminalHydration("term-a", hydrated, new Set(["term-a"]), { force: true })).toBe(true);
  });

  it("applies hydration only for first mount or explicit reconnect", () => {
    const initial = initialTerminalHydrationViewState();
    const bootstrap = { snapshot: "first prompt\n", version: 1, reason: "bootstrap" as const };
    const liveMetadataRefresh = { snapshot: "stale prompt\n", version: 2, reason: "bootstrap" as const };
    const reconnect = { snapshot: "reattached prompt\n", version: 3, reason: "reconnect" as const };

    expect(shouldApplyTerminalHydration(initial, { snapshot: "", version: 0, reason: "bootstrap" })).toBe(false);
    expect(shouldApplyTerminalHydration(initial, bootstrap)).toBe(true);

    const live = markTerminalHydrationApplied(initial, bootstrap);
    expect(shouldApplyTerminalHydration(live, liveMetadataRefresh)).toBe(false);
    expect(shouldApplyTerminalHydration(live, reconnect)).toBe(true);
  });

  it("does not keep React-owned live terminal data after hydration is live", () => {
    expect(shouldBufferTerminalDataForHydration(false, undefined, true)).toBe(true);
    expect(shouldBufferTerminalDataForHydration(true, undefined, true)).toBe(false);
    expect(shouldBufferTerminalDataForHydration(true, "bootstrap", false)).toBe(false);
    expect(shouldBufferTerminalDataForHydration(true, "bootstrap", true)).toBe(false);
    expect(shouldBufferTerminalDataForHydration(true, "reconnect", true)).toBe(true);
  });
});

describe("changed file review attribution", () => {
  it("does not associate ambiguous same-cwd file changes with every terminal", () => {
    const sessions = [
      { id: "term-a", title: "Shell A", cwd: "/workspace/project", kind: "shell", command: "zsh", status: "running" },
      { id: "term-b", title: "Shell B", cwd: "/workspace/project", kind: "shell", command: "zsh", status: "running" },
    ] as const;
    const change = {
      rootPath: "/workspace/project",
      rootLabel: "project",
      path: "src/demo.ts",
      absolutePath: "/workspace/project/src/demo.ts",
      status: "M",
      firstChangedLine: 2,
    };

    expect(uniqueCwdMatchedSession([...sessions], change.absolutePath)).toBeNull();
    expect(buildProjectReviewChanges([change], [], [...sessions])[0].agents).toEqual([]);
    expect(
      buildProjectReviewChanges(
        [change],
        [
          { rootPath: change.rootPath, filePath: change.absolutePath, sessionId: "term-a", observedAt: 1, association: "unique-cwd-match" },
          { rootPath: change.rootPath, filePath: change.absolutePath, sessionId: "term-b", observedAt: 2, association: "unique-cwd-match" },
        ],
        [...sessions],
      )[0].agents,
    ).toEqual([]);
  });
});
