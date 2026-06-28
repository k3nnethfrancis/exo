import type { ActiveProfileIdentity, PluginInventory, PluginInventoryItem, ProfileStateStore } from "@exo/core";

export interface ProfileSettingsModel {
  activeProfileLabel: string;
  activeProfileDetail: string;
  activeProfile: ActiveProfileIdentity | null;
  autoUpdate: boolean;
  reviewRequired: boolean;
  updatedAt: string | null;
  baselineCandidate: ProfileSettingsCandidate | null;
  detectedProfiles: ProfileSettingsCandidate[];
  inventoryErrors: string[];
}

export interface ProfileSettingsCandidate {
  id: string;
  label: string;
  description: string;
  sourceLabel: string;
  statusLabel: string;
  manifestPath: string | null;
  pluginName: string | null;
  identity: ActiveProfileIdentity;
  isActive: boolean;
  plan: ProfileSettingsPlanPreview | null;
  componentRows: ProfileSettingsRow[];
  recommendationRows: ProfileSettingsRow[];
}

export interface ProfileSettingsPlanPreview {
  apply: {
    available: false;
    label: "Review only";
  };
  totalActions: number;
}

export interface ProfileSettingsRow {
  label: string;
  value: string;
}

export const PROFILE_SETTINGS_DISABLED_REASON =
  "Profile apply review, copy/customize, file writes, skill installs, routine scheduling, plugin enablement, and permission grants are not wired in this UI pass.";

export function buildProfileSettingsModel(inventory: PluginInventory | null, state: ProfileStateStore | null = null): ProfileSettingsModel {
  const detectedProfiles = inventory ? profileCandidatesFromInventory(inventory, state) : [];
  const baselineCandidate = detectedProfiles.find((candidate) => candidate.id === "exograph-baseline.profile" || candidate.label === "Exograph Baseline") ?? null;
  const activeCandidate = detectedProfiles.find((candidate) => candidate.isActive) ?? null;
  const activeProfile = state?.activeProfile ?? null;
  return {
    activeProfile,
    activeProfileLabel: activeCandidate?.label ?? activeProfile?.profileId ?? "No active profile",
    activeProfileDetail: activeCandidate
      ? `${activeCandidate.sourceLabel}; ${activeCandidate.statusLabel}`
      : activeProfile
        ? "The saved profile is not currently present in plugin inventory."
        : "Choose a detected profile to record it as this workspace's active profile. This does not write files or apply templates.",
    autoUpdate: state?.autoUpdate ?? false,
    reviewRequired: state?.reviewRequired ?? false,
    updatedAt: state?.updatedAt ?? null,
    baselineCandidate,
    detectedProfiles,
    inventoryErrors: inventory?.errors.map((error) => `${error.directory}: ${error.message}`) ?? [],
  };
}

function profileCandidatesFromInventory(inventory: PluginInventory, state: ProfileStateStore | null): ProfileSettingsCandidate[] {
  return inventory.items
    .filter((item) => item.kind === "profile")
    .map((item) => profileCandidate(item, inventory, state))
    .sort((a, b) => {
      const aBaseline = a.id === "exograph-baseline.profile" || a.label === "Exograph Baseline";
      const bBaseline = b.id === "exograph-baseline.profile" || b.label === "Exograph Baseline";
      if (aBaseline !== bBaseline) {
        return aBaseline ? -1 : 1;
      }
      return a.label.localeCompare(b.label);
    });
}

function profileCandidate(item: PluginInventoryItem, inventory: PluginInventory, state: ProfileStateStore | null): ProfileSettingsCandidate {
  const profile = readProfilePayload(item);
  const plan = profile ? profilePlanPreview(profile) : null;
  const identity = profileIdentity(item, profile);
  return {
    id: item.id,
    label: optionalString(profile, "label") ?? item.label,
    description: optionalString(profile, "description") ?? item.description,
    sourceLabel: uniqueLabels(item.distributionLabel, item.sourceLabel).join(" "),
    statusLabel: profileStatusLabel(item),
    manifestPath: item.manifestPath ?? null,
    pluginName: item.pluginName ?? item.pluginId ?? null,
    identity,
    isActive: activeProfileMatches(state?.activeProfile ?? null, identity),
    plan,
    componentRows: profile ? componentRows(profile, plan) : [],
    recommendationRows: profile ? recommendationRows(profile, inventory) : [],
  };
}

function profileIdentity(item: PluginInventoryItem, profile: Record<string, unknown> | null): ActiveProfileIdentity {
  return {
    profileId: optionalString(profile, "id") ?? item.id,
    capabilityId: item.id,
    pluginId: item.pluginId,
    source: item.pluginSource,
    manifestPath: item.manifestPath,
    rootDirectory: item.rootDirectory,
  };
}

