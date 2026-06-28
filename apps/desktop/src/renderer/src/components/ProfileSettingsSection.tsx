import { useEffect, useMemo, useState } from "react";
import type { PluginInventory } from "@exo/core";

import {
  buildProfileSettingsModel,
  PROFILE_SETTINGS_DISABLED_REASON,
  type ProfileSettingsCandidate,
  type ProfileSettingsModel,
} from "../profileSettingsModel";

type ProfileInventoryLoadState = "loading" | "ready" | "error";

export function ProfileSettingsSection() {
  const [inventory, setInventory] = useState<PluginInventory | null>(null);
  const [loadState, setLoadState] = useState<ProfileInventoryLoadState>("loading");
  const [loadError, setLoadError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    window.exo.workspace.listPluginInventory()
      .then((nextInventory) => {
        if (cancelled) {
          return;
        }
        setInventory(nextInventory);
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

  const model = useMemo(() => buildProfileSettingsModel(inventory), [inventory]);

  return <ProfileSettingsContent loadError={loadError} loadState={loadState} model={model} />;
}

export function ProfileSettingsContent({
  loadError,
  loadState,
  model,
}: {
  loadError: string | null;
  loadState: ProfileInventoryLoadState;
  model: ProfileSettingsModel;
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
        </div>
        <div className="profile-settings__actions" aria-label="Disabled profile actions">
          <button className="toolbar-button" disabled title={PROFILE_SETTINGS_DISABLED_REASON} type="button">
            Review change
          </button>
          <button className="toolbar-button" disabled title={PROFILE_SETTINGS_DISABLED_REASON} type="button">
            Apply
          </button>
          <button className="toolbar-button" disabled title={PROFILE_SETTINGS_DISABLED_REASON} type="button">
            Copy
          </button>
        </div>
      </div>

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
          <ProfileCandidateDetails candidate={model.baselineCandidate} />
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
              <ProfileCandidateSummary candidate={candidate} key={candidate.id} />
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

function ProfileCandidateSummary({ candidate }: { candidate: ProfileSettingsCandidate }) {
  return (
    <div className="profile-settings__row">
      <div>
        <div className="profile-settings__row-title">{candidate.label}</div>
        <div className="profile-settings__muted">{candidate.description}</div>
      </div>
      <span className="profile-settings__pill">{candidate.statusLabel}</span>
    </div>
  );
}

function ProfileCandidateDetails({ candidate }: { candidate: ProfileSettingsCandidate }) {
  return (
    <div className="profile-settings__details">
      <div className="profile-settings__muted">{candidate.description}</div>
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
    </div>
  );
}
