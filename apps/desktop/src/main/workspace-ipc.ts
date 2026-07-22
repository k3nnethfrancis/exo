import { BrowserWindow, dialog, shell, type OpenDialogOptions } from "electron";
import path from "node:path";
import { assertOntologyReviewGuard, WorkspaceFiles, type WorkspaceModel } from "@exo/core";

import type { DesktopApi, FileStatInfo, RendererEditorDiagnostic, WorkspaceRegistryEntry } from "../shared/api";
import { handleDesktopInvoke } from "./typed-ipc";

type WorkspaceApi = DesktopApi["workspace"];
type NotesApi = DesktopApi["notes"];

export interface WorkspaceIpcHandlers {
  activateWorkspace: WorkspaceApi["activateWorkspace"];
  createFolder: WorkspaceApi["createFolder"];
  createFile: WorkspaceApi["createFile"];
  deletePath: WorkspaceApi["deletePath"];
  embedIndex: WorkspaceApi["embedIndex"];
  ensureTarget: NotesApi["ensureTarget"];
  getIndexStatus: WorkspaceApi["getIndexStatus"];
  previewOntology: WorkspaceApi["previewOntology"];
  keepOntology: WorkspaceApi["keepOntology"];
  rejectOntology: WorkspaceApi["rejectOntology"];
  getFolderIndexStatus: WorkspaceApi["getFolderIndexStatus"];
  getFolderOverview: WorkspaceApi["getFolderOverview"];
  ensureFolderIndex: WorkspaceApi["ensureFolderIndex"];
  launchAgentInvocation: WorkspaceApi["launchAgentInvocation"];
  getAgentInvocationAuthorization: WorkspaceApi["getAgentInvocationAuthorization"];
  getAgentCommandTrust: WorkspaceApi["getAgentCommandTrust"];
  resetAgentCommandTrust: WorkspaceApi["resetAgentCommandTrust"];
  getAgentCommandLaunchFacts: WorkspaceApi["getAgentCommandLaunchFacts"];
  getAgentCommandContinuity: WorkspaceApi["getAgentCommandContinuity"];
  resetAgentCommandContinuity: WorkspaceApi["resetAgentCommandContinuity"];
  testAgentCommand: WorkspaceApi["testAgentCommand"];
  configureProviderMcp: WorkspaceApi["configureProviderMcp"];
  getCliInstallationStatus: WorkspaceApi["getCliInstallationStatus"];
  recordRendererDiagnostic: WorkspaceApi["recordRendererDiagnostic"];
  endAgentInvocation: WorkspaceApi["endAgentInvocation"];
  listPendingInvocationReviews: WorkspaceApi["listPendingInvocationReviews"];
  listInvocationHistory: WorkspaceApi["listInvocationHistory"];
  getInvocationFileReview: WorkspaceApi["getInvocationFileReview"];
  reviewInvocationFile: WorkspaceApi["reviewInvocationFile"];
  reviewInvocationAll: WorkspaceApi["reviewInvocationAll"];
  resumeInvocationInTerminal: WorkspaceApi["resumeInvocationInTerminal"];
  resolvePreviewTarget: WorkspaceApi["resolvePreviewTarget"];
  getGraphContext: NotesApi["getGraphContext"];
  getGraphTopology: NotesApi["getGraphTopology"];
  getGraphConceptSummaries: NotesApi["getGraphConceptSummaries"];
  graphConceptLookup: NotesApi["graphConceptLookup"];
  getGraphConceptDetailByIndex: NotesApi["getGraphConceptDetailByIndex"];
  getMainWindow: () => BrowserWindow | null;
  getModel: () => WorkspaceModel;
  getSettings: WorkspaceApi["getSettings"];
  getSetupState: WorkspaceApi["getSetupState"];
  markOnboardingComplete: WorkspaceApi["markOnboardingComplete"];
  listTree: WorkspaceApi["listTree"];
  listWorkspaces: () => Promise<WorkspaceRegistryEntry[]>;
  readNote: NotesApi["read"];
  renamePath: WorkspaceApi["renamePath"];
  resolveTarget: NotesApi["resolveTarget"];
  resolveMarkdownImage: NotesApi["resolveMarkdownImage"];
  saveNote: NotesApi["save"];
  saveSettings: WorkspaceApi["saveSettings"];
  searchIndex: WorkspaceApi["searchIndex"];
  searchNotes: WorkspaceApi["searchNotes"];
  searchTag: WorkspaceApi["searchTag"];
  searchWorkspace: WorkspaceApi["searchWorkspace"];
  statNote: (filePath: string) => Promise<FileStatInfo | null>;
  suggestTargets: NotesApi["suggestTargets"];
  syncIndex: WorkspaceApi["syncIndex"];
  updateIndex: WorkspaceApi["updateIndex"];
}

