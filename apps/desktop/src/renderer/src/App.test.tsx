import { describe, expect, it, vi } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { EditorState } from "@codemirror/state";
import { renderToStaticMarkup } from "react-dom/server";
import type {
  AgentHarnessDetection,
  IndexStatus,
  ManagedAgentKind,
  NoteKnowledge,
  PluginInventory,
  PluginInventoryItem,
  PluginSettingsSchema,
  ProposalBatch,
  ProfilePlanPreview,
  ResolvedPluginSettings,
  TreeNode,
  WorkspaceModel,
} from "@exo/core";

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
import { focusTerminal, registerTerminal, unregisterTerminal, writeTerminalData } from "./components/terminalRegistry";
import { createTerminalToolDockActions, launchableTerminalAgentHarnesses } from "./components/TerminalRail";
import { shouldUseMarkdownRenderer } from "./components/NoteEditor";
import {
  WorkspaceSettingsDialog,
  indexSettingsStatusCopy,
  workspaceSettingsDialogIntroCopy,
  workspaceSettingsSavedFooterCopy,
} from "./components/WorkspaceSettingsDialog";
import { listEnterEdit, shouldSuppressGeneratedTitleLine, wikilinkExitEdit } from "./components/markdownLivePreview";
import {
  appendPendingTerminalData,
  mergeHydrationSnapshot,
  shouldBufferTerminalDataForHydration,
  shouldSkipTerminalHydration,
} from "./hooks/useTerminalSessions";
import { defaultTerminalCwdForNotesFolder } from "./hooks/useWorkspaceBootstrap";
import { isReconnectableSession, isTerminalInputEnabled, summarizeTerminalStatusLine, terminalSessionsEqual } from "./terminalSessions";
import {
  buildPluginBoundarySummary,
  buildPluginCategoryFilters,
  buildPluginDetailSections,
  buildPluginManagementSummary,
  buildPluginRowIndicators,
  buildPluginStateFilters,
  createPluginSettingsDraft,
  filterPluginInventoryItems,
  filterPluginInventoryItemsByState,
  groupPluginInventoryItems,
  pluginActionAvailability,
  pluginActionInput,
  pluginDisplayStatus,
  pluginLocalManagementAvailability,
  pluginManagementGuidance,
  pluginManagementLane,
  pluginSettingsAvailability,
  pluginSettingsValuesFromDraft,
} from "./pluginManagerModel";
import { buildProfileSettingsModel, PROFILE_SETTINGS_DISABLED_REASON } from "./profileSettingsModel";
import { PluginInventoryRow, PluginSettingsSection } from "./components/PluginManagerDialog";
import { PiHarnessSettingsPanel, createPiHarnessDraft, piHarnessSettingsFromDraft } from "./components/AgentConfigEditorDialog";
import { ChangedNotesDialog } from "./components/ChangedNotesDialog";
import { ProposalReviewDialog } from "./components/ProposalReviewDialog";
import { ProfileEditPanel, buildProfileEditPanelSections } from "./components/ProfileEditPanel";
import { ProfileSettingsContent } from "./components/ProfileSettingsSection";
import { OnboardingCapabilityReviewContent } from "./components/OnboardingCapabilityReview";
import {
  buildOnboardingCapabilitySections,
  onboardingCapabilitySelectable,
  onboardingCapabilitySelected,
  onboardingCapabilityStatus,
  onboardingCapabilityTone,
} from "./onboardingCapabilities";
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
  addTerminalSessionAsSplit,
  buildTerminalMonitorTree,
  buildTerminalTabsTree,
  collectTerminalSessionIds,
  restoreTerminalTreeSnapshot,
} from "./paneTreeSelectors";
import { isNewTerminalShortcut } from "./hooks/useAppKeybindings";
import {
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
});

describe("workspace settings footer copy", () => {
  it("only mentions Apply when structural changes are pending", () => {
    expect(workspaceSettingsSavedFooterCopy(true)).toContain("Apply");
    expect(workspaceSettingsSavedFooterCopy(false)).toBe("Settings saved.");
  });

  it("keeps the dialog intro from mentioning Apply when no Apply action is visible", () => {
    expect(workspaceSettingsDialogIntroCopy("index", false)).not.toContain("Apply");
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
        agentHarnesses={[]}
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
        onOpenAgentConfigEditor={() => {}}
        onOpenPluginManager={() => {}}
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
    expect(html).toContain("3 pending embeddings");
    expect(html).not.toContain("Press Apply");
  });
});

describe("changed notes dialog", () => {
  it("lists changed notes with root and changed line context", () => {
    const html = renderToStaticMarkup(
      <ChangedNotesDialog
        changes={[
          {
            rootPath: "/workspace/notes",
            rootLabel: "notes",
            path: "daily/2026-06-28.md",
            absolutePath: "/workspace/notes/daily/2026-06-28.md",
            status: "M",
            firstChangedLine: 12,
          },
        ]}
        onClose={() => {}}
        onOpenChange={() => {}}
      />,
    );

    expect(html).toContain("Changed Notes");
    expect(html).toContain("daily/2026-06-28.md");
    expect(html).toContain("notes · line 12");
    expect(html).toContain("Diff and commit actions will live here later.");
  });

  it("shows an empty state when no notes are changed", () => {
    const html = renderToStaticMarkup(<ChangedNotesDialog changes={[]} onClose={() => {}} onOpenChange={() => {}} />);

    expect(html).toContain("No changed notes detected.");
  });
});

describe("proposal review dialog", () => {
  it("shows proposal batches, item previews, stale reasons, and atomic guidance", () => {
    const proposal = proposalBatchFixture({
      atomic: true,
      items: [
        {
          id: "item-1",
          kind: "filePatch",
          path: "AGENTS.md",
          itemStatus: "pending",
          baseHash: "sha256:1234567890abcdef",
          unifiedDiff: "@@ -1 +1 @@\n-old\n+new\n",
        },
        {
          id: "item-2",
          kind: "fileCreate",
          path: "notes/new.md",
          itemStatus: "stale",
          statusReason: "baseHash mismatch: file changed since proposal (notes/new.md)",
          contents: "# New note\n",
        },
      ],
    });
    const html = renderToStaticMarkup(
      <ProposalReviewDialog
        review={{
          proposals: [proposal],
          selectedProposalId: proposal.id,
          selectedProposal: proposal,
          loadState: "idle",
          decisionState: null,
          errorMessage: null,
          lastApplyResult: null,
          pendingProposalCount: 1,
          refreshProposals: vi.fn(),
          selectProposal: vi.fn(),
          acceptProposal: vi.fn(),
          rejectProposal: vi.fn(),
          acceptItem: vi.fn(),
          rejectItem: vi.fn(),
          clearLastApplyResult: vi.fn(),
        }}
        onClose={() => {}}
      />,
    );

    expect(html).toContain("Proposal Review");
    expect(html).toContain("1 pending proposal");
    expect(html).toContain("activity-1");
    expect(html).toContain("term-1");
    expect(html).toContain("Atomic batch: decide the full batch.");
    expect(html).toContain("AGENTS.md");
    expect(html).toContain("@@ -1 +1 @@");
    expect(html).toContain("notes/new.md");
    expect(html).toContain("baseHash mismatch");
  });

  it("renders frontmatter byte preview evidence for review", () => {
    const before = "---\r\ntitle: Old\r\npublished: 2026-07-04\r\n---\r\nBody\r\n";
    const after = "---\r\ntitle: New\r\npublished: 2026-07-04\r\n---\r\nBody\r\n";
    const operations = [{ kind: "set" as const, keyPath: ["title"], value: "New" }];
    const evidence = {
      format: "exo.frontmatterPreview.v1",
      before,
      after,
      beforeHash: "sha256:before",
      afterHash: "sha256:after",
    };
    const proposal = proposalBatchFixture({
      items: [
        {
          id: "frontmatter-1",
          kind: "frontmatterPatch",
          path: "note.md",
          itemStatus: "pending",
          baseHash: evidence.beforeHash,
          operations,
          metadata: {
            "exo.frontmatterPreview.v1": evidence,
          },
        },
      ],
    });

    const html = renderToStaticMarkup(
      <ProposalReviewDialog
        review={{
          proposals: [proposal],
          selectedProposalId: proposal.id,
          selectedProposal: proposal,
          loadState: "idle",
          decisionState: null,
          errorMessage: null,
          lastApplyResult: null,
          pendingProposalCount: 1,
          refreshProposals: vi.fn(),
          selectProposal: vi.fn(),
          acceptProposal: vi.fn(),
          rejectProposal: vi.fn(),
          acceptItem: vi.fn(),
          rejectItem: vi.fn(),
          clearLastApplyResult: vi.fn(),
        }}
        onClose={() => {}}
      />,
    );

    expect(html).toContain("Frontmatter byte preview");
    expect(html).toContain(evidence.beforeHash);
    expect(html).toContain(evidence.afterHash);
    expect(html).toContain("\\r\\ntitle: New\\r\\npublished: 2026-07-04");
  });
});

