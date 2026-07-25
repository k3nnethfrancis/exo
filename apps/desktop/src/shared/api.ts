import type { WorkspaceFilesystemApi } from "./api/workspace-filesystem";
import type { WorkspaceIndexApi } from "./api/workspace-index";
import type { WorkspaceInvocationApi } from "./api/invocation-commands";
import type { NotesGraphApi } from "./api/notes-graph";
import type { ShellApi } from "./api/shell";
import type { TerminalsApi } from "./api/terminal";
import type { WorkspaceSetupApi } from "./api/workspace-setup";

export type {
  AgentCommandContinuityStatus,
  AgentCommandLaunchFacts,
  AgentInvocationAuthorizationFacts,
  CliInstallationStatus,
  InvocationFileReviewPayload,
  InvocationHistoryItem,
  InvocationReviewListItem,
  LaunchAgentInvocationInput,
  LaunchAgentInvocationResponse,
  ProviderMcpSetupInput,
  ProviderMcpSetupResult,
  RendererEditorDiagnostic,
  TestAgentCommandInput,
} from "./api/invocation-commands";
export type { FileStatInfo, ResolvedMarkdownImage } from "./api/notes-graph";
export type {
  TerminalCreateOptions,
  TerminalDataEvent,
  TerminalGeometryRecord,
  TerminalHealthState,
  TerminalKind,
  TerminalLaunchKind,
  TerminalMessageResult,
  TerminalSessionInfo,
  TerminalWriteResult,
} from "./api/terminal";
export type {
  WorkspaceRegistryEntry,
  WorkspaceSettingsRuntimeApplyOutcome,
  WorkspaceSettingsSaveOutcome,
  WorkspaceSettingsSection,
  WorkspaceSetupState,
} from "./api/workspace-setup";
export type { IndexSyncStateEvent } from "./api/workspace-index";

/**
 * The renderer's single desktop bridge contract. Domain definitions remain
 * private to this directory; callers keep importing this stable aggregate seam.
 */
export interface DesktopApi {
  /** Present only in explicit test launches; absent from ordinary production. */
  test?: { graphHooks: true };
  workspace: WorkspaceSetupApi & WorkspaceIndexApi & WorkspaceFilesystemApi & WorkspaceInvocationApi;
  notes: NotesGraphApi;
  terminals: TerminalsApi;
  shell: ShellApi;
}
