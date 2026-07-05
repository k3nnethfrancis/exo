import type { PluginInventory, PluginInventoryItem } from "./plugin-inventory";
import type {
  ProfileAnalyzerSetting,
  ProfileDefinition,
  ProfileGraphViewReference,
  ProfileMetadataSchema,
  ProfilePluginRecommendation,
  ProfileReviewPolicy,
  ProfileSkillReference,
  ProfileTemplateReference,
} from "./profile";
import type { RoutineOutputPolicy } from "./routine";

export type ProfilePlanActionKind =
  | "pluginRecommendation"
  | "metadataSchema"
  | "contextTemplate"
  | "instructionTemplate"
  | "mcpConfigTemplate"
  | "skill"
  | "routineTemplate"
  | "graphView"
  | "analyzerSetting"
  | "reviewPolicy"
  | "outputPolicy";

export type ProfilePluginRecommendationStatus = "ready" | "missing" | "disabled" | "untrusted" | "unavailable";
export type ProfilePlanSeverity = "info" | "warning" | "blocker";

export interface ProfilePlanPreview {
  mode: "preview";
  writeCapable: false;
  apply: ProfilePlanApplyState;
  profile: {
    id: string;
    label: string;
    lifecycle: ProfileDefinition["lifecycle"];
  };
  summary: ProfilePlanSummary;
  actions: ProfilePlanAction[];
  blockers: ProfilePlanIssue[];
  warnings: ProfilePlanIssue[];
  safety: ProfilePlanSafety;
}

export interface ProfilePlanApplyState {
  available: false;
  label: "Review only";
  reason: string;
  blockedBy: ProfilePlanApplyBlocker[];
  promptSteps: ProfilePlanApplyPromptStep[];
}

export type ProfilePlanApplyBlockerKind =
  | "permissionModel"
  | "pluginTrust"
  | "pluginEnable"
  | "pluginSettings"
  | "fileWrite"
  | "skillInstall"
  | "routineScheduling"
  | "mcpConfig";

export interface ProfilePlanApplyBlocker {
  kind: ProfilePlanApplyBlockerKind;
  message: string;
  actionIds: string[];
}

export type ProfilePlanApplyPromptKind =
  | "pluginTrustReview"
  | "pluginEnableReview"
  | "permissionGrantReview"
  | "pluginSettingsReview"
  | "fileWriteReview"
  | "skillInstallReview"
  | "routineInstantiationReview"
  | "mcpConfigReview";

export interface ProfilePlanApplyPromptStep {
  kind: ProfilePlanApplyPromptKind;
  label: string;
  detail: string;
  actionIds: string[];
  enabled: false;
  required: boolean;
}

export interface ProfilePlanSummary {
  totalActions: number;
  readyPluginRecommendations: number;
  warningCount: number;
  blockerCount: number;
  wouldWriteCount: number;
  wouldInstallSkillCount: number;
  wouldScheduleRoutineCount: number;
}

export interface ProfilePlanSafety {
  writesEnabled: false;
  pluginEnableEnabled: false;
  skillInstallEnabled: false;
  routineSchedulingEnabled: false;
  mcpConfigMutationEnabled: false;
}

export type ProfilePlanAction =
  | ProfilePluginRecommendationAction
  | ProfileMetadataSchemaAction
  | ProfileTemplateAction
  | ProfileSkillAction
  | ProfileRoutineTemplateAction
  | ProfileGraphViewAction
  | ProfileAnalyzerSettingAction
  | ProfileReviewPolicyAction
  | ProfileOutputPolicyAction;

export interface ProfilePlanActionBase {
  kind: ProfilePlanActionKind;
  id: string;
  label: string;
  severity: ProfilePlanSeverity;
  required?: boolean;
  effect: ProfilePlanEffect;
}

export interface ProfilePlanEffect {
  previewOnly: true;
  mutates: false;
  wouldWrite?: string;
  wouldEnablePlugin?: string;
  wouldInstallSkills?: string;
  wouldScheduleRoutines?: string;
  wouldMutateMcpConfig?: string;
}