export function registerWorkspaceIpcHandlers(handlers: WorkspaceIpcHandlers) {
  const workspaceFiles = () => new WorkspaceFiles(handlers.getModel().noteRoots.map((root) => root.path));

  handleDesktopInvoke("workspace:get-model", async () => handlers.getModel());
  handleDesktopInvoke("workspace:get-settings", async () => handlers.getSettings());
  handleDesktopInvoke("workspace:get-setup-state", async () => handlers.getSetupState());
  handleDesktopInvoke("workspace:mark-onboarding-complete", async () => handlers.markOnboardingComplete());
  handleDesktopInvoke("workspace:list-workspaces", async () => handlers.listWorkspaces());
  handleDesktopInvoke("workspace:activate-workspace", async (_event, input) => handlers.activateWorkspace(input));
  handleDesktopInvoke("workspace:get-index-status", async () => handlers.getIndexStatus());
  handleDesktopInvoke("workspace:ontology-preview", async () => handlers.previewOntology());
  handleDesktopInvoke("workspace:ontology-keep", async (_event, guard) => handlers.keepOntology(assertOntologyReviewGuard(guard)));
  handleDesktopInvoke("workspace:ontology-reject", async (_event, guard) => handlers.rejectOntology(assertOntologyReviewGuard(guard)));
  handleDesktopInvoke("workspace:get-folder-index-status", async () => handlers.getFolderIndexStatus());
  handleDesktopInvoke("workspace:get-folder-overview", async (_event, directoryPath) => {
    const authorizedDirectory = await workspaceFiles().existing(directoryPath);
    return handlers.getFolderOverview(authorizedDirectory);
  });
  handleDesktopInvoke("workspace:resolve-preview-target", async (_event, target) => handlers.resolvePreviewTarget(target));
  handleDesktopInvoke("workspace:launch-agent-invocation", async (_event, input) => {
    const documentPath = await workspaceFiles().existing(input.documentPath);
    return handlers.launchAgentInvocation({ ...input, documentPath });
  });
  handleDesktopInvoke("workspace:get-agent-invocation-authorization", async (_event, input) => {
    const documentPath = await workspaceFiles().existing(input.documentPath);
    return handlers.getAgentInvocationAuthorization({ ...input, documentPath });
  });
  handleDesktopInvoke("workspace:get-agent-command-trust", async (_event, handle) => handlers.getAgentCommandTrust(handle));
  handleDesktopInvoke("workspace:reset-agent-command-trust", async (_event, handle) => handlers.resetAgentCommandTrust(handle));
  handleDesktopInvoke("workspace:get-agent-command-launch-facts", async (_event, commandId) =>
    handlers.getAgentCommandLaunchFacts(commandId),
  );
  handleDesktopInvoke("workspace:get-agent-command-continuity", async (_event, commandId) => handlers.getAgentCommandContinuity(commandId));
  handleDesktopInvoke("workspace:reset-agent-command-continuity", async (_event, commandId) => handlers.resetAgentCommandContinuity(commandId));
  handleDesktopInvoke("workspace:test-agent-command", async (_event, input) => handlers.testAgentCommand(input));
  handleDesktopInvoke("workspace:configure-provider-mcp", async (_event, input) => handlers.configureProviderMcp(input));
  handleDesktopInvoke("workspace:get-cli-installation-status", async () => handlers.getCliInstallationStatus());
  handleDesktopInvoke("workspace:record-renderer-diagnostic", async (_event, diagnostic) =>
    handlers.recordRendererDiagnostic(assertRendererEditorDiagnostic(diagnostic)),
  );
  handleDesktopInvoke("workspace:end-agent-invocation", async (_event, invocationId) => handlers.endAgentInvocation(invocationId));
  handleDesktopInvoke("workspace:list-pending-invocation-reviews", async () => handlers.listPendingInvocationReviews());
  handleDesktopInvoke("workspace:list-invocation-history", async (_event, notePath) =>
    handlers.listInvocationHistory(await workspaceFiles().writable(notePath)));
  handleDesktopInvoke("workspace:get-invocation-file-review", async (_event, input) => handlers.getInvocationFileReview(input));
  handleDesktopInvoke("workspace:review-invocation-file", async (_event, input) => {
    assertReviewAction(input.action);
    return handlers.reviewInvocationFile(input);
  });
  handleDesktopInvoke("workspace:review-invocation-all", async (_event, input) => {
    assertReviewAction(input.action);
    return handlers.reviewInvocationAll(input);
  });
  handleDesktopInvoke("workspace:resume-invocation-in-terminal", async (_event, invocationId) => handlers.resumeInvocationInTerminal(invocationId));
  handleDesktopInvoke("workspace:index-sync", async () => handlers.syncIndex());
  handleDesktopInvoke("workspace:index-update", async () => handlers.updateIndex());
  handleDesktopInvoke("workspace:index-embed", async () => handlers.embedIndex());
  handleDesktopInvoke("workspace:save-settings", async (_event, request) => handlers.saveSettings(request));
  handleDesktopInvoke(
    "workspace:select-folder",
    async (_event, options) => {
      if (process.env.EXO_TEST === "1" && process.env.EXO_TEST_SELECT_FOLDER_CANCEL === "1") {
        return [];
      }
      if (process.env.EXO_TEST === "1" && process.env.EXO_TEST_SELECT_FOLDER_PATH) {
        return options?.allowMultiple
          ? process.env.EXO_TEST_SELECT_FOLDER_PATH.split(path.delimiter).filter(Boolean)
          : [process.env.EXO_TEST_SELECT_FOLDER_PATH];
      }

      const dialogOptions: OpenDialogOptions = {
        title: options?.title,
        buttonLabel: options?.buttonLabel,
        properties: [
          "openDirectory",
          "createDirectory",
          ...(options?.allowMultiple ? ["multiSelections" as const] : []),
        ],
      };
      const mainWindow = handlers.getMainWindow();
      const result = mainWindow && !mainWindow.isDestroyed()
        ? await dialog.showOpenDialog(mainWindow, dialogOptions)
        : await dialog.showOpenDialog(dialogOptions);
      return result.canceled ? [] : result.filePaths;
    },
  );
  handleDesktopInvoke(
    "workspace:list-tree",
    async (_event, rootPath, options) => {
      const authorizedRootPath = await workspaceFiles().existing(rootPath);
      return handlers.listTree(authorizedRootPath, options);
    },
  );
  handleDesktopInvoke("workspace:search-notes", async (_event, query) => handlers.searchNotes(query));
  handleDesktopInvoke("workspace:search-workspace", async (_event, query) => handlers.searchWorkspace(query));
  handleDesktopInvoke(
    "workspace:search-index",
    async (_event, query, options) =>
      handlers.searchIndex(query, options),
  );
  handleDesktopInvoke("workspace:create-file", async (_event, targetPath, content) => {
    const authorizedPath = await workspaceFiles().writable(targetPath);
    return handlers.createFile(authorizedPath, content);
  });
  handleDesktopInvoke("workspace:create-folder", async (_event, targetPath) => {
    const authorizedPath = await workspaceFiles().writable(targetPath);
    return handlers.createFolder(authorizedPath);
  });
  handleDesktopInvoke("workspace:ensure-folder-index", async (_event, directoryPath) => {
    const files = workspaceFiles();
    const authorizedDirectory = await files.existing(directoryPath);
    await files.writable(path.join(authorizedDirectory, "index.md"));
    return handlers.ensureFolderIndex(authorizedDirectory);
  });
  handleDesktopInvoke("workspace:rename-path", async (_event, sourcePath, nextPath) => {
    const files = workspaceFiles();
    const [authorizedSourcePath, authorizedNextPath] = await Promise.all([
      files.writable(sourcePath),
      files.writable(nextPath),
    ]);
    return handlers.renamePath(authorizedSourcePath, authorizedNextPath);
  });
  handleDesktopInvoke("workspace:delete-path", async (_event, targetPath) => {
    const authorizedPath = await workspaceFiles().writable(targetPath);
    return handlers.deletePath(authorizedPath);
  });
  handleDesktopInvoke("workspace:search-tag", async (_event, tag) => handlers.searchTag(tag));
  handleDesktopInvoke("notes:read", async (_event, filePath) => {
    const authorizedPath = await workspaceFiles().existing(filePath);
    return handlers.readNote(authorizedPath);
  });
  handleDesktopInvoke("notes:save", async (_event, filePath, frontmatter, body) => {
    const authorizedPath = await workspaceFiles().writable(filePath);
    return handlers.saveNote(authorizedPath, frontmatter, body);
  });
  handleDesktopInvoke("notes:stat", async (_event, filePath) => {
    const authorizedPath = await workspaceFiles().writable(filePath);
    return handlers.statNote(authorizedPath);
  });
  handleDesktopInvoke("notes:get-graph-context", async (_event, filePath) => {
    const authorizedPath = await workspaceFiles().existing(filePath);
    return handlers.getGraphContext(authorizedPath);
  });
  handleDesktopInvoke("notes:get-graph-topology", async (_event, profileId) => handlers.getGraphTopology(profileId));
  handleDesktopInvoke("notes:get-graph-concept-summaries", async (_event, indexes, sourceSnapshotId, profileId) =>
    handlers.getGraphConceptSummaries(indexes, sourceSnapshotId, profileId),
  );
  handleDesktopInvoke("notes:graph-concept-lookup", async (_event, reference, sourceSnapshotId, profileId) =>
    handlers.graphConceptLookup(reference, sourceSnapshotId, profileId),
  );
  handleDesktopInvoke("notes:get-graph-concept-detail-by-index", async (_event, index, sourceSnapshotId, profileId) =>
    handlers.getGraphConceptDetailByIndex(index, sourceSnapshotId, profileId),
  );
  handleDesktopInvoke("notes:resolve-target", async (_event, sourceFilePath, target) => handlers.resolveTarget(sourceFilePath, target));
  handleDesktopInvoke("notes:resolve-markdown-image", async (_event, sourceFilePath, target) =>
    handlers.resolveMarkdownImage(sourceFilePath, target),
  );
  handleDesktopInvoke("notes:ensure-target", async (_event, sourceFilePath, target) => handlers.ensureTarget(sourceFilePath, target));
  handleDesktopInvoke("notes:suggest-targets", async (_event, sourceFilePath, query) => handlers.suggestTargets(sourceFilePath, query));
  handleDesktopInvoke("shell:open-external", async (_event, target) => shell.openExternal(target));
  handleDesktopInvoke("shell:focus-window", async () => {
    const window = handlers.getMainWindow();
    window?.focus();
    window?.webContents.focus();
  });
}

