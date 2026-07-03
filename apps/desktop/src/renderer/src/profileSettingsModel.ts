import type {
  ActiveProfileIdentity,
  PluginInventory,
  PluginInventoryItem,
  ProfilePlanAction,
  ProfilePlanPreview,
  ProfileStateStore,
} from "@exo/core";

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
  plan: ProfilePlanPreview | null;
  planLoadError: string | null;
  componentRows: ProfileSettingsRow[];
  recommendationRows: ProfileSettingsRow[];
  editSections: ProfileSettingsSectionGroup[];
}

export interface ProfilePreviewLoadEntry {
  plan: ProfilePlanPreview | null;
  error: string | null;
}

export interface ProfileSettingsRow {
  label: string;
  value: string;
}

export interface ProfileSettingsSectionGroup {
  id: string;
  label: string;
  description: string;
  rows: ProfileSettingsRow[];
}

export const PROFILE_SETTINGS_DISABLED_REASON =
  "Profile apply review, profile field editing, file writes, skill installs, routine scheduling, plugin enablement, templatize, and permission grants are not wired in this pass.";

export function buildProfileSettingsModel(
  inventory: PluginInventory | null,
  state: ProfileStateStore | null = null,
  profilePreviews: Record<string, ProfilePreviewLoadEntry> = {},
): ProfileSettingsModel {
  const detectedProfiles = inventory ? profileCandidatesFromInventory(inventory, state, profilePreviews) : [];
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

function profileCandidatesFromInventory(
  inventory: PluginInventory,
  state: ProfileStateStore | null,
  profilePreviews: Record<string, ProfilePreviewLoadEntry>,
): ProfileSettingsCandidate[] {
  return inventory.items
    .filter((item) => item.kind === "core:profile")
    .map((item) => profileCandidate(item, inventory, state, profilePreviews[item.id]))
    .sort((a, b) => {
      const aBaseline = a.id === "exograph-baseline.profile" || a.label === "Exograph Baseline";
      const bBaseline = b.id === "exograph-baseline.profile" || b.label === "Exograph Baseline";
      if (aBaseline !== bBaseline) {
        return aBaseline ? -1 : 1;
      }
      return a.label.localeCompare(b.label);
    });
}

function profileCandidate(
  item: PluginInventoryItem,
  inventory: PluginInventory,
  state: ProfileStateStore | null,
  previewEntry: ProfilePreviewLoadEntry | undefined,
): ProfileSettingsCandidate {
  const profile = readProfilePayload(item);
  const plan = previewEntry?.plan ?? null;
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
    planLoadError: previewEntry?.error ?? null,
    componentRows: profile ? componentRows(profile, plan, previewEntry) : [],
    recommendationRows: profile ? recommendationRows(profile, inventory, plan) : [],
    editSections: profile ? profileEditSections(profile, item, inventory, plan, previewEntry) : [],
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

// Keep this renderer model metadata-only. Core planning runs in main and arrives
// as serialized data so the browser bundle does not pull Node-only modules.
function readProfilePayload(item: PluginInventoryItem): Record<string, unknown> | null {
  const profile = item.compatibility?.profile;
  return isRecord(profile) ? profile : null;
}

function componentRows(
  profile: Record<string, unknown>,
  plan: ProfilePlanPreview | null,
  previewEntry: ProfilePreviewLoadEntry | undefined,
): ProfileSettingsRow[] {
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
      { label: "Preview actions", value: String(plan.summary.totalActions) },
      { label: "Apply mode", value: plan.apply.label },
      { label: "Warnings", value: String(plan.summary.warningCount) },
      { label: "Blockers", value: String(plan.summary.blockerCount) },
    );
  } else if (previewEntry?.error) {
    rows.unshift({ label: "Plan preview", value: `error: ${previewEntry.error}` });
  } else if (previewEntry) {
    rows.unshift({ label: "Plan preview", value: "loading" });
  }
  return rows;
}

