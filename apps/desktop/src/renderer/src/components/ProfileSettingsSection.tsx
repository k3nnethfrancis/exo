import { useEffect, useMemo, useState } from "react";
import type { PluginInventory, ProfileStateStore } from "@exo/core";

import {
  buildProfileSettingsModel,
  PROFILE_SETTINGS_DISABLED_REASON,
  type ProfilePreviewLoadEntry,
  type ProfileSettingsCandidate,
  type ProfileSettingsModel,
} from "../profileSettingsModel";
import { ProfileEditPanel } from "./ProfileEditPanel";

type ProfileInventoryLoadState = "loading" | "ready" | "error";

export function ProfileSettingsSection({
  onOpenAgentConfigEditor,
  onOpenPluginManager,
}: {
  onOpenAgentConfigEditor?: () => void;
  onOpenPluginManager?: () => void;
} = {}) {
  const [inventory, setInventory] = useState<PluginInventory | null>(null);
  const [profileState, setProfileState] = useState<ProfileStateStore | null>(null);
  const [loadState, setLoadState] = useState<ProfileInventoryLoadState>("loading");
  const [loadError, setLoadError] = useState<string | null>(null);
  const [actionStatus, setActionStatus] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const [actionError, setActionError] = useState<string | null>(null);
  const [actionMessage, setActionMessage] = useState<string | null>(null);
  const [editingCandidate, setEditingCandidate] = useState<ProfileSettingsCandidate | null>(null);
  const [profilePreviews, setProfilePreviews] = useState<Record<string, ProfilePreviewLoadEntry>>({});

  useEffect(() => {
    let cancelled = false;
    loadWorkspaceProfileData()
      .then(({ inventory: nextInventory, profileState: nextProfileState, previews }) => {
        if (cancelled) {
          return;
        }
        setInventory(nextInventory);
        setProfileState(nextProfileState);
        setProfilePreviews(previews);
        setLoadState("ready");
      })
      .catch((error) => {
        if (cancelled) {
          return;
        }
        setLoadError(error instanceof Error ? error.message : "Unable to load plugin inventory.");
        setLoadState("error");
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const model = useMemo(() => buildProfileSettingsModel(inventory, profileState, profilePreviews), [inventory, profileState, profilePreviews]);
  const editableCandidate = model.detectedProfiles.find((candidate) => candidate.isActive) ?? model.baselineCandidate;

  if (editingCandidate) {
    return (
      <ProfileEditPanel
        actionStatus={actionStatus}
        candidate={editingCandidate}
        disabledReason={PROFILE_SETTINGS_DISABLED_REASON}
        onBack={() => setEditingCandidate(null)}
        onCopy={() => void copyProfile(editingCandidate)}
        onOpenAgentConfigEditor={onOpenAgentConfigEditor}
        onOpenPluginManager={onOpenPluginManager}
      />
    );
  }

  async function runProfileAction(action: () => Promise<ProfileStateStore>) {
    setActionStatus("saving");
    setActionError(null);
    setActionMessage(null);
    try {
      const nextState = await action();
      setProfileState(nextState);
      announceProfileStateChanged(nextState);
      setActionMessage("Profile state saved.");
      setActionStatus("saved");
    } catch (error) {
      setActionError(error instanceof Error ? error.message : "Unable to update profile state.");
      setActionStatus("error");
    }
  }

  async function copyProfile(candidate: ProfileSettingsCandidate) {
    setActionStatus("saving");
    setActionError(null);
    setActionMessage(null);
    try {
      const result = await window.exo.workspace.copyProfile(candidate.identity);
      setInventory(result.inventory);
      setProfileState(result.profileState);
      setProfilePreviews(await loadProfilePreviews(result.inventory, result.profileState));
      announceProfileStateChanged(result.profileState);
      setEditingCandidate(null);
      setActionMessage("Profile copied.");
      setActionStatus("saved");
    } catch (error) {
      setActionError(error instanceof Error ? error.message : "Unable to copy profile.");
      setActionStatus("error");
    }
  }

  async function stageProfileApply(candidate: ProfileSettingsCandidate) {
    setActionStatus("saving");
    setActionError(null);
    setActionMessage(null);
    try {
      const proposal = await window.exo.workspace.createProfileApplyProposal(candidate.identity);
      setActionMessage(proposal ? "Profile apply proposal staged for review." : "Profile templates already match the workspace.");
      window.dispatchEvent(new Event("exo:proposals-changed"));
      setActionStatus("saved");
    } catch (error) {
      setActionError(error instanceof Error ? error.message : "Unable to stage profile apply proposal.");
      setActionStatus("error");
    }
  }

  return (
    <ProfileSettingsContent
      actionError={actionError}
      actionMessage={actionMessage}
      actionStatus={actionStatus}
      loadError={loadError}
      loadState={loadState}
      model={model}
      onClearActive={() => void runProfileAction(() => window.exo.workspace.clearActiveProfile())}
      onSetActive={(candidate) => void runProfileAction(() => window.exo.workspace.setActiveProfile(candidate.identity))}
      onCustomize={editableCandidate ? () => setEditingCandidate(editableCandidate) : null}
      onReview={editableCandidate ? () => setEditingCandidate(editableCandidate) : null}
      onCopy={editableCandidate ? () => void copyProfile(editableCandidate) : null}
      onStageApply={editableCandidate?.applyGate.canStageFileTemplates ? () => void stageProfileApply(editableCandidate) : null}
      onToggleAutoUpdate={(autoUpdate) => void runProfileAction(() => window.exo.workspace.setProfileAutoUpdate({ autoUpdate }))}
    />
  );
}

async function loadWorkspaceProfileData(): Promise<{
  inventory: PluginInventory;
  profileState: ProfileStateStore;
  previews: Record<string, ProfilePreviewLoadEntry>;
}> {
  const [inventory, profileState] = await Promise.all([
    window.exo.workspace.listPluginInventory(),
    window.exo.workspace.getProfileState(),
  ]);
  return {
    inventory,
    profileState,
    previews: await loadProfilePreviews(inventory, profileState),
  };
}

async function loadProfilePreviews(
  inventory: PluginInventory,
  profileState: ProfileStateStore,
): Promise<Record<string, ProfilePreviewLoadEntry>> {
  const candidates = buildProfileSettingsModel(inventory, profileState).detectedProfiles;
  const entries = await Promise.all(candidates.map(async (candidate): Promise<[string, ProfilePreviewLoadEntry]> => {
    try {
      return [candidate.id, { plan: await window.exo.workspace.previewProfile(candidate.identity), error: null }];
    } catch (error) {
      return [candidate.id, { plan: null, error: error instanceof Error ? error.message : "Unable to preview profile." }];
    }
  }));
  return Object.fromEntries(entries);
}

function announceProfileStateChanged(profileState: ProfileStateStore): void {
  window.dispatchEvent(new CustomEvent("exo:profile-state-changed", { detail: profileState }));
}

export function ProfileSettingsContent({
  actionError,
  actionMessage,
  actionStatus,
  loadError,
  loadState,
  model,
  onClearActive,
  onCopy,
  onCustomize,
  onReview,
  onSetActive,
  onStageApply,
  onToggleAutoUpdate,
}: {
  actionError: string | null;
  actionMessage: string | null;
  actionStatus: "idle" | "saving" | "saved" | "error";
  loadError: string | null;
  loadState: ProfileInventoryLoadState;
  model: ProfileSettingsModel;
  onClearActive: () => void;
  onCopy: (() => void) | null;
  onCustomize: (() => void) | null;
  onReview: (() => void) | null;
  onSetActive: (candidate: ProfileSettingsCandidate) => void;
  onStageApply: (() => void) | null;
  onToggleAutoUpdate: (autoUpdate: boolean) => void;
}) {
  return (
    <section className="profile-settings" data-testid="workspace-settings-profile">
      <div className="profile-settings__notice">
        <strong>Read-only profile preview.</strong>
        <span>{PROFILE_SETTINGS_DISABLED_REASON}</span>
      </div>

      <div className="profile-settings__summary">
        <div>
          <div className="dialog-field__label">Active profile</div>
          <div className="profile-settings__active">{model.activeProfileLabel}</div>
          <div className="profile-settings__muted">{model.activeProfileDetail}</div>
          {model.updatedAt ? <div className="profile-settings__muted">Updated {new Date(model.updatedAt).toLocaleString()}</div> : null}
        </div>
        <div className="profile-settings__actions" aria-label="Profile actions">
          <button className="toolbar-button" disabled={!onReview} onClick={() => onReview?.()} type="button">
            Review change
          </button>
          <button className="toolbar-button" disabled={!model.activeProfile || actionStatus === "saving"} onClick={onClearActive} type="button">
            Clear active
          </button>
          <button className="toolbar-button" disabled={!onCustomize} onClick={() => onCustomize?.()} type="button">
            Customize
          </button>
          <button
            className="toolbar-button"
            disabled={!onStageApply || actionStatus === "saving"}
            onClick={() => onStageApply?.()}
            title={editableApplyGateTitle(model)}
            type="button"
          >
            {editableApplyGate(model).label}
          </button>
          <button
            className="toolbar-button"
            disabled={!onCopy || actionStatus === "saving"}
            onClick={() => onCopy?.()}
            title="Create a trusted workspace-local metadata profile copy and select it. This does not apply templates or write user content."
            type="button"
          >
            Copy
          </button>
        </div>
      </div>

      <label className="profile-settings__toggle">
        <input
          checked={model.autoUpdate}
          disabled={actionStatus === "saving"}
          onChange={(event) => onToggleAutoUpdate(event.target.checked)}
          type="checkbox"
        />
        <span>
          <strong>Auto-update profile metadata on safe state changes</strong>
          <small>Records profile drift and config-linked changes only. It does not write instruction files, install skills, grant permissions, or schedule routines.</small>
        </span>
      </label>
      {model.reviewRequired ? <div className="dialog-card__status">Profile review required before future apply actions.</div> : null}
      {actionStatus === "saving" ? <div className="dialog-card__status">Saving profile state...</div> : null}
      {actionStatus === "saved" ? <div className="dialog-card__status">{actionMessage ?? "Profile state saved."}</div> : null}
      {actionStatus === "error" ? <div className="dialog-card__status dialog-card__status--error">{actionError ?? "Unable to update profile state."}</div> : null}

      {loadState === "loading" ? <div className="dialog-card__status">Loading plugin inventory...</div> : null}
      {loadState === "error" ? <div className="dialog-card__status dialog-card__status--error">{loadError ?? "Unable to load plugin inventory."}</div> : null}

      <div className="profile-settings__candidate" data-testid="workspace-settings-profile-baseline">
        <div className="profile-settings__candidate-header">
          <div>
            <div className="dialog-field__label">Baseline/profile candidate</div>
            <div className="profile-settings__candidate-title">{model.baselineCandidate?.label ?? "Exograph Baseline"}</div>
          </div>
          <span className="profile-settings__pill">{model.baselineCandidate?.statusLabel ?? "Not detected"}</span>
        </div>
        {model.baselineCandidate ? (
          <ProfileCandidateDetails actionStatus={actionStatus} candidate={model.baselineCandidate} onSetActive={onSetActive} />
        ) : (
          <div className="profile-settings__muted">
            Exograph Baseline is expected as a bundled metadata-only profile. It was not present in the loaded inventory.
          </div>
        )}
      </div>

      <div className="profile-settings__detected">
        <div className="dialog-field__label">Detected profile capabilities</div>
        {model.detectedProfiles.length > 0 ? (
          <div className="profile-settings__list">
            {model.detectedProfiles.map((candidate) => (
              <ProfileCandidateSummary actionStatus={actionStatus} candidate={candidate} key={candidate.id} onSetActive={onSetActive} />
            ))}
          </div>
        ) : (
          <div className="profile-settings__muted">No profile capabilities were detected in plugin inventory.</div>
        )}
      </div>

      {model.inventoryErrors.length > 0 ? (
        <div className="profile-settings__errors">
          <div className="dialog-field__label">Inventory warnings</div>
          {model.inventoryErrors.map((error) => (
            <div className="profile-settings__muted" key={error}>{error}</div>
          ))}
        </div>
      ) : null}
    </section>
  );
}

function editableApplyGateTitle(model: ProfileSettingsModel): string {
  return editableApplyGate(model).reason;
}

function editableApplyGate(model: ProfileSettingsModel) {
  const editableCandidate = model.detectedProfiles.find((candidate) => candidate.isActive) ?? model.baselineCandidate;
  return editableCandidate?.applyGate ?? {
    canStageFileTemplates: false,
    label: "Stage file proposals",
    reason: PROFILE_SETTINGS_DISABLED_REASON,
  };
}

function ProfileCandidateSummary({
  actionStatus,
  candidate,
  onSetActive,
}: {
  actionStatus: "idle" | "saving" | "saved" | "error";
  candidate: ProfileSettingsCandidate;
  onSetActive: (candidate: ProfileSettingsCandidate) => void;
}) {
  return (
    <div className="profile-settings__row">
      <div>
        <div className="profile-settings__row-title">{candidate.label}</div>
        <div className="profile-settings__muted">{candidate.description}</div>
      </div>
      <div className="profile-settings__row-actions">
        <span className="profile-settings__pill">{candidate.isActive ? "Active" : candidate.statusLabel}</span>
        <button className="toolbar-button" disabled={candidate.isActive || actionStatus === "saving"} onClick={() => onSetActive(candidate)} type="button">
          {candidate.isActive ? "Selected" : "Set active"}
        </button>
      </div>
    </div>
  );
}

function ProfileCandidateDetails({
  actionStatus,
  candidate,
  onSetActive,
}: {
  actionStatus: "idle" | "saving" | "saved" | "error";
  candidate: ProfileSettingsCandidate;
  onSetActive: (candidate: ProfileSettingsCandidate) => void;
}) {
  return (
    <div className="profile-settings__details">
      <div className="profile-settings__muted">{candidate.description}</div>
      <div className="profile-settings__candidate-actions">
        <button className="toolbar-button" disabled={candidate.isActive || actionStatus === "saving"} onClick={() => onSetActive(candidate)} type="button">
          {candidate.isActive ? "Active profile" : "Set active profile"}
        </button>
      </div>
      <div className="profile-settings__meta">
        <span>{candidate.sourceLabel}</span>
        {candidate.pluginName ? <span>{candidate.pluginName}</span> : null}
        {candidate.manifestPath ? <span title={candidate.manifestPath}>{candidate.manifestPath}</span> : null}
      </div>
      <div className="profile-settings__grid">
        {candidate.componentRows.map((row) => (
          <div className="profile-settings__metric" key={`${row.label}:${row.value}`}>
            <span>{row.label}</span>
            <strong>{row.value}</strong>
          </div>
        ))}
      </div>
      {candidate.recommendationRows.length > 0 ? (
        <div className="profile-settings__recommendations">
          <div className="dialog-field__label">Recommended plugins</div>
          {candidate.recommendationRows.map((row) => (
            <div className="profile-settings__recommendation" key={row.label}>
              <span>{row.label}</span>
              <span>{row.value}</span>
            </div>
          ))}
        </div>
      ) : null}
      {candidate.applyPromptRows.length > 0 ? (
        <div className="profile-settings__recommendations">
          <div className="dialog-field__label">Future apply prompts</div>
          {candidate.applyPromptRows.map((row) => (
            <div className="profile-settings__recommendation" key={row.label}>
              <span>{row.label}</span>
              <span>{row.value}</span>
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}