function assertReviewAction(action: unknown): asserts action is "keep" | "reject" {
  if (action !== "keep" && action !== "reject") throw new Error("Invocation review action must be keep or reject.");
}

function assertRendererEditorDiagnostic(value: unknown): RendererEditorDiagnostic {
  if (!value || typeof value !== "object") throw new Error("Invalid renderer diagnostic.");
  const diagnostic = value as Partial<RendererEditorDiagnostic>;
  if (diagnostic.kind !== "editor-render-fault" || typeof diagnostic.occurredAt !== "string") {
    throw new Error("Invalid renderer diagnostic.");
  }
  if (diagnostic.notePath !== null && typeof diagnostic.notePath !== "string") throw new Error("Invalid renderer diagnostic path.");
  if (!(["markdown-live", "markdown-raw", "code", "empty"] as const).includes(diagnostic.mode as RendererEditorDiagnostic["mode"])) {
    throw new Error("Invalid renderer diagnostic mode.");
  }
  if (diagnostic.agentHandle !== null && typeof diagnostic.agentHandle !== "string") throw new Error("Invalid renderer diagnostic agent.");
  if (typeof diagnostic.errorSignature !== "string") throw new Error("Invalid renderer diagnostic signature.");
  const selection = diagnostic.selection;
  if (selection !== null && (!selection || !Number.isInteger(selection.anchor) || !Number.isInteger(selection.head))) {
    throw new Error("Invalid renderer diagnostic selection.");
  }
  return {
    kind: "editor-render-fault",
    occurredAt: diagnostic.occurredAt.slice(0, 40),
    notePath: diagnostic.notePath?.slice(0, 4096) ?? null,
    mode: diagnostic.mode as RendererEditorDiagnostic["mode"],
    selection: selection ?? null,
    agentHandle: diagnostic.agentHandle?.slice(0, 120) ?? null,
    errorSignature: diagnostic.errorSignature.slice(0, 160),
  };
}