export interface ProfilePluginRecommendationAction extends ProfilePlanActionBase {
  kind: "pluginRecommendation";
  recommendation: ProfilePluginRecommendation;
  pluginStatus: ProfilePluginRecommendationStatus;
  inventoryItem?: ProfilePlanInventoryReference;
}

export interface ProfileMetadataSchemaAction extends ProfilePlanActionBase {
  kind: "metadataSchema";
  schema: ProfileMetadataSchema;
}

export interface ProfileTemplateAction extends ProfilePlanActionBase {
  kind: "contextTemplate" | "instructionTemplate" | "mcpConfigTemplate";
  template: ProfileTemplateReference;
}

export interface ProfileSkillAction extends ProfilePlanActionBase {
  kind: "skill";
  skill: ProfileSkillReference;
}

export interface ProfileRoutineTemplateAction extends ProfilePlanActionBase {
  kind: "routineTemplate";
  routineTemplateId: string;
}

export interface ProfileGraphViewAction extends ProfilePlanActionBase {
  kind: "graphView";
  graphView: ProfileGraphViewReference;
}

export interface ProfileAnalyzerSettingAction extends ProfilePlanActionBase {
  kind: "analyzerSetting";
  analyzerSetting: ProfileAnalyzerSetting;
}

export interface ProfileReviewPolicyAction extends ProfilePlanActionBase {
  kind: "reviewPolicy";
  reviewPolicy: ProfileReviewPolicy;
}

export interface ProfileOutputPolicyAction extends ProfilePlanActionBase {
  kind: "outputPolicy";
  outputPolicy: RoutineOutputPolicy;
}

export interface ProfilePlanInventoryReference {
  id: string;
  label: string;
  status: string;
  statusLabel: string;
  enabled: boolean;
  trust: PluginInventoryItem["trust"];
  pluginId?: string;
  pluginName?: string;
  requestedPermissions: string[];
  grantedPermissions: string[];
  missingPermissions: string[];
  settingsReviewRequired: boolean;
}

export interface ProfilePlanIssue {
  severity: Exclude<ProfilePlanSeverity, "info">;
  actionKind: ProfilePlanActionKind;
  actionId: string;
  message: string;
}

export function planProfilePreview(profile: ProfileDefinition, inventory: PluginInventory): ProfilePlanPreview {
  const actions: ProfilePlanAction[] = [
    ...profile.recommendedPlugins.map((recommendation) => pluginRecommendationAction(recommendation, inventory)),
    ...profile.metadataSchemas.map(metadataSchemaAction),
    ...profile.contextTemplates.map((template) => templateAction("contextTemplate", template)),
    ...profile.instructionTemplates.map((template) => templateAction("instructionTemplate", template)),
    ...profile.mcpConfigTemplates.map((template) => templateAction("mcpConfigTemplate", template)),
    ...profile.skills.map(skillAction),
    ...profile.routineTemplateIds.map(routineTemplateAction),
    ...profile.graphViews.map(graphViewAction),
    ...profile.analyzerSettings.map(analyzerSettingAction),
    ...(profile.reviewPolicy ? [reviewPolicyAction(profile.reviewPolicy)] : []),
    ...(profile.outputPolicy ? [outputPolicyAction(profile.outputPolicy)] : []),
  ];
  const issues = actions.flatMap(issuesForAction);
  const blockers = issues.filter((issue) => issue.severity === "blocker");
  const warnings = issues.filter((issue) => issue.severity === "warning");
  return {
    mode: "preview",
    writeCapable: false,
    apply: planApplyState(actions),
    profile: {
      id: profile.id,
      label: profile.label,
      lifecycle: profile.lifecycle,
    },
    summary: {
      totalActions: actions.length,
      readyPluginRecommendations: actions.filter(
        (action): action is ProfilePluginRecommendationAction =>
          action.kind === "pluginRecommendation" && action.pluginStatus === "ready",
      ).length,
      warningCount: warnings.length,
      blockerCount: blockers.length,
      wouldWriteCount: actions.filter((action) => action.effect.wouldWrite).length,
      wouldInstallSkillCount: actions.filter((action) => action.effect.wouldInstallSkills).length,
      wouldScheduleRoutineCount: actions.filter((action) => action.effect.wouldScheduleRoutines).length,
    },
    actions,
    blockers,
    warnings,
    safety: {
      writesEnabled: false,
      pluginEnableEnabled: false,
      skillInstallEnabled: false,
      routineSchedulingEnabled: false,
      mcpConfigMutationEnabled: false,
    },
  };
}