function recommendationRows(
  profile: Record<string, unknown>,
  inventory: PluginInventory,
  plan: ProfilePlanPreview | null,
): ProfileSettingsRow[] {
  if (plan) {
    return plan.actions.flatMap((action) => {
      if (action.kind !== "pluginRecommendation") {
        return [];
      }
      const required = action.recommendation.required ? "required" : "optional";
      const reason = action.recommendation.reason ? ` · ${action.recommendation.reason}` : "";
      return [{ label: action.recommendation.id, value: `${action.pluginStatus} (${required})${reason}` }];
    });
  }
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

function profileEditSections(
  profile: Record<string, unknown>,
  item: PluginInventoryItem,
  inventory: PluginInventory,
  plan: ProfilePlanPreview | null,
  previewEntry: ProfilePreviewLoadEntry | undefined,
): ProfileSettingsSectionGroup[] {
  if (plan) {
    return profileEditSectionsFromPlan(profile, item, plan);
  }
  return [
    {
      id: "metadata",
      label: "Profile metadata",
      description: "Identity, source, and profile package references.",
      rows: [
        { label: "Capability id", value: item.id },
        { label: "Plugin", value: item.pluginName ?? item.pluginId ?? "none" },
        { label: "Source", value: uniqueLabels(item.distributionLabel, item.sourceLabel).join(" ") || "unknown" },
        { label: "Scope", value: "Workspace profile" },
      ],
    },
    {
      id: "recommendedPlugins",
      label: "Recommended plugins",
      description: "Capabilities this profile expects or benefits from.",
      rows: recommendationRows(profile, inventory, plan),
    },
    {
      id: "plan",
      label: "Backend plan preview",
      description: "Read-only plan state loaded from the main process.",
      rows: previewEntry?.error
        ? [{ label: "Plan preview", value: previewEntry.error }]
        : [{ label: "Plan preview", value: previewEntry ? "Loading" : "Not requested" }],
    },
    {
      id: "instructions",
      label: "Agent context and instructions",
      description: "Templates and config references that later apply flows can review.",
      rows: [
        ...namedRows("Context template", readRecordArray(profile.contextTemplates)),
        ...namedRows("Instruction template", readRecordArray(profile.instructionTemplates)),
        ...namedRows("MCP config template", readRecordArray(profile.mcpConfigTemplates)),
      ],
    },
    {
      id: "skills",
      label: "Skills and harness mappings",
      description: "Skill bundles the profile can recommend for configured harnesses.",
      rows: namedRows("Skill", readRecordArray(profile.skills)),
    },
    {
      id: "schemas",
      label: "Metadata and frontmatter schemas",
      description: "Advisory graph/property conventions for Markdown files.",
      rows: schemaRows(readRecordArray(profile.metadataSchemas)),
    },
    {
      id: "routines",
      label: "Routines and templates",
      description: "Routine template ids that can be instantiated later.",
      rows: readStringArray(profile.routineTemplateIds).map((id) => ({ label: "Routine template", value: id })),
    },
    {
      id: "graph",
      label: "Graph views and analyzers",
      description: "Graph visualization and analyzer defaults supplied by the profile.",
      rows: [
        ...namedRows("Graph view", readRecordArray(profile.graphViews)),
        ...namedRows("Analyzer", readRecordArray(profile.analyzerSettings)),
      ],
    },
    {
      id: "policies",
      label: "Review and output policies",
      description: "How future apply flows should stage file changes and artifacts.",
      rows: [
        ...policyRows("Review", profile.reviewPolicy),
        ...policyRows("Output", profile.outputPolicy),
      ],
    },
  ];
}

function profileEditSectionsFromPlan(
  profile: Record<string, unknown>,
  item: PluginInventoryItem,
  plan: ProfilePlanPreview,
): ProfileSettingsSectionGroup[] {
  return [
    {
      id: "metadata",
      label: "Profile metadata",
      description: "Identity, source, and profile package references.",
      rows: [
        { label: "Capability id", value: item.id },
        { label: "Profile id", value: plan.profile.id },
        { label: "Plugin", value: item.pluginName ?? item.pluginId ?? "none" },
        { label: "Source", value: uniqueLabels(item.distributionLabel, item.sourceLabel).join(" ") || "unknown" },
        { label: "Lifecycle", value: plan.profile.lifecycle },
      ],
    },
    {
      id: "planSummary",
      label: "Plan review",
      description: plan.apply.reason,
      rows: [
        { label: "Apply mode", value: plan.apply.label },
        { label: "Total actions", value: String(plan.summary.totalActions) },
        { label: "Ready plugins", value: String(plan.summary.readyPluginRecommendations) },
        { label: "Warnings", value: String(plan.summary.warningCount) },
        { label: "Blockers", value: String(plan.summary.blockerCount) },
        { label: "Would write files", value: String(plan.summary.wouldWriteCount) },
        { label: "Would install skills", value: String(plan.summary.wouldInstallSkillCount) },
        { label: "Would schedule routines", value: String(plan.summary.wouldScheduleRoutineCount) },
      ],
    },
    {
      id: "recommendedPlugins",
      label: "Recommended plugins",
      description: "Capabilities this profile expects or benefits from.",
      rows: rowsForActions(plan.actions, "pluginRecommendation"),
    },
    {
      id: "templates",
      label: "Templates and config refs",
      description: "Context, instruction, and MCP templates. Future apply flows would require explicit file-write review.",
      rows: [
        ...rowsForActions(plan.actions, "contextTemplate"),
        ...rowsForActions(plan.actions, "instructionTemplate"),
        ...rowsForActions(plan.actions, "mcpConfigTemplate"),
      ],
    },
    {
      id: "skills",
      label: "Skills and harness mappings",
      description: "Skill bundles the profile can recommend for configured harnesses.",
      rows: rowsForActions(plan.actions, "skill"),
    },
    {
      id: "schemas",
      label: "Metadata and frontmatter schemas",
      description: "Advisory graph/property conventions for Markdown files.",
      rows: rowsForActions(plan.actions, "metadataSchema"),
    },
    {
      id: "routines",
      label: "Routines and templates",
      description: "Routine template ids that can be instantiated later.",
      rows: rowsForActions(plan.actions, "routineTemplate"),
    },
    {
      id: "graph",
      label: "Graph views and analyzers",
      description: "Graph visualization and analyzer defaults supplied by the profile.",
      rows: [
        ...rowsForActions(plan.actions, "graphView"),
        ...rowsForActions(plan.actions, "analyzerSetting"),
      ],
    },
    {
      id: "policies",
      label: "Review and output policies",
      description: "How future apply flows should stage file changes and artifacts.",
      rows: [
        ...rowsForActions(plan.actions, "reviewPolicy"),
        ...rowsForActions(plan.actions, "outputPolicy"),
      ],
    },
    {
      id: "blockers",
      label: "Apply blockers and warnings",
      description: "Reasons this profile is review-only today.",
      rows: [
        ...plan.apply.blockedBy.map((blocker) => ({ label: blocker.kind, value: blocker.message })),
        ...plan.warnings.map((issue) => ({ label: `${issue.actionKind}: ${issue.actionId}`, value: issue.message })),
      ],
    },
  ].map((section) => ({
    ...section,
    rows: section.rows.length > 0 ? section.rows : [{ label: "Status", value: "No entries declared" }],
  }));
}

function rowsForActions(actions: ProfilePlanAction[], kind: ProfilePlanAction["kind"]): ProfileSettingsRow[] {
  return actions.filter((action) => action.kind === kind).map((action) => ({
    label: action.label || action.id,
    value: actionSummary(action),
  }));
}

function actionSummary(action: ProfilePlanAction): string {
  if (action.kind === "pluginRecommendation") {
    return `${action.pluginStatus}${action.required ? " · required" : " · optional"}`;
  }
  if (action.kind === "skill") {
    return `${action.skill.harnesses.join(", ") || "configured harnesses"}${action.required ? " · required" : ""}`;
  }
  if (action.kind === "contextTemplate" || action.kind === "instructionTemplate" || action.kind === "mcpConfigTemplate") {
    return [action.template.target, action.template.templatePath].filter(Boolean).join(" ← ") || action.template.id;
  }
  if (action.kind === "metadataSchema") {
    const fields = Object.keys(action.schema.frontmatter).join(", ");
    return [action.schema.scope.paths.join(", "), fields ? `fields: ${fields}` : ""].filter(Boolean).join(" · ") || "No scope declared";
  }
  if (action.kind === "routineTemplate") {
    return action.routineTemplateId;
  }
  if (action.kind === "graphView") {
    return `${action.graphView.pluginId}:${action.graphView.viewId}`;
  }
  if (action.kind === "analyzerSetting") {
    return Object.keys(action.analyzerSetting.settings).join(", ") || "Configured";
  }
  if (action.kind === "reviewPolicy") {
    return `file changes: ${action.reviewPolicy.fileChanges}; human review: ${action.reviewPolicy.requireHumanReview}`;
  }
  if (action.kind === "outputPolicy") {
    return `file changes: ${action.outputPolicy.fileChanges}`;
  }
  return action.id;
}

function namedRows(label: string, records: Array<Record<string, unknown>>): ProfileSettingsRow[] {
  return records.map((record, index) => ({
    label,
    value: optionalString(record, "label") ?? optionalString(record, "id") ?? optionalString(record, "path") ?? `${label} ${index + 1}`,
  }));
}

function schemaRows(records: Array<Record<string, unknown>>): ProfileSettingsRow[] {
  return records.map((record, index) => {
    const scope = isRecord(record.scope) ? readStringArray(record.scope.paths).join(", ") : "";
    const fields = isRecord(record.frontmatter) ? Object.keys(record.frontmatter).join(", ") : "";
    return {
      label: optionalString(record, "label") ?? optionalString(record, "id") ?? `Schema ${index + 1}`,
      value: [scope, fields ? `fields: ${fields}` : ""].filter(Boolean).join(" · ") || "No fields declared",
    };
  });
}

function policyRows(prefix: string, policy: unknown): ProfileSettingsRow[] {
  if (!isRecord(policy)) {
    return [];
  }
  return Object.entries(policy).map(([key, value]) => ({
    label: `${prefix}: ${key}`,
    value: Array.isArray(value) ? value.join(", ") : String(value),
  }));
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
    if (!trimmed) {
      return [];
    }
    const key = labelKey(trimmed);
    if (seen.has(key)) {
      return [];
    }
    seen.add(key);
    return [trimmed];
  });
}

function labelKey(label: string): string {
  return label.toLowerCase().replace(/\s+plugin$/, "");
}
