import type {
  OnboardingStateStore,
  OntologyKeepResult,
  OntologyRejectResult,
  OntologyReviewGuard,
  OntologyReviewState,
  WorkspaceModel,
  WorkspaceSettings,
  WorkspaceSettingsSaveRequest,
  WorkspaceSettingsSnapshot,
} from "@exo/core";
import type { WorkspaceContentInspection } from "@exo/core";

export type WorkspaceSettingsSection = "workspace" | "index" | "appearance" | "terminal" | "agents";

export interface WorkspaceSetupState {
  complete: boolean;
  onboardingComplete: boolean;
  onboarding: OnboardingStateStore;
  settingsPath: string;
}

export interface WorkspaceRegistryEntry {
  id: string;
  label: string;
  notesFolder: string;
  settings: WorkspaceSettings;
  updatedAt: string;
}

export type WorkspaceSettingsRuntimeApplyOutcome =
  | { status: "applied" }
  /** The Workspace committed, but a noncritical post-commit rebind needs attention. */
  | { status: "degraded"; errorMessage: string }
  | { status: "failed"; errorMessage: string };

export interface WorkspaceSettingsSaveOutcome extends WorkspaceSettingsSnapshot {
  runtimeApply: WorkspaceSettingsRuntimeApplyOutcome;
}

export interface WorkspaceSetupApi {
  getModel: () => Promise<WorkspaceModel>;
  getSettings: () => Promise<WorkspaceSettingsSnapshot>;
  getSetupState: () => Promise<WorkspaceSetupState>;
  markOnboardingComplete: () => Promise<OnboardingStateStore>;
  listWorkspaces: () => Promise<WorkspaceRegistryEntry[]>;
  activateWorkspace: (input: { workspaceId: string; expectedRevision: WorkspaceSettingsSaveRequest["expectedRevision"] }) => Promise<WorkspaceSettingsSaveOutcome>;
  saveSettings: (request: WorkspaceSettingsSaveRequest) => Promise<WorkspaceSettingsSaveOutcome>;
  selectFolder: (options?: { title?: string; allowMultiple?: boolean; buttonLabel?: string }) => Promise<string[]>;
  inspectContentScope: (rootPath: string) => Promise<WorkspaceContentInspection>;
  previewOntology: (sourcePath?: string | null) => Promise<OntologyReviewState>;
  keepOntology: (guard: OntologyReviewGuard) => Promise<OntologyKeepResult>;
  rejectOntology: (guard: OntologyReviewGuard) => Promise<OntologyRejectResult>;
  resolvePreviewTarget: (target: string) => Promise<{ url: string; source: "url" | "file" }>;
  onCommandOpenFile: (callback: (filePath: string) => void) => () => void;
  onCommandOpenSettings: (callback: (event: { section: WorkspaceSettingsSection }) => void) => () => void;
}