function activeProfileMatches(active: ActiveProfileIdentity | null, identity: ActiveProfileIdentity): boolean {
  if (!active) {
    return false;
  }
  return active.capabilityId === identity.capabilityId
    && active.profileId === identity.profileId
    && optionalCompare(active.pluginId, identity.pluginId)
    && optionalCompare(active.source, identity.source)
    && optionalCompare(active.manifestPath, identity.manifestPath)
    && optionalCompare(active.rootDirectory, identity.rootDirectory);
}

function optionalCompare(left: string | undefined, right: string | undefined): boolean {
  return !left || !right || left === right;
}

// Keep this renderer model metadata-only. Importing core profile planning functions pulls
// Node-only modules into the browser bundle through @exo/core.
function readProfilePayload(item: PluginInventoryItem): Record<string, unknown> | null {
  const profile = item.compatibility?.profile;
  return isRecord(profile) ? profile : null;
}

function profilePlanPreview(profile: Record<string, unknown>): ProfileSettingsPlanPreview {
  return {
    apply: {
      available: false,
      label: "Review only",
    },
    totalActions: readRecordArray(profile.recommendedPlugins).length
      + readRecordArray(profile.contextTemplates).length
      + readRecordArray(profile.instructionTemplates).length
      + readRecordArray(profile.mcpConfigTemplates).length
      + readRecordArray(profile.skills).length
      + readStringArray(profile.routineTemplateIds).length,
  };
}

function componentRows(profile: Record<string, unknown>, plan: ProfileSettingsPlanPreview | null): ProfileSettingsRow[] {
  const rows = [
    row("Recommended plugins", readRecordArray(profile.recommendedPlugins).length),
    row("Metadata schemas", readRecordArray(profile.metadataSchemas).length),
    row("Context templates", readRecordArray(profile.contextTemplates).length),
    row("Instruction templates", readRecordArray(profile.instructionTemplates).length),
    row("MCP config templates", readRecordArray(profile.mcpConfigTemplates).length),
    row("Skills", readRecordArray(profile.skills).length),
    row("Routine templates", readStringArray(profile.routineTemplateIds).length),
    row("Graph views", readRecordArray(profile.graphViews).length),
    row("Analyzer settings", readRecordArray(profile.analyzerSettings).length),
    { label: "Review policy", value: policyValue(profile.reviewPolicy, "fileChanges") },
    { label: "Output policy", value: policyValue(profile.outputPolicy, "fileChanges") },
  ];
  if (plan) {
    rows.unshift(
      { label: "Preview actions", value: String(plan.totalActions) },
      { label: "Apply mode", value: plan.apply.label },
    );
  }
  return rows;
}

function recommendationRows(profile: Record<string, unknown>, inventory: PluginInventory): ProfileSettingsRow[] {
  return readRecordArray(profile.recommendedPlugins).map((recommendation) => {
    const id = optionalString(recommendation, "id") ?? "unknown";
    const required = recommendation.required === true;
    const inventoryItem = inventory.items.find((item) => item.id === id || item.pluginId === id);
    const status = inventoryItem
      ? inventoryItem.enabled && inventoryItem.trust === "trusted"
        ? "ready"
        : inventoryItem.statusLabel
      : "unavailable";
    return { label: id, value: `${status}${required ? " (required)" : " (optional)"}` };
  });
}

function row(label: string, count: number): ProfileSettingsRow {
  return { label, value: String(count) };
}

function profileStatusLabel(item: PluginInventoryItem): string {
  if (item.trust === "untrusted") {
    return `${item.statusLabel}; review needed`;
  }
  if (!item.enabled) {
    return `${item.statusLabel}; disabled`;
  }
  return item.statusLabel;
}

function policyValue(value: unknown, key: string): string {
  return isRecord(value) ? optionalString(value, key) ?? "configured" : "none";
}

function readRecordArray(value: unknown): Array<Record<string, unknown>> {
  return Array.isArray(value) ? value.filter(isRecord) : [];
}

function readStringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === "string") : [];
}

function optionalString(record: Record<string, unknown> | null, key: string): string | undefined {
  const value = record?.[key];
  return typeof value === "string" && value.trim().length > 0 ? value : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function uniqueLabels(...labels: Array<string | null | undefined>): string[] {
  const seen = new Set<string>();
  return labels.flatMap((label) => {
    const trimmed = label?.trim();
    if (!trimmed || seen.has(trimmed.toLowerCase())) {
      return [];
    }
    seen.add(trimmed.toLowerCase());
    return [trimmed];
  });
}