function planApplyState(actions: ProfilePlanAction[]): ProfilePlanApplyState {
  const blockedBy = applyBlockers(actions);
  return {
    available: false,
    label: "Review only",
    reason: "Broad profile application is read-only. Trusted profiles may stage file-template proposal records for UI/CLI review, but plugin enablement, permission grants, skill installation, settings changes, and routine scheduling remain blocked until their own apply gates ship.",
    blockedBy,
    promptSteps: applyPromptSteps(actions),
  };
}

function applyBlockers(actions: ProfilePlanAction[]): ProfilePlanApplyBlocker[] {
  const blockers: ProfilePlanApplyBlocker[] = [
    {
      kind: "permissionModel",
      message: "Permission prompts and trust grants are not implemented for profile application.",
      actionIds: actions.map((action) => action.id),
    },
  ];
  pushBlocker(blockers, "pluginTrust", "Some recommended plugins require trust review before they can be used.", actions, (action) =>
    action.kind === "pluginRecommendation" && action.pluginStatus === "untrusted",
  );
  pushBlocker(blockers, "pluginEnable", "Some recommended plugins would need to be enabled or installed.", actions, (action) =>
    action.kind === "pluginRecommendation" && action.pluginStatus !== "ready" && action.pluginStatus !== "untrusted",
  );
  pushBlocker(blockers, "pluginSettings", "Some recommended plugin settings would need review before profile application.", actions, (action) =>
    action.kind === "pluginRecommendation" && action.inventoryItem?.settingsReviewRequired === true,
  );
  pushBlocker(blockers, "fileWrite", "Profile templates must be staged as proposal records and accepted through UI/CLI review before target files are written.", actions, (action) =>
    Boolean(action.effect.wouldWrite),
  );
  pushBlocker(blockers, "skillInstall", "Profile skills would need an explicit skill install/enable flow.", actions, (action) =>
    Boolean(action.effect.wouldInstallSkills),
  );
  pushBlocker(blockers, "routineScheduling", "Profile routines would need an explicit routine instantiation or scheduling flow.", actions, (action) =>
    Boolean(action.effect.wouldScheduleRoutines),
  );
  pushBlocker(blockers, "mcpConfig", "MCP config templates would need an explicit MCP configuration mutation flow.", actions, (action) =>
    Boolean(action.effect.wouldMutateMcpConfig),
  );
  return blockers;
}

function applyPromptSteps(actions: ProfilePlanAction[]): ProfilePlanApplyPromptStep[] {
  const steps: ProfilePlanApplyPromptStep[] = [];
  pushPromptStep(
    steps,
    "pluginTrustReview",
    "Trust local plugins",
    "Review local/developer plugin manifests before a profile can rely on them.",
    actions,
    (action) => action.kind === "pluginRecommendation" && action.pluginStatus === "untrusted",
  );
  pushPromptStep(
    steps,
    "pluginEnableReview",
    "Enable or install plugins",
    "Choose whether recommended plugins should be enabled or installed. This remains separate from profile selection.",
    actions,
    (action) => action.kind === "pluginRecommendation" && action.pluginStatus !== "ready" && action.pluginStatus !== "untrusted",
  );
  pushPromptStep(
    steps,
    "permissionGrantReview",
    "Grant requested permissions",
    "Grant only the permissions requested by reviewed plugin capabilities. Manifest requests are not authority.",
    actions,
    (action) => action.kind === "pluginRecommendation" && (action.inventoryItem?.missingPermissions.length ?? 0) > 0,
  );
  pushPromptStep(
    steps,
    "pluginSettingsReview",
    "Review plugin settings",
    "Review plugin-owned settings separately from workspace profile selection.",
    actions,
    (action) => action.kind === "pluginRecommendation" && action.inventoryItem?.settingsReviewRequired === true,
  );
  pushPromptStep(
    steps,
    "fileWriteReview",
    "Review file writes",
    "Trusted profiles can stage context, instruction, and MCP config templates as proposal records; target files are written only after UI/CLI proposal acceptance.",
    actions,
    (action) => Boolean(action.effect.wouldWrite),
  );
  pushPromptStep(
    steps,
    "skillInstallReview",
    "Install or enable skills",
    "Review harness skill changes before installing or enabling profile-recommended skills.",
    actions,
    (action) => Boolean(action.effect.wouldInstallSkills),
  );
  pushPromptStep(
    steps,
    "routineInstantiationReview",
    "Create routines",
    "Instantiate or schedule routines only after the user reviews scope, harness, and output policy.",
    actions,
    (action) => Boolean(action.effect.wouldScheduleRoutines),
  );
  pushPromptStep(
    steps,
    "mcpConfigReview",
    "Review MCP config",
    "Review MCP configuration changes separately from profile selection and plugin trust.",
    actions,
    (action) => Boolean(action.effect.wouldMutateMcpConfig),
  );
  return steps;
}

