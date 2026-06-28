import type { ProfileSettingsCandidate, ProfileSettingsRow, ProfileSettingsSectionGroup } from "../profileSettingsModel";

export interface ProfileEditPanelProps {
  candidate: ProfileSettingsCandidate;
  disabledReason: string;
  onBack: () => void;
}

export interface ProfileEditPanelSection {
  id: string;
  label: string;
  description: string;
  rows: ProfileSettingsRow[];
}

export function ProfileEditPanel({ candidate, disabledReason, onBack }: ProfileEditPanelProps) {
  const sections = buildProfileEditPanelSections(candidate);

  return (
    <section className="profile-settings" data-testid="profile-edit-panel">
      <div className="profile-settings__summary" data-testid="profile-edit-panel-header">
        <div>
          <div className="dialog-field__label">Customize profile</div>
          <div className="profile-settings__active">{candidate.label}</div>
          <div className="profile-settings__muted">{candidate.description}</div>
        </div>
        <div className="profile-settings__actions" aria-label="Profile edit actions">
          <button className="toolbar-button" data-testid="profile-edit-back" onClick={onBack} type="button">
            Back
          </button>
          <button className="toolbar-button" data-testid="profile-edit-copy" disabled title={disabledReason} type="button">
            Copy
          </button>
          <button className="toolbar-button" data-testid="profile-edit-templatize" disabled title={disabledReason} type="button">
            Templatize
          </button>
          <button className="toolbar-button" data-testid="profile-edit-save-draft" disabled title={disabledReason} type="button">
            Save local draft
          </button>
        </div>
      </div>

      <div className="profile-settings__notice" data-testid="profile-edit-disabled-notice">
        <strong>Read-only customization preview.</strong>
        <span>{disabledReason}</span>
      </div>

      <div className="profile-settings__list" data-testid="profile-edit-sections">
        {sections.map((section) => (
          <ProfileEditPanelSectionView disabledReason={disabledReason} key={section.id} section={section} />
        ))}
      </div>
    </section>
  );
}

export function buildProfileEditPanelSections(candidate: ProfileSettingsCandidate): ProfileEditPanelSection[] {
  return [
    {
      id: "metadata",
      label: "Profile Metadata",
      description: "Identity, scope, and source details for this profile package.",
      rows: compactRows([
        row("Profile", candidate.label),
        row("ID", candidate.id),
        row("Profile ID", candidate.identity.profileId),
        row("Capability ID", candidate.identity.capabilityId),
        row("Status", candidate.isActive ? "Active" : candidate.statusLabel),
        row("Source", candidate.sourceLabel),
        row("Scope", candidate.identity.source ?? "unknown"),
        optionalRow("Plugin", candidate.pluginName),
        optionalRow("Manifest", candidate.manifestPath),
        optionalRow("Root", candidate.identity.rootDirectory),
      ]),
    },
    ...candidate.editSections.filter((section) => section.id !== "metadata").map(editSection),
  ];
}

function editSection(section: ProfileSettingsSectionGroup): ProfileEditPanelSection {
  return {
    ...section,
    rows: section.rows.length > 0 ? section.rows : [{ label: "Status", value: "No entries declared" }],
  };
}

function ProfileEditPanelSectionView({
  disabledReason,
  section,
}: {
  disabledReason: string;
  section: ProfileEditPanelSection;
}) {
  return (
    <fieldset className="profile-settings__candidate" data-testid={`profile-edit-section-${section.id}`} disabled title={disabledReason}>
      <legend className="dialog-field__label">{section.label}</legend>
      <div className="profile-settings__muted">{section.description}</div>
      <div className="profile-settings__grid">
        {section.rows.map((entry) => (
          <label className="profile-settings__metric" data-testid={`profile-edit-row-${section.id}-${testIdPart(entry.label)}`} key={`${entry.label}:${entry.value}`}>
            <span>{entry.label}</span>
            <input aria-label={entry.label} disabled readOnly title={disabledReason} type="text" value={entry.value} />
          </label>
        ))}
      </div>
    </fieldset>
  );
}

function compactRows(rows: Array<ProfileSettingsRow | null>): ProfileSettingsRow[] {
  return rows.filter((entry): entry is ProfileSettingsRow => Boolean(entry));
}

function row(label: string, value: string): ProfileSettingsRow {
  return { label, value };
}

function optionalRow(label: string, value: string | null | undefined): ProfileSettingsRow | null {
  return value ? row(label, value) : null;
}

function testIdPart(label: string): string {
  return label.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}