describe("profile settings model", () => {
  it("surfaces Exograph Baseline as the baseline candidate before an active profile is selected", () => {
    const baseline: PluginInventoryItem = {
      ...pluginInventoryItem("exograph-baseline.profile", "Exograph Baseline", "profile", "Profiles", "bundled"),
      pluginId: "exograph-baseline.plugin",
      pluginName: "Exograph Baseline Profile",
      manifestPath: "/plugins/exograph-baseline/exo.plugin.json",
      compatibility: {
        profile: {
          recommendedPlugins: [{ id: "qmd", required: false }],
          metadataSchemas: [{ id: "markdown-note", label: "Markdown note", scope: { paths: ["**/*.md"] }, frontmatter: {}, tags: [] }],
          contextTemplates: [{ id: "agents-md", label: "AGENTS.md", target: "AGENTS.md", templatePath: "templates/AGENTS.md" }],
          instructionTemplates: [],
          mcpConfigTemplates: [],
          skills: [],
          routineTemplateIds: ["graph-health.template"],
          graphViews: [],
          analyzerSettings: [],
          reviewPolicy: { fileChanges: "propose", requireHumanReview: true, allowedPaths: ["**/*.md"] },
          outputPolicy: { fileChanges: "propose", artifacts: "record", allowedPaths: [".exo/artifacts/**"] },
        },
      },
    };
    const inventory = pluginInventory([
      baseline,
      pluginInventoryItem("qmd", "QMD advanced search", "searchProvider", "Search providers", "bundled"),
    ]);
    const model = buildProfileSettingsModel(inventory, null, {
      "exograph-baseline.profile": { plan: profilePlanFixture(), error: null },
    });

    expect(model.activeProfileLabel).toBe("No active profile");
    expect(model.baselineCandidate?.label).toBe("Exograph Baseline");
    expect(model.baselineCandidate?.plan?.apply).toMatchObject({ available: false, label: "Review only" });
    expect(model.baselineCandidate?.componentRows).toContainEqual({ label: "Blockers", value: "1" });
    expect(model.baselineCandidate?.recommendationRows).toEqual([{ label: "qmd", value: "ready (optional)" }]);
    expect(model.baselineCandidate?.applyGate).toMatchObject({
      canStageFileTemplates: true,
      label: "Stage file proposals",
    });
    expect(PROFILE_SETTINGS_DISABLED_REASON).toContain("reviewable proposals");
    expect(PROFILE_SETTINGS_DISABLED_REASON).toContain("Accepting the proposal is a separate UI/CLI review action");
    expect(PROFILE_SETTINGS_DISABLED_REASON).toContain("permission grants");
  });

  it("keeps file-template staging disabled for untrusted or non-propose profiles", () => {
    const untrustedProfile: PluginInventoryItem = {
      ...pluginInventoryItem("lab.profile", "Lab profile", "profile", "Profiles", "localManifest"),
      trust: "untrusted",
      compatibility: {
        profile: {
          contextTemplates: [{ id: "agents-md", label: "AGENTS.md", target: "AGENTS.md", templatePath: "templates/AGENTS.md" }],
          reviewPolicy: { fileChanges: "propose", requireHumanReview: true, allowedPaths: ["**/*.md"] },
        },
      },
    };
    const unsafePolicyProfile: PluginInventoryItem = {
      ...pluginInventoryItem("unsafe.profile", "Unsafe profile", "profile", "Profiles", "bundled"),
      compatibility: {
        profile: {
          contextTemplates: [{ id: "agents-md", label: "AGENTS.md", target: "AGENTS.md", templatePath: "templates/AGENTS.md" }],
          reviewPolicy: { fileChanges: "apply", requireHumanReview: true, allowedPaths: ["**/*.md"] },
        },
      },
    };

    const model = buildProfileSettingsModel(pluginInventory([untrustedProfile, unsafePolicyProfile]), null);

    expect(model.detectedProfiles.find((candidate) => candidate.id === "lab.profile")?.applyGate).toMatchObject({
      canStageFileTemplates: false,
      label: "Trust required",
    });
    expect(model.detectedProfiles.find((candidate) => candidate.id === "unsafe.profile")?.applyGate).toMatchObject({
      canStageFileTemplates: false,
      label: "Review policy required",
    });
  });

  it("renders stage file proposals only when the profile apply gate allows it", () => {
    const baseline: PluginInventoryItem = {
      ...pluginInventoryItem("exograph-baseline.profile", "Exograph Baseline", "profile", "Profiles", "bundled"),
      compatibility: {
        profile: {
          contextTemplates: [{ id: "agents-md", label: "AGENTS.md", target: "AGENTS.md", templatePath: "templates/AGENTS.md" }],
          reviewPolicy: { fileChanges: "propose", requireHumanReview: true, allowedPaths: ["**/*.md"] },
        },
      },
    };
    const model = buildProfileSettingsModel(pluginInventory([baseline]), null, {
      "exograph-baseline.profile": { plan: profilePlanFixture(), error: null },
    });
    const html = renderToStaticMarkup(
      <ProfileSettingsContent
        actionError={null}
        actionMessage={null}
        actionStatus="idle"
        loadError={null}
        loadState="ready"
        model={model}
        onClearActive={() => {}}
        onCopy={() => {}}
        onCustomize={() => {}}
        onReview={() => {}}
        onSetActive={() => {}}
        onStageApply={() => {}}
        onToggleAutoUpdate={() => {}}
        onOpenAgentConfigEditor={() => {}}
        onOpenPluginManager={() => {}}
      />,
    );

    expect(html).toContain("Stage file proposals");
    expect(html).toContain("Workspace setup");
    expect(html).toContain("Saved onboarding choices");
    expect(html).toContain("Open Plugin Manager");
    expect(html).toContain("Open Agent Config");
    expect(html).toContain("Profile state, not plugin management.");
    expect(html).toContain("Plugin trust, enablement, setup, and plugin-owned settings live in Plugin Manager.");
    expect(html).not.toContain("Stage apply blocked");
  });

  it("resolves active profile state against detected profile candidates", () => {
    const baseline: PluginInventoryItem = {
      ...pluginInventoryItem("exograph-baseline.profile", "Exograph Baseline", "profile", "Profiles", "bundled"),
      pluginId: "exograph-baseline.plugin",
      pluginName: "Exograph Baseline Profile",
      manifestPath: "/plugins/exograph-baseline/exo.plugin.json",
      compatibility: {
        profile: {
          id: "exograph-baseline.profile",
          label: "Exograph Baseline",
          recommendedPlugins: [],
        },
      },
    };

    const model = buildProfileSettingsModel(pluginInventory([baseline]), {
      version: 1,
      activeProfile: {
        profileId: "exograph-baseline.profile",
        capabilityId: "exograph-baseline.profile",
        label: "My Lab",
        setup: {
          enabledHarnessIds: ["codex"],
          defaultHarnessId: "codex",
          routineTemplateIds: ["graph-health.template", "agent-instruction-sync.template"],
          exographContextApplied: true,
        },
        pluginId: "exograph-baseline.plugin",
        manifestPath: "/plugins/exograph-baseline/exo.plugin.json",
      },
      autoUpdate: true,
      reviewRequired: true,
      updatedAt: "2026-06-28T12:00:00.000Z",
    });

    expect(model.activeProfileLabel).toBe("My Lab");
    expect(model.autoUpdate).toBe(true);
    expect(model.reviewRequired).toBe(true);
    expect(model.baselineCandidate?.isActive).toBe(true);
    expect(model.workspaceSetupRows).toContainEqual({ label: "Default harness", value: "codex" });
    expect(model.workspaceSetupRows).toContainEqual({ label: "Starter routines", value: "Graph Health, Agent Instruction Sync" });
    expect(model.workspaceSetupRows).toContainEqual({ label: "Exograph context", value: "Applied to globals" });
  });

  it("builds a centralized read-only profile edit surface from profile sections", () => {
    const baseline: PluginInventoryItem = {
      ...pluginInventoryItem("exograph-baseline.profile", "Exograph Baseline", "profile", "Profiles", "bundled"),
      pluginId: "exograph-baseline.plugin",
      compatibility: {
        profile: {
          recommendedPlugins: [{ id: "qmd", required: false }],
          metadataSchemas: [{ id: "markdown-note", label: "Markdown note", scope: { paths: ["**/*.md"] }, frontmatter: { title: { type: "string" } } }],
          instructionTemplates: [{ id: "agents-md", label: "AGENTS.md" }],
          skills: [{ id: "terminal-stability", label: "Terminal Stability" }],
          routineTemplateIds: ["graph-health.template"],
          reviewPolicy: { fileChanges: "propose" },
          outputPolicy: { artifacts: "record" },
        },
      },
    };
    const candidate = buildProfileSettingsModel(pluginInventory([baseline]), null, {
      "exograph-baseline.profile": { plan: profilePlanFixture(), error: null },
    }).baselineCandidate;

    expect(candidate).not.toBeNull();
    expect(buildProfileEditPanelSections(candidate!).map((section) => section.id)).toEqual([
      "metadata",
      "planSummary",
      "applyPrompts",
      "recommendedPlugins",
      "templates",
      "skills",
      "schemas",
      "routines",
      "graph",
      "policies",
      "blockers",
    ]);

    const markup = renderToStaticMarkup(
      <ProfileEditPanel
        actionStatus="idle"
        candidate={candidate!}
        disabledReason={PROFILE_SETTINGS_DISABLED_REASON}
        onBack={() => {}}
        onCopy={() => {}}
        onOpenAgentConfigEditor={() => {}}
        onOpenPluginManager={() => {}}
      />,
    );
    expect(markup).toContain("Customize profile");
    expect(markup).toContain("Templatize");
    expect(markup).toContain("Create a trusted workspace-local metadata profile copy");
    expect(markup).toContain("Open Plugin Manager");
    expect(markup).toContain("Open Agent Config");
    expect(markup).toContain("Plugin trust, enablement, setup, and plugin-owned settings live in Plugin Manager.");
    expect(markup).toContain("Agent instructions and skills use the specialized Agent Config Editor.");
    expect(markup).toContain("Plan review");
    expect(markup).toContain("Apply blockers and warnings");
    expect(markup).toContain("disabled=");
    expect(markup).toContain("agents-md");
  });

  it("keeps Exograph Baseline visible even when inventory is unavailable", () => {
    const model = buildProfileSettingsModel(null);

    expect(model.activeProfileLabel).toBe("No active profile");
    expect(model.baselineCandidate).toBeNull();
    expect(model.detectedProfiles).toEqual([]);
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

describe("terminal monitor layout", () => {
  function monitorShape(node: PaneNode): unknown {
    if (node.kind === "leaf") {
      return node.content.kind === "terminal" ? node.content.terminalIds[0] ?? null : node.content.kind;
    }
    return [node.direction, monitorShape(node.children[0]), monitorShape(node.children[1])];
  }

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

  it("defines balanced monitor split shapes for common multi-agent counts", () => {
    const expectedShapes: Array<[number, unknown]> = [
      [1, "term-a"],
      [2, ["horizontal", "term-a", "term-b"]],
      [3, ["horizontal", ["vertical", "term-a", "term-b"], "term-c"]],
      [4, ["horizontal", ["vertical", "term-a", "term-b"], ["vertical", "term-c", "term-d"]]],
      [5, ["horizontal", ["vertical", ["horizontal", "term-a", "term-b"], "term-c"], ["vertical", "term-d", "term-e"]]],
      [6, ["horizontal", ["vertical", ["horizontal", "term-a", "term-b"], "term-c"], ["vertical", ["horizontal", "term-d", "term-e"], "term-f"]]],
      [
        8,
        [
          "horizontal",
          ["vertical", ["horizontal", "term-a", "term-b"], ["horizontal", "term-c", "term-d"]],
          ["vertical", ["horizontal", "term-e", "term-f"], ["horizontal", "term-g", "term-h"]],
        ],
      ],
    ];

    for (const [count, expectedShape] of expectedShapes) {
      const sessionIds = Array.from({ length: count }, (_, index) => `term-${String.fromCharCode(97 + index)}`);
      expect(monitorShape(buildTerminalMonitorTree(sessionIds, sessionIds.at(-1) ?? null))).toEqual(expectedShape);
    }
  });

  it("keeps live monitor additions converged with the balanced monitor tree", () => {
    const sessionIds = Array.from({ length: 8 }, (_, index) => `term-${String.fromCharCode(97 + index)}`);
    let tree = buildTerminalMonitorTree([sessionIds[0]], sessionIds[0]);
    let leafId = collectLeaves(tree)[0].id;

    for (const sessionId of sessionIds.slice(1)) {
      const result = addTerminalSessionAsSplit(tree, sessionId, leafId);
      tree = result.tree;
      leafId = result.leafId;

      const currentSessionIds = sessionIds.slice(0, sessionIds.indexOf(sessionId) + 1);
      expect(monitorShape(tree)).toEqual(
        monitorShape(buildTerminalMonitorTree(currentSessionIds, sessionId)),
      );
      expect(collectLeaves(tree).map((leaf) => leaf.id)).toEqual(
        currentSessionIds.map((id) => `terminal-session:${id}`),
      );
    }
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
    expect(result.leafId).toBe("terminal-session:term-a");
    expect(leaves[0].id).toBe("terminal-session:term-a");
    expect(leaves[0].content).toEqual({
      kind: "terminal",
      terminalIds: ["term-a"],
      activeTerminalId: "term-a",
    });
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

    expect(groups.map((group) => group.id)).toEqual(["core", "core:searchProvider", "core:agentHarness", "core:routineTemplate"]);
    expect(groups.find((group) => group.id === "core:agentHarness")?.items.map((item) => item.id)).toEqual(["codex"]);
    expect(buildPluginCategoryFilters(items)).toEqual([
      { id: "core", label: "Core", count: 1 },
      { id: "core:searchProvider", label: "Search providers", count: 1 },
      { id: "core:agentHarness", label: "Agent harnesses", count: 1 },
      { id: "core:routineTemplate", label: "Routine templates", count: 1 },
      { id: "core:profile", label: "Profiles", count: 0 },
      { id: "exo.graph:visualization", label: "Graph visualizations", count: 0 },
      { id: "other", label: "Other", count: 0 },
    ]);
    expect(filterPluginInventoryItems(items, "core:searchProvider").map((item) => item.id)).toEqual(["qmd"]);
  });

  it("filters inventory rows by management state within a selected category", () => {
    const active = pluginInventoryItem("qmd", "QMD", "searchProvider", "Search providers", "bundled");
    const disabled = {
      ...pluginInventoryItem("local-disabled", "Local Disabled", "searchProvider", "Search providers", "localManifest"),
      enabled: false,
      status: "disabled" as const,
      statusLabel: "Disabled",
    };
    const needsTrust = {
      ...pluginInventoryItem("local-untrusted", "Local Untrusted", "searchProvider", "Search providers", "localManifest"),
      trust: "untrusted" as const,
    };
    const configurable = {
      ...pluginInventoryItem("local-config", "Local Config", "searchProvider", "Search providers", "localManifest"),
      settings: resolvedPluginSettings(),
    };
    const setupIssue = {
      ...pluginInventoryItem("broken-search", "Broken Search", "searchProvider", "Search providers", "localManifest"),
      status: "missing-dependency" as const,
      statusLabel: "Missing dependency",
    };
    const categoryItems = filterPluginInventoryItems([active, disabled, needsTrust, configurable, setupIssue], "core:searchProvider");

    expect(buildPluginStateFilters(categoryItems).map((filter) => [filter.id, filter.count])).toEqual([
      ["all", 5],
      ["active", 2],
      ["attention", 2],
      ["disabled", 1],
      ["untrusted", 1],
      ["missing", 1],
      ["local", 4],
      ["configurable", 1],
    ]);
    expect(filterPluginInventoryItemsByState(categoryItems, "attention").map((item) => item.id)).toEqual(["broken-search", "local-untrusted"]);
    expect(filterPluginInventoryItemsByState(categoryItems, "untrusted").map((item) => item.id)).toEqual(["local-untrusted"]);
    expect(filterPluginInventoryItemsByState(categoryItems, "missing").map((item) => item.id)).toEqual(["broken-search"]);
    expect(filterPluginInventoryItemsByState(categoryItems, "configurable").map((item) => item.id)).toEqual(["local-config"]);
  });

  it("builds management summary buckets and row indicators from lifecycle state", () => {
    const active = pluginInventoryItem("qmd", "QMD", "searchProvider", "Search providers", "bundled");
    const disabled = { ...pluginInventoryItem("dev-search", "Dev Search", "searchProvider", "Search providers", "localManifest"), enabled: false, status: "disabled", statusLabel: "Disabled" };
    const untrusted = { ...pluginInventoryItem("local-harness", "Local Harness", "agentHarness", "Agent harnesses", "localManifest"), trust: "untrusted" as const };
    const setupIssue = {
      ...pluginInventoryItem("pi", "Pi", "agentHarness", "Agent harnesses", "bundled"),
      status: "missing-dependency",
      statusLabel: "Needs backend",
      dependencies: [{ id: "backend", label: "Backend", required: true, status: "missing", statusLabel: "Missing" }],
    };
    const permissionsNeeded: PluginInventoryItem = {
      ...pluginInventoryItem("routine", "Routine", "routineTemplate", "Routine templates", "localManifest"),
      permissions: ["notes:read", "projects:write"] as PluginInventoryItem["permissions"],
      permissionGrants: {
        requested: ["notes:read", "projects:write"] as PluginInventoryItem["permissions"],
        granted: ["notes:read"] as PluginInventoryItem["permissions"],
        missing: ["projects:write"] as PluginInventoryItem["permissions"],
        status: "partial" as const,
      },
    };
    const summary = buildPluginManagementSummary([active, disabled, untrusted, setupIssue, permissionsNeeded]);

    expect(summary.map((bucket) => [bucket.id, bucket.value])).toEqual([
      ["active", 2],
      ["disabled", 1],
      ["review", 1],
      ["setup", 1],
      ["permissions", "1/1"],
    ]);
    expect(buildPluginRowIndicators(untrusted).map((indicator) => indicator.label)).toContain("Needs trust");
    expect(buildPluginRowIndicators(setupIssue).map((indicator) => indicator.label)).toContain("Setup issue");
    expect(buildPluginRowIndicators(permissionsNeeded).map((indicator) => indicator.label)).toContain("Permissions needed");
    expect(pluginDisplayStatus(active)).toEqual({ label: "Active", tone: "ok" });
    expect(pluginDisplayStatus(disabled)).toEqual({ label: "Disabled", tone: "disabled" });
    expect(pluginDisplayStatus(untrusted)).toEqual({ label: "Untrusted", tone: "warning" });
    expect(pluginDisplayStatus(setupIssue)).toEqual({ label: "Missing dependency", tone: "danger" });
    expect(pluginDisplayStatus({ ...active, status: "unsupported-kind", statusLabel: "Not supported by this Exo version", enabled: false })).toEqual({
      label: "Not supported",
      tone: "disabled",
    });
  });

  it("renders plugin manager rows as management controls with scan-friendly state labels", () => {
    const local = {
      ...pluginInventoryItem("graph-health.template", "Graph Health", "routineTemplate", "Routine templates", "localManifest"),
      enabled: false,
      trust: "untrusted" as const,
      pluginId: "graph-health.plugin",
      pluginSource: "workspace" as const,
      manifestPath: "/workspace/.exo/plugins/graph-health/exo.plugin.json",
      rootDirectory: "/workspace/.exo/plugins/graph-health",
      permissions: ["notes:propose"] as PluginInventoryItem["permissions"],
    };
    const missing = {
      ...pluginInventoryItem("pi", "Pi", "agentHarness", "Agent harnesses", "bundled"),
      status: "missing-dependency" as const,
      statusLabel: "Needs inference backend",
      dependencies: [{ id: "backend", label: "Inference backend", required: true, status: "missing", statusLabel: "Missing" }],
    };
    const localHtml = renderToStaticMarkup(
      <PluginInventoryRow
        isSelected={false}
        item={local}
        onRunAction={vi.fn()}
        onSelect={vi.fn()}
        pendingAction={null}
      />,
    );
    const missingHtml = renderToStaticMarkup(
      <PluginInventoryRow
        isSelected={false}
        item={missing}
        onRunAction={vi.fn()}
        onSelect={vi.fn()}
        pendingAction={null}
      />,
    );

    expect(localHtml).toContain("data-state=\"Disabled\"");
    expect(localHtml).toContain("plugin-manager__row-management");
    expect(localHtml).toContain("Lifecycle");
    expect(localHtml).toContain("Trust");
    expect(localHtml).toContain("Enable");
    expect(localHtml).toContain("Permissions: 1 requested");
    expect(missingHtml).toContain("data-state=\"Missing dependency\"");
    expect(missingHtml).toContain("Dependencies: Inference backend: Missing");
    expect(missingHtml).toContain("Read-only");
  });

  it("separates the exograph baseline from official, local, and developer plugin layers", () => {
    const core = pluginInventoryItem("core.terminal", "Terminal host", "core", "Core", "core");
    const official = pluginInventoryItem("qmd", "QMD", "searchProvider", "Search providers", "bundled");
    const workspaceLocal = {
      ...pluginInventoryItem("graph-health.template", "Graph Health", "routineTemplate", "Routine templates", "localManifest"),
      distribution: "local" as const,
      distributionLabel: "Local",
      pluginId: "graph-health.plugin",
      pluginSource: "workspace" as const,
      manifestPath: "/workspace/.exo/plugins/graph-health/exo.plugin.json",
      rootDirectory: "/workspace/.exo/plugins/graph-health",
    };
    const developer = {
      ...pluginInventoryItem("dev-search", "Dev Search", "searchProvider", "Search providers", "localManifest"),
      pluginId: "dev-search.plugin",
      pluginSource: "dev" as const,
      manifestPath: "/dev/plugins/search/exo.plugin.json",
      rootDirectory: "/dev/plugins/search",
      enabled: false,
      status: "disabled" as const,
      statusLabel: "Disabled",
    };
    const summary = buildPluginBoundarySummary([core, official, workspaceLocal, developer]);

    expect(summary.coreSummary).toContain("Core stays available");
    expect(summary.layers.map((layer) => [layer.id, layer.value])).toEqual([
      ["core", 1],
      ["official", 1],
      ["local", 1],
      ["developer", 1],
    ]);
    expect(summary.manageableLocalCount).toBe(1);
    expect(summary.blockedCount).toBe(1);
    expect(pluginManagementLane(core)).toBe("Exograph baseline");
    expect(pluginManagementLane(official)).toBe("Official plugin");
    expect(pluginManagementLane(workspaceLocal)).toBe("Workspace plugin");
    expect(pluginManagementLane(developer)).toBe("Developer plugin");
    expect(pluginManagementGuidance(workspaceLocal)).toContain("Review trust");
  });

  it("summarizes search provider and harness metadata for read-only details", () => {
    const searchSections = buildPluginDetailSections({
      ...pluginInventoryItem("local-search", "Local Search", "searchProvider", "Search providers", "localManifest"),
      kind: "core:searchProvider",
      permissions: ["workspace:read", "notes:read"],
      surfaces: ["desktop", "mcp"],
      readiness: {
        state: "indexing",
        label: "Embeddings needed",
        detail: "12 documents still need embeddings.",
        metrics: [
          { label: "Mode", value: "hybrid" },
          { label: "Documents", value: 42 },
        ],
      },
      compatibility: {
        provider: "local",
        backend: "sqlite",
        modes: ["lexical", "hybrid"],
      },
    });
    const harnessSections = buildPluginDetailSections({
      ...pluginInventoryItem("pi", "Pi", "agentHarness", "Agent harnesses", "bundled"),
      kind: "core:agentHarness",
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
        { label: "Readiness", value: "Embeddings needed · 12 documents still need embeddings." },
        { label: "Mode", value: "hybrid" },
        { label: "Documents", value: "42" },
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

  it("shows permissions and same-category alternatives in detail sections", () => {
    const qmd: PluginInventoryItem = {
      ...pluginInventoryItem("qmd", "QMD", "searchProvider", "Search providers", "bundled"),
      permissionGrants: {
        requested: ["notes:read", "workspace:read"] as PluginInventoryItem["permissions"],
        granted: ["notes:read"] as PluginInventoryItem["permissions"],
        missing: ["workspace:read"] as PluginInventoryItem["permissions"],
        status: "partial" as const,
      },
    };
    const localSearch = pluginInventoryItem("local-search", "Local Search", "searchProvider", "Search providers", "localManifest");
    const sections = buildPluginDetailSections(qmd, pluginInventory([qmd, localSearch]));

    expect(sections.find((section) => section.id === "permissions")?.rows).toEqual(
      expect.arrayContaining([
        { label: "Requested", value: "notes:read, workspace:read" },
        { label: "Needed", value: "workspace:read" },
        { label: "Safety", value: "Permission requests are metadata only; this screen does not grant permissions or load executable plugin code" },
      ]),
    );
    expect(sections.find((section) => section.id === "alternatives")?.rows).toEqual(
      expect.arrayContaining([
        { label: "Compatible ready", value: "Local Search (Developer, Available)" },
        { label: "Same category", value: "Local Search (Developer, Available)" },
      ]),
    );
  });

  it("summarizes profile metadata for the read-only detail panel", () => {
    const profileItem: PluginInventoryItem = {
      ...pluginInventoryItem("exograph-baseline.profile", "Exograph Baseline", "profile", "Profiles", "localManifest"),
      kind: "core:profile",
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
      kind: "core:routineTemplate",
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
      kind: "exo.graph:visualization",
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

  it("allows only local and developer manifest-backed rows to mutate plugin state", () => {
    const core = pluginInventoryItem("core.terminal", "Terminal host", "core", "Core", "core");
    const official = pluginInventoryItem("qmd", "QMD", "searchProvider", "Search providers", "bundled");
    const local = {
      ...pluginInventoryItem("graph-health.template", "Graph Health", "routineTemplate", "Routine templates", "localManifest"),
      enabled: false,
      trust: "untrusted" as const,
      pluginId: "graph-health.plugin",
      pluginSource: "workspace" as const,
      manifestPath: "/workspace/.exo/plugins/graph-health/exo.plugin.json",
      rootDirectory: "/workspace/.exo/plugins/graph-health",
    };
    const trustedDeveloper = {
      ...local,
      id: "dev-health.template",
      enabled: true,
      trust: "trusted" as const,
      distribution: "developer" as const,
      distributionLabel: "Developer",
      pluginId: "dev-health.plugin",
      pluginSource: "dev" as const,
      manifestPath: "/dev/plugins/health/exo.plugin.json",
      rootDirectory: "/dev/plugins/health",
    };

    expect(pluginActionAvailability(core)).toMatchObject({ mutable: false, actions: [] });
    expect(pluginActionAvailability(official)).toMatchObject({ mutable: false, actions: [] });
    expect(pluginActionAvailability(local)).toMatchObject({ mutable: true, actions: ["trust", "enable"] });
    expect(pluginActionAvailability(trustedDeveloper)).toMatchObject({ mutable: true, actions: ["disable"] });
    expect(pluginActionAvailability({
      ...local,
      status: "unsupported-kind",
      statusLabel: "Not supported by this Exo version",
      enabled: false,
    })).toMatchObject({ mutable: false, actions: [] });
    expect(pluginActionInput(local)).toEqual({
      pluginId: "graph-health.plugin",
      capabilityId: "graph-health.template",
      source: "workspace",
      manifestPath: "/workspace/.exo/plugins/graph-health/exo.plugin.json",
      rootDirectory: "/workspace/.exo/plugins/graph-health",
    });
  });

  it("exposes remove and swap only for managed local plugin sources", () => {
    const workspaceLocal = {
      ...pluginInventoryItem("graph-health.template", "Graph Health", "routineTemplate", "Routine templates", "localManifest"),
      pluginId: "graph-health.plugin",
      pluginSource: "workspace" as const,
      manifestPath: "/workspace/.exo/plugins/graph-health/exo.plugin.json",
      rootDirectory: "/workspace/.exo/plugins/graph-health",
    };
    const userLocal = {
      ...workspaceLocal,
      pluginSource: "user" as const,
      manifestPath: "/user-data/plugins/graph-health/exo.plugin.json",
      rootDirectory: "/user-data/plugins/graph-health",
    };
    const developerLocal = {
      ...workspaceLocal,
      pluginSource: "dev" as const,
      manifestPath: "/dev/plugins/graph-health/exo.plugin.json",
      rootDirectory: "/dev/plugins/graph-health",
    };
    const official = pluginInventoryItem("qmd", "QMD", "searchProvider", "Search providers", "bundled");

    expect(pluginLocalManagementAvailability(workspaceLocal)).toMatchObject({
      manageable: true,
      target: "workspace",
      actions: ["replace", "remove"],
    });
    expect(pluginLocalManagementAvailability(userLocal)).toMatchObject({
      manageable: true,
      target: "user",
      actions: ["replace", "remove"],
    });
    expect(pluginLocalManagementAvailability(developerLocal)).toMatchObject({
      manageable: false,
      actions: [],
      target: null,
    });
    expect(pluginLocalManagementAvailability(official)).toMatchObject({
      manageable: false,
      actions: [],
      target: null,
    });
  });

  it("allows plugin settings editing only for trusted enabled mutable local manifests", () => {
    const baseSettings = {
      hasSettings: true,
      fieldCount: 2,
      configuredCount: 1,
      reviewRequired: false,
      configReviewRequired: false,
      validationErrors: [],
    };
    const trusted = {
      ...pluginInventoryItem("dev-health.template", "Dev Health", "routineTemplate", "Routine templates", "localManifest"),
      enabled: true,
      trust: "trusted" as const,
      pluginId: "dev-health.plugin",
      pluginSource: "dev" as const,
      manifestPath: "/dev/plugins/health/exo.plugin.json",
      rootDirectory: "/dev/plugins/health",
      settings: baseSettings,
    };
    const untrusted = { ...trusted, trust: "untrusted" as const };
    const disabled = { ...trusted, enabled: false };
    const noSchema = { ...trusted, settings: { ...baseSettings, hasSettings: false, fieldCount: 0 } };
    const official = pluginInventoryItem("qmd", "QMD", "searchProvider", "Search providers", "bundled");

    expect(pluginSettingsAvailability(trusted)).toMatchObject({ visible: true, editable: true, canRead: true });
    expect(pluginSettingsAvailability(untrusted)).toMatchObject({
      visible: true,
      editable: false,
      canRead: false,
      reason: "Trust this local or developer plugin before editing plugin-owned settings.",
    });
    expect(pluginSettingsAvailability(disabled)).toMatchObject({
      visible: true,
      editable: false,
      canRead: false,
      reason: "Enable this plugin before editing plugin-owned settings.",
    });
    expect(pluginSettingsAvailability(noSchema)).toMatchObject({
      visible: true,
      editable: false,
      canRead: false,
      reason: "This plugin manifest does not declare plugin-owned settings.",
    });
    expect(pluginSettingsAvailability(official)).toMatchObject({ visible: false, editable: false, canRead: false });
  });

  it("converts plugin settings drafts through simple host-owned controls", () => {
    const schema: PluginSettingsSchema = {
      version: 1,
      fields: [
        { id: "enabled", label: "Enabled", type: "boolean", default: true },
        { id: "name", label: "Name", type: "string", default: "daily" },
        { id: "limit", label: "Limit", type: "number", default: 3 },
        { id: "mode", label: "Mode", type: "select", default: "safe", options: [{ value: "safe", label: "Safe" }, { value: "fast", label: "Fast" }] },
      ],
    };
    const settings = resolvedPluginSettings({
      values: { enabled: false, name: "weekly", limit: 8, mode: "fast" },
    });
    const draft = createPluginSettingsDraft(schema, settings);

    expect(draft).toEqual({ enabled: false, name: "weekly", limit: "8", mode: "fast" });
    expect(pluginSettingsValuesFromDraft(schema, { enabled: true, name: "nightly", limit: "10", mode: "safe" })).toEqual({
      enabled: true,
      name: "nightly",
      limit: 10,
      mode: "safe",
    });
    expect(() => pluginSettingsValuesFromDraft(schema, { enabled: true, name: "nightly", limit: "many", mode: "safe" })).toThrow("Limit must be a number.");
  });

  it("renders plugin settings controls without executing plugin-rendered UI", () => {
    const schema: PluginSettingsSchema = {
      version: 1,
      sections: [{ id: "general", label: "General", fields: ["enabled", "mode", "limit", "label"] }],
      fields: [
        { id: "enabled", label: "Enabled", type: "boolean", default: true },
        { id: "mode", label: "Mode", type: "select", default: "safe", options: [{ value: "safe", label: "Safe" }, { value: "fast", label: "Fast" }] },
        { id: "limit", label: "Limit", type: "number", default: 5 },
        { id: "label", label: "Label", type: "string", default: "Daily" },
      ],
    };
    const item = {
      ...pluginInventoryItem("dev-health.template", "Dev Health", "routineTemplate", "Routine templates", "localManifest"),
      pluginId: "dev-health.plugin",
      pluginSource: "dev" as const,
      manifestPath: "/dev/plugins/health/exo.plugin.json",
      rootDirectory: "/dev/plugins/health",
    };
    const html = renderToStaticMarkup(
      <PluginSettingsSection
        availabilityReason="Plugin-owned settings can be edited for trusted and enabled local or developer plugins."
        draft={{ enabled: true, mode: "fast", limit: "9", label: "Nightly" }}
        editable={true}
        item={item}
        message={null}
        onApply={vi.fn()}
        onDraftChange={vi.fn()}
        onReset={vi.fn()}
        pendingAction={null}
        schema={schema}
        settings={resolvedPluginSettings({ fieldCount: 4, configuredCount: 2 })}
        state="idle"
      />,
    );
    const disabledHtml = renderToStaticMarkup(
      <PluginSettingsSection
        availabilityReason="Trust this local or developer plugin before editing plugin-owned settings."
        draft={{ enabled: true, mode: "fast", limit: "9", label: "Nightly" }}
        editable={false}
        item={item}
        message={null}
        onApply={vi.fn()}
        onDraftChange={vi.fn()}
        onReset={vi.fn()}
        pendingAction={null}
        schema={schema}
        settings={resolvedPluginSettings({ fieldCount: 4, configuredCount: 2 })}
        state="idle"
      />,
    );

    expect(html).toContain("type=\"checkbox\"");
    expect(html).toContain("<select");
    expect(html).toContain("type=\"number\"");
    expect(html).toContain("type=\"text\"");
    expect(html).toContain("Plugin-owned settings");
    expect(html).toContain("they do not load plugin code or grant permissions");
    expect(html).toContain("plugin-manager-settings-apply");
    expect(disabledHtml).toContain("disabled=\"\"");
  });
});

function proposalBatchFixture(overrides: Partial<ProposalBatch> = {}): ProposalBatch {
  return {
    id: "proposal-1",
    title: "Review workspace changes",
    description: "Generated by a profile apply preview.",
    status: "pending",
    provenance: { activityId: "activity-1", sessionId: "term-1" },
    items: [
      {
        id: "item-1",
        kind: "fileCreate",
        path: "notes/proposal.md",
        itemStatus: "pending",
        contents: "# Proposal\n",
      },
    ],
    createdAt: "2026-07-03T00:00:00.000Z",
    updatedAt: "2026-07-03T00:00:00.000Z",
    ...overrides,
  };
}

function profilePlanFixture(): ProfilePlanPreview {
  return {
    mode: "preview",
    writeCapable: false,
    profile: {
      id: "exograph-baseline.profile",
      label: "Exograph Baseline",
      lifecycle: "built-in",
    },
    apply: {
      available: false,
      label: "Review only",
      reason: "Profile application is read-only until explicit apply gates exist.",
      blockedBy: [
        {
          kind: "permissionModel",
          message: "Permission prompts and trust grants are not implemented for profile application.",
          actionIds: ["qmd", "agents-md"],
        },
      ],
      promptSteps: [
        {
          kind: "fileWriteReview",
          label: "Review file writes",
          detail: "Stage and approve context and instruction file changes before writing user files.",
          actionIds: ["agents-md"],
          enabled: false,
          required: false,
        },
      ],
    },
    summary: {
      totalActions: 6,
      readyPluginRecommendations: 1,
      warningCount: 0,
      blockerCount: 1,
      wouldWriteCount: 1,
      wouldInstallSkillCount: 1,
      wouldScheduleRoutineCount: 1,
    },
    safety: {
      writesEnabled: false,
      pluginEnableEnabled: false,
      skillInstallEnabled: false,
      routineSchedulingEnabled: false,
      mcpConfigMutationEnabled: false,
    },
    blockers: [
      {
        severity: "blocker",
        actionKind: "pluginRecommendation",
        actionId: "qmd",
        message: "Required plugin qmd is missing.",
      },
    ],
    warnings: [],
    actions: [
      {
        kind: "pluginRecommendation",
        id: "qmd",
        label: "QMD advanced search",
        severity: "info",
        required: false,
        recommendation: { id: "qmd", required: false },
        pluginStatus: "ready",
        effect: { previewOnly: true, mutates: false },
      },
      {
        kind: "instructionTemplate",
        id: "agents-md",
        label: "AGENTS.md",
        severity: "info",
        template: { id: "agents-md", label: "AGENTS.md", target: "AGENTS.md", templatePath: "templates/AGENTS.md" },
        effect: { previewOnly: true, mutates: false, wouldWrite: "Would write AGENTS.md." },
      },
      {
        kind: "skill",
        id: "terminal-stability",
        label: "Terminal Stability",
        severity: "info",
        skill: {
          id: "terminal-stability",
          label: "Terminal Stability",
          harnesses: ["claude", "codex"],
          sourcePath: "skills/terminal-stability",
          required: false,
        },
        effect: { previewOnly: true, mutates: false, wouldInstallSkills: "Would install terminal-stability." },
      },
      {
        kind: "metadataSchema",
        id: "markdown-note",
        label: "Markdown note",
        severity: "info",
        schema: {
          id: "markdown-note",
          label: "Markdown note",
          scope: { paths: ["**/*.md"] },
          frontmatter: { title: { type: "string", required: false } },
          tags: [],
        },
        effect: { previewOnly: true, mutates: false },
      },
      {
        kind: "routineTemplate",
        id: "graph-health.template",
        label: "graph-health.template",
        severity: "info",
        routineTemplateId: "graph-health.template",
        effect: { previewOnly: true, mutates: false, wouldScheduleRoutines: "Would schedule graph-health.template." },
      },
      {
        kind: "reviewPolicy",
        id: "reviewPolicy",
        label: "Review policy",
        severity: "info",
        reviewPolicy: { fileChanges: "propose", requireHumanReview: true, allowedPaths: ["**/*.md"] },
        effect: { previewOnly: true, mutates: false },
      },
    ],
  };
}

function pluginInventoryItem(
  id: string,
  label: string,
  categoryId: string,
  categoryLabel: string,
  source: PluginInventoryItem["source"],
): PluginInventoryItem {
  const normalizedCategoryId = normalizeTestCapabilityCategory(categoryId);
  return {
    id,
    label,
    description: `${label} description`,
    kind: normalizedCategoryId === "core" ? "core" : normalizedCategoryId as PluginInventoryItem["kind"],
    categoryId: normalizedCategoryId,
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

function normalizeTestCapabilityCategory(categoryId: string): string {
  switch (categoryId) {
    case "searchProvider":
      return "core:searchProvider";
    case "agentHarness":
      return "core:agentHarness";
    case "profile":
      return "core:profile";
    case "routineTemplate":
      return "core:routineTemplate";
    case "graphVisualization":
      return "exo.graph:visualization";
    default:
      return categoryId;
  }
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

function resolvedPluginSettings(overrides: Partial<ResolvedPluginSettings> = {}): ResolvedPluginSettings {
  return {
    pluginId: "dev-health.plugin",
    hasSettings: true,
    fieldCount: 0,
    configuredCount: 0,
    values: {},
    defaults: {},
    userValues: {},
    reviewRequired: false,
    configReviewRequired: false,
    validationErrors: [],
    ...overrides,
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
    piHarnessEnabled: true,
    piHarnessLabel: "",
    piHarnessCommand: "",
    piHarnessRepoPath: "",
    piHarnessArgs: "",
    piHarnessBackendUrl: "",
    piHarnessBackendCommand: "",
    piHarnessBackendLabel: "",
    piHarnessBackendKind: "",
    piHarnessBackendReady: "auto",
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
    expect(onCreateTerminal).toHaveBeenNthCalledWith(1, "shell", "shell");
    expect(onCreateTerminal).toHaveBeenNthCalledWith(2, "agent", "pi");
    expect(onOpenAgentConfigEditor).toHaveBeenCalledTimes(1);
  });

  it("renders persisted Pi-compatible setup controls in Agent Config", () => {
    const draft = createPiHarnessDraft({
      label: "GA Pi",
      repoPath: "/workspace/projects/ga-pi",
      backendUrl: "http://127.0.0.1:8080",
      backendLabel: "llama.cpp",
    });
    const markup = renderToStaticMarkup(
      <PiHarnessSettingsPanel
        draft={draft}
        harness={harness("pi", false, {
          label: "GA Pi",
          status: "missing-dependency",
          statusLabel: "Missing dependency",
          setupSummary: "Configure EXO_PI_BACKEND_URL or EXO_PI_BACKEND_COMMAND for a compatible local inference backend.",
        })}
        onChange={vi.fn()}
        onSave={vi.fn()}
        saveMessage={null}
        saveState="idle"
      />,
    );

    expect(markup).toContain("Pi-compatible setup");
    expect(markup).toContain("Missing dependency");
    expect(markup).toContain("pi-harness-backend-url");
    expect(markup).toContain("http://127.0.0.1:8080");
    expect(piHarnessSettingsFromDraft({ ...draft, args: "--model, local", backendReady: "true" })).toMatchObject({
      label: "GA Pi",
      repoPath: "/workspace/projects/ga-pi",
      args: ["--model", "local"],
      backendUrl: "http://127.0.0.1:8080",
      backendLabel: "llama.cpp",
      backendReady: true,
    });
  });

  it("renders persisted Pi-compatible setup controls in Workspace Settings", () => {
    const markup = renderToStaticMarkup(
      <WorkspaceSettingsDialog
        agentHarnesses={[
          harness("pi", false, {
            label: "GA Pi",
            status: "missing-dependency",
            statusLabel: "Missing dependency",
            setupSummary: "Configure a compatible local inference backend before launch.",
            dependencies: [
              {
                id: "pi-inference-backend",
                kind: "inference-backend",
                label: "llama.cpp",
                required: true,
                configured: false,
                detected: false,
                satisfied: false,
                statusLabel: "Missing",
              },
            ],
          }),
        ]}
        indexBusy={null}
        indexStatus={null}
        onChooseFolder={() => {}}
        onClose={() => {}}
        onOpenAgentConfigEditor={() => {}}
        onOpenPluginManager={() => {}}
        onOpenWorkspaceSwitcher={() => {}}
        onRunIndexUpdate={() => {}}
        onSave={() => {}}
        settings={workspaceSettingsDialogFixture({
          section: "harnesses",
          piHarnessLabel: "GA Pi",
          piHarnessRepoPath: "/workspace/projects/ga-pi",
          piHarnessBackendLabel: "llama.cpp",
        })}
        setSettings={() => {}}
        structuralDraftKey={() => ""}
      />,
    );

    expect(markup).toContain("Pi-compatible harness");
    expect(markup).toContain("Missing dependency");
    expect(markup).toContain("Configure a compatible local inference backend before launch.");
    expect(markup).toContain("workspace-settings-pi-repo-path");
    expect(markup).toContain("/workspace/projects/ga-pi");
  });
});

describe("tool surface action dispatch", () => {
  it("routes future plugin tool targets through the Plugin Manager until dedicated hosts exist", () => {
    const onOpenPluginManager = vi.fn();

    runToolSurfaceAction(toolSurfaceDescriptor({ type: "routineTemplate.open", routineTemplateId: "graph-health.template" }), {
      onToggleTerminalCollapsed: vi.fn(),
      onToggleSidePanes: vi.fn(),
      onOpenAgentConfigEditor: vi.fn(),
      onOpenPluginManager,
      onCreateTerminal: vi.fn(),
    });

    expect(onOpenPluginManager).toHaveBeenCalledTimes(1);
  });
});

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
      piHarnessEnabled: true,
      piHarnessLabel: "",
      piHarnessCommand: "",
      piHarnessRepoPath: "",
      piHarnessArgs: "",
      piHarnessBackendUrl: "",
      piHarnessBackendCommand: "",
      piHarnessBackendLabel: "",
      piHarnessBackendKind: "",
      piHarnessBackendReady: "auto",
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
      piHarnessEnabled: true,
      piHarnessLabel: "",
      piHarnessCommand: "",
      piHarnessRepoPath: "",
      piHarnessArgs: "",
      piHarnessBackendUrl: "",
      piHarnessBackendCommand: "",
      piHarnessBackendLabel: "",
      piHarnessBackendKind: "",
      piHarnessBackendReady: "auto" as const,
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

  it("builds a plugin setup review from plugin inventory without locked core rows", () => {
    const core = pluginInventoryItem("core.markdown-graph", "Markdown graph", "core", "Core", "core");
    const qmd = pluginInventoryItem("qmd", "QMD advanced search", "searchProvider", "Search providers", "bundled");
    const codex = {
      ...pluginInventoryItem("codex", "Codex", "agentHarness", "Agent harnesses", "bundled"),
      status: "not-found",
      statusLabel: "Not found",
    };
    const localProfile = {
      ...pluginInventoryItem("lab.profile", "Lab profile", "profile", "Profiles", "localManifest"),
      distribution: "local" as const,
      distributionLabel: "Local",
      trust: "untrusted" as const,
    };
    const sections = buildOnboardingCapabilitySections(pluginInventory([codex, localProfile, qmd, core]));

    expect(sections.map((section) => section.id)).toEqual(["core:searchProvider"]);
    expect(sections.find((section) => section.id === "core:searchProvider")?.rows.map((row) => row.id)).toEqual(["qmd"]);
    expect(sections.some((section) => section.rows.some((row) => row.id === "codex"))).toBe(false);
    expect(onboardingCapabilityStatus(core)).toBe("Core, locked");
    expect(onboardingCapabilityStatus(qmd)).toBe("Official, available");
    expect(onboardingCapabilityStatus(localProfile)).toBe("Local, review needed");
    expect(onboardingCapabilityTone(codex)).toBe("warning");
    expect(onboardingCapabilitySelected(codex)).toBe(false);
    expect(onboardingCapabilitySelectable(codex)).toBe(false);
    expect(onboardingCapabilitySelected(qmd)).toBe(true);
    expect(onboardingCapabilitySelectable(qmd)).toBe(true);
  });

  it("renders post-workspace plugin setup without core rows or search-provider defaults", () => {
    const inventory = pluginInventory([
      pluginInventoryItem("core.markdown-graph", "Markdown graph", "core", "Core", "core"),
      pluginInventoryItem("qmd", "QMD advanced search", "searchProvider", "Search providers", "bundled"),
      {
        ...pluginInventoryItem("codex", "Codex", "agentHarness", "Agent harnesses", "bundled"),
        status: "not-found",
        statusLabel: "Not found",
      },
      {
        ...pluginInventoryItem("lab.profile", "Lab profile", "profile", "Profiles", "localManifest"),
        kind: "core:profile",
        compatibility: {
          profile: {
            recommendedPlugins: [{ id: "qmd", required: false }],
            contextTemplates: [{ id: "agents", label: "Agent instructions", target: "AGENTS.md", templatePath: "templates/AGENTS.md" }],
          },
        },
      },
    ]);
    const html = renderToStaticMarkup(
      <OnboardingCapabilityReviewContent
        errorMessage={null}
        inventory={inventory}
        loadState="idle"
        notesFolder="/workspace/notes"
        onBack={vi.fn()}
        onEnterWorkspace={vi.fn()}
        onTogglePlugin={vi.fn()}
        sections={buildOnboardingCapabilitySections(inventory)}
      />,
    );

    expect(html).toContain("Set up your Exograph");
    expect(html).toContain("Choose plugins, agent context, and routine defaults.");
    expect(html).not.toContain("Markdown graph");
    expect(html).not.toContain("Core, locked");
    expect(html).toContain("QMD advanced search");
    expect(html).toContain("onboarding-plugin-toggle-qmd");
    expect(html).not.toContain("Agent harnesses");
    expect(html).not.toContain("Official, not found");
    expect(html).toMatch(/data-testid=\"onboarding-plugin-toggle-qmd\"[^>]*checked=\"\"/);
    expect(html).not.toMatch(/data-testid=\"onboarding-plugin-toggle-qmd\"[^>]*disabled=\"\"/);
    expect(html).not.toContain("onboarding-plugin-toggle-codex");
    expect(html).not.toContain("Advanced search default");
    expect(html).not.toContain("QMD hybrid");
    expect(html).not.toContain("Profile plan preview");
    expect(html).not.toContain("Lab profile");
    expect(html).toContain("Agent context");
    expect(html).toContain("Routines");
    expect(html).toContain("Continue");
  });

  it("lets detected bundled harnesses be deselected as onboarding choices", () => {
    const inventory = pluginInventory([
      pluginInventoryItem("qmd", "QMD advanced search", "searchProvider", "Search providers", "bundled"),
      pluginInventoryItem("codex", "Codex", "agentHarness", "Agent harnesses", "bundled"),
    ]);
    const html = renderToStaticMarkup(
      <OnboardingCapabilityReviewContent
        errorMessage={null}
        inventory={inventory}
        loadState="idle"
        notesFolder="/workspace/notes"
        onBack={vi.fn()}
        onEnterWorkspace={vi.fn()}
        onTogglePlugin={vi.fn()}
        sections={buildOnboardingCapabilitySections(inventory)}
        selectedHarnesses={[inventory.items[1]]}
        defaultHarnessId="codex"
      />,
    );

    expect(html).toContain("Agent harnesses");
    expect(html).toContain("Default harness for routines");
    expect(html).toMatch(/data-testid=\"onboarding-plugin-toggle-codex\"[^>]*checked=\"\"/);
    expect(html).not.toMatch(/data-testid=\"onboarding-plugin-toggle-codex\"[^>]*disabled=\"\"/);
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

  it("blocks terminal input while a running session is unhealthy but allows reconnect", () => {
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
      healthDetail: "Tmux session is alive but Exo's attach bridge is detached; reconnect the terminal.",
      attachGeneration: 1,
    } as const;

    expect(isTerminalInputEnabled(unhealthySession)).toBe(false);
    expect(isReconnectableSession(unhealthySession)).toBe(true);
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

  it("prioritizes terminal restore state without requiring a floating overlay", () => {
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
      label: "Restoring terminal",
      tone: "info",
      title: "Shell: reattaching to the durable tmux pane.",
      busy: true,
      sessionId: "term-shell",
    });
    expect(summarizeTerminalStatusLine([sessions[0]], "term-shell", new Set())).toBeNull();
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
    expect(shouldBufferTerminalDataForHydration(true, "reconnect", true)).toBe(false);
  });
});

describe("changed file review attribution", () => {
  it("does not associate ambiguous same-cwd file changes with every terminal", () => {
    const sessions = [
      {
        id: "term-a",
        title: "Shell A",
        cwd: "/workspace/project",
        terminalKind: "shell",
        harnessId: null,
        kind: "shell",
        command: "zsh",
        status: "running",
        attachGeneration: 1,
      },
      {
        id: "term-b",
        title: "Shell B",
        cwd: "/workspace/project",
        terminalKind: "shell",
        harnessId: null,
        kind: "shell",
        command: "zsh",
        status: "running",
        attachGeneration: 1,
      },
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