function pushPromptStep(
  steps: ProfilePlanApplyPromptStep[],
  kind: ProfilePlanApplyPromptKind,
  label: string,
  detail: string,
  actions: ProfilePlanAction[],
  predicate: (action: ProfilePlanAction) => boolean,
): void {
  const matchingActions = actions.filter(predicate);
  if (matchingActions.length === 0) {
    return;
  }
  steps.push({
    kind,
    label,
    detail,
    actionIds: matchingActions.map((action) => action.id),
    enabled: false,
    required: matchingActions.some((action) => action.required === true || action.severity === "blocker"),
  });
}

function pushBlocker(
  blockers: ProfilePlanApplyBlocker[],
  kind: ProfilePlanApplyBlockerKind,
  message: string,
  actions: ProfilePlanAction[],
  predicate: (action: ProfilePlanAction) => boolean,
): void {
  const actionIds = actions.filter(predicate).map((action) => action.id);
  if (actionIds.length > 0) {
    blockers.push({ kind, message, actionIds });
  }
}

function pluginRecommendationAction(
  recommendation: ProfilePluginRecommendation,
  inventory: PluginInventory,
): ProfilePluginRecommendationAction {
  const resolution = resolveRecommendedPlugin(recommendation.id, inventory);
  return {
    kind: "pluginRecommendation",
    id: recommendation.id,
    label: resolution.item?.pluginName ?? resolution.item?.label ?? recommendation.id,
    required: recommendation.required,
    severity:
      recommendation.required && resolution.status !== "ready"
        ? "blocker"
        : resolution.status === "ready"
          ? "info"
          : "warning",
    recommendation,
    pluginStatus: resolution.status,
    inventoryItem: resolution.item ? inventoryReference(resolution.item) : undefined,
    effect: {
      previewOnly: true,
      mutates: false,
      ...(resolution.status !== "ready"
        ? { wouldEnablePlugin: `Would require explicit user action before ${recommendation.id} can be used.` }
        : {}),
    },
  };
}

function resolveRecommendedPlugin(
  id: string,
  inventory: PluginInventory,
): { status: ProfilePluginRecommendationStatus; item?: PluginInventoryItem } {
  const matches = inventory.items.filter((item) => item.id === id || item.pluginId === id);
  if (matches.length === 0) {
    return { status: "missing" };
  }
  const ready = matches.find((item) => item.trust === "trusted" && item.enabled && item.status === "available");
  if (ready) {
    return { status: "ready", item: ready };
  }
  const untrusted = matches.find((item) => item.trust === "untrusted");
  if (untrusted) {
    return { status: "untrusted", item: untrusted };
  }
  const disabled = matches.find((item) => !item.enabled || item.status === "disabled");
  if (disabled) {
    return { status: "disabled", item: disabled };
  }
  return { status: "unavailable", item: matches[0] };
}

function metadataSchemaAction(schema: ProfileMetadataSchema): ProfileMetadataSchemaAction {
  return {
    kind: "metadataSchema",
    id: schema.id,
    label: schema.label,
    severity: "info",
    schema,
    effect: previewEffect(),
  };
}

