import type { ProfileSettingsCandidate, ProfileSettingsRow, ProfileSettingsSectionGroup } from "../profileSettingsModel";

export interface ProfileEditPanelProps {
  candidate: ProfileSettingsCandidate;
  actionStatus: "idle" | "saving" | "saved" | "error";
  disabledReason: string;
  onBack: () => void;
  onCopy: () => void;
  onOpenAgentConfigEditor?: () => void;
  onOpenPluginManager?: () => void;
}

export interface ProfileEditPanelSection {
  id: string;
  label: string;
  description: string;
  rows: ProfileSettingsRow[];
}

export function ProfileEditPanel({
  actionStatus,
  candidate,
  disabledReason,
  onBack,
  onCopy,
  onOpenAgentConfigEditor,
  onOpenPluginManager,
}: ProfileEditPanelProps) {
  const sections = buildProfileEditPanelSections(candidate);
  const isSaving = actionStatus === "saving";

  return (
    <section className="profile-settings" data-testid="profile-edit-panel">
      <div className="profile-settings__summary" data-testid="profile-edit-panel-header">
        <div>
          <div className="dialog-field__label">Review profile package</div>
          <div className="profile-settings__active">{candidate.label}</div>
          <div className="profile-settings__muted">{candidate.description}</div>
        </div>
        <div className="profile-settings__actions" aria-label="Profile edit actions">
          <button className="toolbar-button" data-testid="profile-edit-back" onClick={onBack} type="button">
            Back
          </button>
          <button
            className="toolbar-button"
            data-testid="profile-edit-copy"
            disabled={isSaving}
            onClick={onCopy}
            title="Create a trusted workspace-local metadata profile copy and select it. This does not apply templates or write user content."
            type="button"
          >
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
        <strong>Profile package review.</strong>
        <span>Workspace profile naming and active selection are editable in Profile settings. Package fields below are review/proposal-only. {disabledReason}</span>
      </div>

      <div className="profile-settings__list" data-testid="profile-edit-sections">
        {sections.map((section) => (
          <ProfileEditPanelSectionView
            disabledReason={disabledReason}
            key={section.id}
            onOpenAgentConfigEditor={onOpenAgentConfigEditor}
            onOpenPluginManager={onOpenPluginManager}
            section={section}
          />
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
  onOpenAgentConfigEditor,
  onOpenPluginManager,
  section,
}: {
  disabledReason: string;
  onOpenAgentConfigEditor?: () => void;
  onOpenPluginManager?: () => void;
  section: ProfileEditPanelSection;
}) {
  const action = sectionAction(section, { onOpenAgentConfigEditor, onOpenPluginManager });
  return (
    <fieldset className="profile-settings__candidate" data-testid={`profile-edit-section-${section.id}`} title={action.enabled ? action.title : disabledReason}>
      <legend className="dialog-field__label">{section.label}</legend>
      <div className="profile-settings__muted">{section.description}</div>
      <div className="profile-settings__component-toolbar">
        <span>{action.detail}</span>
        <button
          className="toolbar-button"
          data-testid={`profile-edit-action-${section.id}`}
          disabled={!action.enabled}
          onClick={action.onClick}
          title={action.enabled ? action.title : disabledReason}
          type="button"
        >
          {action.label}
        </button>
      </div>
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

function sectionAction(
  section: ProfileEditPanelSection,
  handlers: {
    onOpenAgentConfigEditor?: () => void;
    onOpenPluginManager?: () => void;
  },
): {
  label: string;
  detail: string;
  title: string;
  enabled: boolean;
  onClick?: () => void;
} {
  if (section.id === "recommendedPlugins") {
    return {
      label: "Open Plugin Manager",
      detail: "Plugin trust, enablement, setup, and plugin-owned settings live in Plugin Manager.",
      title: "Open Plugin Manager for recommended plugin setup.",
      enabled: Boolean(handlers.onOpenPluginManager),
      onClick: handlers.onOpenPluginManager,
    };
  }
  if (section.id === "templates" || section.id === "skills") {
    return {
      label: "Open Agent Config",
      detail: "Agent instructions and skills use the specialized Agent Config Editor.",
      title: "Open Agent Config Editor for instruction files and skills.",
      enabled: Boolean(handlers.onOpenAgentConfigEditor),
      onClick: handlers.onOpenAgentConfigEditor,
    };
  }
  if (section.id === "metadata" || section.id === "planSummary" || section.id === "blockers") {
    return {
      label: "Review only",
      detail: "This section explains the active profile and planned effects.",
      title: "This section is read-only in the current profile pass.",
      enabled: false,
    };
  }
  return {
    label: "Edit later",
    detail: "Direct profile component editing waits for the staged profile apply and permission model.",
    title: "Direct editing is not wired in this pass.",
    enabled: false,
  };
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