function templateAction(kind: ProfileTemplateAction["kind"], template: ProfileTemplateReference): ProfileTemplateAction {
  return {
    kind,
    id: template.id,
    label: template.label,
    severity: "info",
    template,
    effect: {
      ...previewEffect(),
      wouldWrite: `Can stage ${template.target ?? template.id} from ${template.templatePath} as a reviewable proposal; target files change only after UI/CLI acceptance.`,
      ...(kind === "mcpConfigTemplate"
        ? { wouldMutateMcpConfig: `Would update MCP config from ${template.templatePath} only with explicit confirmation.` }
        : {}),
    },
  };
}

function skillAction(skill: ProfileSkillReference): ProfileSkillAction {
  return {
    kind: "skill",
    id: skill.id,
    label: skill.label,
    required: skill.required,
    severity: "info",
    skill,
    effect: {
      ...previewEffect(),
      wouldInstallSkills: `Would install or enable skill ${skill.id} for ${
        skill.harnesses.join(", ") || "configured harnesses"
      } only in a future apply flow.`,
    },
  };
}

function routineTemplateAction(routineTemplateId: string): ProfileRoutineTemplateAction {
  return {
    kind: "routineTemplate",
    id: routineTemplateId,
    label: routineTemplateId,
    severity: "info",
    routineTemplateId,
    effect: {
      ...previewEffect(),
      wouldScheduleRoutines: `Would instantiate or schedule routine template ${routineTemplateId} only in a future apply flow.`,
    },
  };
}

function graphViewAction(graphView: ProfileGraphViewReference): ProfileGraphViewAction {
  return {
    kind: "graphView",
    id: graphView.id,
    label: graphView.label,
    severity: "info",
    graphView,
    effect: previewEffect(),
  };
}

function analyzerSettingAction(analyzerSetting: ProfileAnalyzerSetting): ProfileAnalyzerSettingAction {
  return {
    kind: "analyzerSetting",
    id: analyzerSetting.analyzerId,
    label: analyzerSetting.analyzerId,
    severity: "info",
    analyzerSetting,
    effect: previewEffect(),
  };
}

function reviewPolicyAction(reviewPolicy: ProfileReviewPolicy): ProfileReviewPolicyAction {
  return {
    kind: "reviewPolicy",
    id: "reviewPolicy",
    label: "Review policy",
    severity: "info",
    reviewPolicy,
    effect: previewEffect(),
  };
}

function outputPolicyAction(outputPolicy: RoutineOutputPolicy): ProfileOutputPolicyAction {
  return {
    kind: "outputPolicy",
    id: "outputPolicy",
    label: "Output policy",
    severity: "info",
    outputPolicy,
    effect: previewEffect(),
  };
}

function issuesForAction(action: ProfilePlanAction): ProfilePlanIssue[] {
  if (action.kind !== "pluginRecommendation" || action.pluginStatus === "ready") {
    return [];
  }
  const severity = action.required ? "blocker" : "warning";
  return [
    {
      severity,
      actionKind: action.kind,
      actionId: action.id,
      message: `${action.required ? "Required" : "Optional"} plugin ${action.id} is ${action.pluginStatus}.`,
    },
  ];
}

function previewEffect(): ProfilePlanEffect {
  return {
    previewOnly: true,
    mutates: false,
  };
}

function inventoryReference(item: PluginInventoryItem): ProfilePlanInventoryReference {
  return {
    id: item.id,
    label: item.label,
    status: item.status,
    statusLabel: item.statusLabel,
    enabled: item.enabled,
    trust: item.trust,
    pluginId: item.pluginId,
    pluginName: item.pluginName,
    requestedPermissions: item.permissionGrants?.requested ?? item.permissions,
    grantedPermissions: item.permissionGrants?.granted ?? [],
    missingPermissions: item.permissionGrants?.missing ?? [],
    settingsReviewRequired: item.settings?.reviewRequired === true
      || item.settings?.configReviewRequired === true
      || (item.settings?.validationErrors.length ?? 0) > 0,
  };
}
