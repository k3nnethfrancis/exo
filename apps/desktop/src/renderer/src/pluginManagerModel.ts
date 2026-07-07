import type { PluginInventory, PluginInventoryItem, PluginSettingsSchema, PluginSettingValue, ResolvedPluginSettings } from "@exo/core";
import type { WorkspacePluginActionInput } from "../../shared/api";

export interface PluginInventoryGroup {
  id: string;
  label: string;
  items: PluginInventoryItem[];
}

export interface PluginCategoryFilter {
  id: string;
  label: string;
  count: number;
}

export type PluginStateFilterId = "all" | "active" | "disabled" | "untrusted" | "missing" | "attention" | "local" | "configurable";

export interface PluginStateFilter {
  id: PluginStateFilterId;
  label: string;
  count: number;
  detail: string;
}

export interface PluginManagementSummaryBucket {
  id: string;
  label: string;
  value: number | string;
  detail: string;
  tone: "neutral" | "ok" | "warning" | "danger";
}

export interface PluginBoundaryLayer {
  id: "core" | "official" | "local" | "developer";
  label: string;
  value: number;
  detail: string;
  management: string;
}

export interface PluginBoundarySummary {
  layers: PluginBoundaryLayer[];
  manageableLocalCount: number;
  blockedCount: number;
  coreSummary: string;
}

export interface PluginDetailSection {
  id: string;
  label: string;
  rows: PluginDetailRow[];
}

export interface PluginDetailRow {
  label: string;
  value: string;
}

export type PluginManagerAction = "trust" | "enable" | "disable";
export type PluginLocalManagementAction = "remove" | "replace";

export interface PluginActionAvailability {
  mutable: boolean;
  reason: string;
  actions: PluginManagerAction[];
}

export interface PluginRowIndicator {
  id: string;
  label: string;
  tone: "neutral" | "ok" | "warning" | "danger";
}

export interface PluginSettingsAvailability {
  visible: boolean;
  editable: boolean;
  canRead: boolean;
  reason: string;
}

export interface PluginLocalManagementAvailability {
  manageable: boolean;
  reason: string;
  actions: PluginLocalManagementAction[];
  target: "user" | "workspace" | null;
}

export type PluginSettingsDraft = Record<string, boolean | string>;

const SOURCE_ORDER: Record<PluginInventoryItem["source"], number> = {
  core: 0,
  bundled: 1,
  localManifest: 2,
};

const CATEGORY_ORDER = [
  ["core:searchProvider", "Search providers"],
  ["core:agentHarness", "Agent harnesses"],
  ["core:routineTemplate", "Routine templates"],
  ["core:profile", "Profiles"],
  ["exo.graph:visualization", "Graph visualizations"],
] as const;

export function groupPluginInventoryItems(items: PluginInventoryItem[]): PluginInventoryGroup[] {
  const groups = new Map<string, PluginInventoryGroup>();
  for (const item of items) {
    const group = groups.get(item.categoryId) ?? {
      id: item.categoryId,
      label: item.categoryLabel,
      items: [],
    };
    group.items.push(item);
    groups.set(item.categoryId, group);
  }

  return [...groups.values()]
    .map((group) => ({
      ...group,
      items: [...group.items].sort(compareInventoryItems),
    }))
    .sort((a, b) => `${categorySort(a.id)}:${a.label}`.localeCompare(`${categorySort(b.id)}:${b.label}`));
}

export function buildPluginCategoryFilters(items: PluginInventoryItem[]): PluginCategoryFilter[] {
  const counts = new Map<string, { label: string; count: number }>();
  for (const item of items) {
    if (item.source === "core") {
      continue;
    }
    const current = counts.get(item.categoryId) ?? { label: item.categoryLabel, count: 0 };
    current.count += 1;
    counts.set(item.categoryId, current);
  }

  const filters: PluginCategoryFilter[] = CATEGORY_ORDER.map(([id, label]) => ({
    id,
    label,
    count: counts.get(id)?.count ?? 0,
  }));
  const knownIds = new Set(CATEGORY_ORDER.map(([id]) => id));
  const otherCount = [...counts.entries()]
    .filter(([id]) => id !== "core" && !knownIds.has(id as (typeof CATEGORY_ORDER)[number][0]))
    .reduce((total, [, value]) => total + value.count, 0);
  filters.push({ id: "other", label: "Other", count: otherCount });
  return filters;
}

export function filterPluginInventoryItems(
  items: PluginInventoryItem[],
  categoryId: string,
): PluginInventoryItem[] {
  const knownIds = new Set(CATEGORY_ORDER.map(([id]) => id));
  return items
    .filter((item) => {
      if (item.source === "core") {
        return false;
      }
      return categoryId === "other" ? !knownIds.has(item.categoryId as (typeof CATEGORY_ORDER)[number][0]) : item.categoryId === categoryId;
    })
    .sort(compareInventoryItems);
}

export function buildPluginStateFilters(items: PluginInventoryItem[]): PluginStateFilter[] {
  const filters: Omit<PluginStateFilter, "count">[] = [
    {
      id: "all",
      label: "All",
      detail: "Every capability in the selected category.",
    },
    {
      id: "active",
      label: "Active",
      detail: "Trusted, enabled, and ready/configured.",
    },
    {
      id: "attention",
      label: "Needs attention",
      detail: "Untrusted, missing setup, missing permissions, or settings review required.",
    },
    {
      id: "disabled",
      label: "Disabled",
      detail: "Known capabilities that are currently off.",
    },
    {
      id: "untrusted",
      label: "Untrusted",
      detail: "Local or developer manifests that need trust review before use.",
    },
    {
      id: "missing",
      label: "Missing",
      detail: "Rows blocked by missing dependencies, setup steps, invalid settings, or broken readiness.",
    },
    {
      id: "local",
      label: "Local/dev",
      detail: "User, workspace, or developer manifest plugins.",
    },
    {
      id: "configurable",
      label: "Has settings",
      detail: "Plugins declaring plugin-owned settings.",
    },
  ];

  return filters.map((filter) => ({
    ...filter,
    count: filterPluginInventoryItemsByState(items, filter.id).length,
  }));
}

export function filterPluginInventoryItemsByState(
  items: PluginInventoryItem[],
  stateFilterId: PluginStateFilterId,
): PluginInventoryItem[] {
  return items
    .filter((item) => matchesPluginStateFilter(item, stateFilterId))
    .sort(compareInventoryItems);
}

export function buildPluginManagementSummary(items: PluginInventoryItem[]): PluginManagementSummaryBucket[] {
  const pluginItems = items.filter((item) => item.source !== "core");
  const activeCount = pluginItems.filter(isActivePluginRow).length;
  const disabledCount = pluginItems.filter((item) => !item.enabled || item.status === "disabled").length;
  const reviewCount = pluginItems.filter((item) => item.trust === "untrusted").length;
  const setupIssueCount = pluginItems.filter(hasSetupIssue).length;
  const permissionRequestedCount = pluginItems.filter((item) => requestedPermissions(item).length > 0).length;
  const permissionNeededCount = pluginItems.filter((item) => missingPermissions(item).length > 0).length;

  return [
    {
      id: "active",
      label: "Active",
      value: activeCount,
      detail: "Trusted, enabled, and currently available/configured.",
      tone: "ok",
    },
    {
      id: "disabled",
      label: "Disabled",
      value: disabledCount,
      detail: "Installed or known plugin capabilities that are currently off.",
      tone: disabledCount > 0 ? "neutral" : "ok",
    },
    {
      id: "review",
      label: "Review",
      value: reviewCount,
      detail: "Untrusted local or developer manifests waiting for review.",
      tone: reviewCount > 0 ? "warning" : "ok",
    },
    {
      id: "setup",
      label: "Setup issues",
      value: setupIssueCount,
      detail: "Plugin rows with missing dependencies, setup work, broken status, or settings review.",
      tone: setupIssueCount > 0 ? "danger" : "ok",
    },
    {
      id: "permissions",
      label: "Permissions",
      value: permissionNeededCount > 0 ? `${permissionNeededCount}/${permissionRequestedCount}` : permissionRequestedCount,
      detail: permissionNeededCount > 0
        ? "Rows with missing requested permission grants over rows requesting permissions."
        : "Rows requesting permissions. Manifest requests are metadata only in this slice.",
      tone: permissionNeededCount > 0 ? "warning" : "neutral",
    },
  ];
}

export function buildPluginBoundarySummary(items: PluginInventoryItem[]): PluginBoundarySummary {
  const coreCount = items.filter((item) => item.source === "core").length;
  const officialCount = items.filter((item) => item.source === "bundled" || item.distribution === "official").length;
  const localCount = items.filter((item) =>
    item.source === "localManifest" && (item.pluginSource === "user" || item.pluginSource === "workspace" || item.distribution === "local")
  ).length;
  const developerCount = items.filter((item) =>
    item.source === "localManifest"
    && item.pluginSource !== "user"
    && item.pluginSource !== "workspace"
    && item.distribution !== "local"
  ).length;
  const manageableLocalCount = items.filter((item) => pluginLocalManagementAvailability(item).manageable).length;
  const blockedCount = items.filter((item) =>
    !item.enabled
    || item.trust === "untrusted"
    || item.status === "broken"
    || item.status === "missing-dependency"
    || hasSetupIssue(item)
  ).length;

  return {
    layers: [
      {
        id: "core",
        label: "Exograph baseline",
        value: coreCount,
        detail: "Markdown graph, editor, files, basic search, terminal host, web viewer host, settings, and plugin registry.",
        management: "Always on. Configure related behavior in Settings.",
      },
      {
        id: "official",
        label: "Official plugins",
        value: officialCount,
        detail: "Reviewed capabilities shipped with Exo, such as QMD and default harness adapters.",
        management: "Read-only lifecycle. Setup state and plugin-owned config are shown here.",
      },
      {
        id: "local",
        label: "Local plugins",
        value: localCount,
        detail: "User or workspace plugin manifests installed into Exo-managed plugin directories.",
        management: "Trust, enable, disable, configure, swap, or remove here when Exo manages the directory.",
      },
      {
        id: "developer",
        label: "Developer plugins",
        value: developerCount,
        detail: "Explicit development/operator plugin paths for local experiments.",
        management: "Inspect and toggle here; remove or move source paths outside Plugin Manager.",
      },
    ],
    manageableLocalCount,
    blockedCount,
    coreSummary: "Core stays available even when optional plugins are disabled. Plugins add replaceable capabilities on top of the Exograph baseline.",
  };
}

export function buildPluginRowIndicators(item: PluginInventoryItem): PluginRowIndicator[] {
  const indicators: PluginRowIndicator[] = [];
  if (item.source === "core") {
    indicators.push({ id: "core", label: "Core baseline", tone: "neutral" });
  } else if (item.distribution === "official" || item.source === "bundled") {
    indicators.push({ id: "locked", label: "Read-only", tone: "neutral" });
  }
  if (item.trust === "untrusted") {
    indicators.push({ id: "untrusted", label: "Needs trust", tone: "warning" });
  }
  if (!item.enabled || item.status === "disabled") {
    indicators.push({ id: "disabled", label: "Disabled", tone: "neutral" });
  }
  if (hasSetupIssue(item)) {
    indicators.push({ id: "setup", label: item.readiness?.label ?? "Setup issue", tone: readinessTone(item) });
  } else if (item.readiness) {
    indicators.push({ id: "readiness", label: item.readiness.label, tone: readinessTone(item) });
  }
  if (requestedPermissions(item).length > 0) {
    indicators.push({
      id: "permissions",
      label: missingPermissions(item).length > 0 ? "Permissions needed" : "Permissions requested",
      tone: missingPermissions(item).length > 0 ? "warning" : "neutral",
    });
  }
  if (item.settings?.hasSettings) {
    indicators.push({
      id: "settings",
      label: item.settings.reviewRequired || item.settings.configReviewRequired ? "Settings review" : "Configurable",
      tone: item.settings.reviewRequired || item.settings.configReviewRequired ? "warning" : "neutral",
    });
  }
  if (indicators.length === 0 && isActivePluginRow(item)) {
    indicators.push({ id: "active", label: "Active", tone: "ok" });
  }
  return indicators;
}

export function pluginDisplayStatus(item: PluginInventoryItem): { label: string; tone: "ok" | "warning" | "danger" | "disabled" } {
  if (item.status === "unsupported-kind") {
    return { label: "Not supported", tone: "disabled" };
  }
  if (!item.enabled || item.status === "disabled") {
    return { label: "Disabled", tone: "disabled" };
  }
  if (item.trust === "untrusted") {
    return { label: "Untrusted", tone: "warning" };
  }
  if (item.status === "missing-dependency") {
    return { label: "Missing dependency", tone: "danger" };
  }
  if (item.status === "broken") {
    return { label: "Broken", tone: "danger" };
  }
  if (hasSetupIssue(item)) {
    return { label: item.readiness?.label ?? "Needs setup", tone: readinessTone(item) === "danger" ? "danger" : "warning" };
  }
  if (isActivePluginRow(item)) {
    return { label: "Active", tone: "ok" };
  }
  return { label: item.statusLabel, tone: "warning" };
}

export function pluginManagementLane(item: PluginInventoryItem): string {
  if (item.source === "core") {
    return "Exograph baseline";
  }
  if (item.source === "bundled" || item.distribution === "official") {
    return "Official plugin";
  }
  if (item.source === "localManifest" && item.pluginSource === "workspace") {
    return "Workspace plugin";
  }
  if (item.source === "localManifest" && item.pluginSource === "user") {
    return "User plugin";
  }
  if (item.source === "localManifest") {
    return "Developer plugin";
  }
  return item.sourceLabel;
}

export function pluginManagementGuidance(item: PluginInventoryItem): string {
  if (item.source === "core") {
    return "Core substrate. Always available; not a plugin lifecycle row.";
  }
  if (item.source === "bundled" || item.distribution === "official") {
    return "Reviewed plugin shipped with Exo. Plugin Manager shows setup, state, and plugin-owned config.";
  }
  if (item.source === "localManifest" && (item.pluginSource === "workspace" || item.pluginSource === "user")) {
    return "Exo-managed local plugin. Review trust, enablement, settings, and local copy actions here.";
  }
  if (item.source === "localManifest") {
    return "Developer/operator plugin path. Toggle and inspect it here; manage the source directory outside Plugin Manager.";
  }
  return "Plugin capability discovered by Exo.";
}

function compareInventoryItems(a: PluginInventoryItem, b: PluginInventoryItem): number {
  return `${SOURCE_ORDER[a.source]}:${a.label}`.localeCompare(`${SOURCE_ORDER[b.source]}:${b.label}`);
}

function categorySort(categoryId: string): number {
  switch (categoryId) {
    case "core":
      return 0;
    case "core:searchProvider":
      return 1;
    case "core:agentHarness":
      return 2;
    case "core:routineTemplate":
      return 3;
    case "core:profile":
      return 4;
    case "exo.graph:visualization":
      return 5;
    default:
      return 10;
  }
}

export function buildPluginDetailSections(
  item: PluginInventoryItem,
  inventory?: PluginInventory,
): PluginDetailSection[] {
  const sections: PluginDetailSection[] = [
    {
      id: "status",
      label: "Status",
      rows: compactRows([
        row("Source", item.sourceLabel),
        row("Distribution", item.distributionLabel),
        row("Lifecycle", item.lifecycle),
        row("Trust", item.trust),
        row("State", item.statusLabel),
        row("Readiness", item.readiness?.label),
        row("Readiness detail", item.readiness?.detail),
        row("Management lane", pluginManagementLane(item)),
        row("Management", pluginManagementGuidance(item)),
        row("Plugin", item.pluginName),
        row("Owner", item.owner),
      ]),
    },
  ];

  if (item.dependencies?.length) {
    sections.push({
      id: "dependencies",
      label: "Dependencies",
      rows: item.dependencies.map((dependency) =>
        row(dependency.label, `${dependency.statusLabel}${dependency.required ? " · required" : ""}`),
      ),
    });
  }

  const permissionRows = pluginPermissionRows(item);
  if (permissionRows.length > 0) {
    sections.push({
      id: "permissions",
      label: "Permissions",
      rows: permissionRows,
    });
  }

  if (item.kind === "core:searchProvider") {
    sections.push(...searchProviderDetailSections(item));
  }
  if (item.kind === "core:agentHarness") {
    sections.push(...agentHarnessDetailSections(item));
  }
  if (item.kind === "core:profile") {
    sections.push(...profileDetailSections(item, inventory));
  }
  if (item.kind === "core:routineTemplate") {
    sections.push(...routineTemplateDetailSections(item));
  }
  if (item.kind === "exo.graph:visualization") {
    sections.push(...graphVisualizationDetailSections(item));
  }
  if (item.manifestPath || item.rootDirectory) {
    sections.push({
      id: "paths",
      label: "Paths",
      rows: compactRows([row("Manifest", item.manifestPath), row("Root", item.rootDirectory)]),
    });
  }

  if (item.runtime) {
    sections.push({
      id: "runtime-boundary",
      label: "Runtime Boundary",
      rows: compactRows([
        row("Entrypoints", item.runtime.executableLoading),
        row("Can load entrypoints", item.runtime.canLoadEntrypoints ? "yes" : "no"),
        row("Can grant permissions", item.runtime.canGrantPermissions ? "yes" : "no"),
        row("Reason", item.runtime.reason),
      ]),
    });
  }

  const alternativeRows = alternativeDetailRows(item, inventory);
  if (alternativeRows.length > 0) {
    sections.push({
      id: "alternatives",
      label: "Same-Category Alternatives",
      rows: alternativeRows,
    });
  }
  return sections.filter((section) => section.rows.length > 0);
}

export function pluginActionAvailability(item: PluginInventoryItem): PluginActionAvailability {
  if (item.status === "unsupported-kind") {
    return { mutable: false, reason: "This capability kind is not supported by this Exo version.", actions: [] };
  }
  if (item.source === "core") {
    return { mutable: false, reason: "Core surfaces are built in. Manage workspace behavior in Settings, not Plugin Manager.", actions: [] };
  }
  if (item.distribution === "official" || item.source === "bundled") {
    return { mutable: false, reason: "Official plugin lifecycle is read-only in this pass; setup and plugin-owned config remain visible here.", actions: [] };
  }
  if (item.source !== "localManifest" || !item.pluginId || !item.manifestPath || !item.rootDirectory) {
    return { mutable: false, reason: "This row does not include a local plugin manifest identity.", actions: [] };
  }

  const actions: PluginManagerAction[] = [];
  if (item.trust === "untrusted") {
    actions.push("trust");
  }
  actions.push(item.enabled ? "disable" : "enable");
  return {
    mutable: true,
    reason: "Local and developer plugin manifests can be trusted or enabled from this workspace.",
    actions,
  };
}

export function pluginActionInput(item: PluginInventoryItem): WorkspacePluginActionInput {
  if (!item.pluginId || !item.manifestPath || !item.rootDirectory) {
    throw new Error(`Plugin row is missing manifest identity: ${item.id}`);
  }
  return {
    pluginId: item.pluginId,
    capabilityId: item.id,
    source: item.pluginSource,
    manifestPath: item.manifestPath,
    rootDirectory: item.rootDirectory,
  };
}

export function pluginLocalManagementAvailability(item: PluginInventoryItem): PluginLocalManagementAvailability {
  if (item.source !== "localManifest" || !item.pluginId || !item.manifestPath || !item.rootDirectory) {
    return {
      manageable: false,
      reason: "Only discovered local plugin directories can be removed or replaced.",
      actions: [],
      target: null,
    };
  }
  if (item.pluginSource !== "user" && item.pluginSource !== "workspace") {
    return {
      manageable: false,
      reason: "Developer and official plugin directories are read-only from Plugin Manager.",
      actions: [],
      target: null,
    };
  }
  return {
    manageable: true,
    reason: "This plugin is installed in an Exo-managed local plugin directory.",
    actions: ["replace", "remove"],
    target: item.pluginSource,
  };
}

export function pluginSettingsAvailability(item: PluginInventoryItem): PluginSettingsAvailability {
  if (item.source !== "localManifest" || item.distribution === "official" || !item.pluginId || !item.manifestPath || !item.rootDirectory) {
    return {
      visible: false,
      editable: false,
      canRead: false,
      reason: "Plugin-owned settings are editable for local and developer manifests only.",
    };
  }
  if (!item.settings?.hasSettings) {
    return {
      visible: true,
      editable: false,
      canRead: false,
      reason: "This plugin manifest does not declare plugin-owned settings.",
    };
  }
  if (item.trust !== "trusted") {
    return {
      visible: true,
      editable: false,
      canRead: false,
      reason: "Trust this local or developer plugin before editing plugin-owned settings.",
    };
  }
  if (!item.enabled) {
    return {
      visible: true,
      editable: false,
      canRead: false,
      reason: "Enable this plugin before editing plugin-owned settings.",
    };
  }
  const actionAvailability = pluginActionAvailability(item);
  if (!actionAvailability.mutable) {
    return {
      visible: true,
      editable: false,
      canRead: true,
      reason: actionAvailability.reason,
    };
  }
  return {
    visible: true,
    editable: true,
    canRead: true,
    reason: "Plugin-owned settings can be edited for trusted and enabled local or developer plugins.",
  };
}

export function createPluginSettingsDraft(
  schema: PluginSettingsSchema,
  settings: ResolvedPluginSettings,
): PluginSettingsDraft {
  const draft: PluginSettingsDraft = {};
  for (const field of schema.fields) {
    const value = settings.values[field.id] ?? "";
    draft[field.id] = field.type === "boolean" ? value === true : String(value);
  }
  return draft;
}

export function pluginSettingsValuesFromDraft(
  schema: PluginSettingsSchema,
  draft: PluginSettingsDraft,
): Record<string, PluginSettingValue> {
  const values: Record<string, PluginSettingValue> = {};
  for (const field of schema.fields) {
    const rawValue = draft[field.id];
    switch (field.type) {
      case "boolean":
        values[field.id] = rawValue === true;
        break;
      case "number": {
        const parsed = Number(rawValue);
        if (!Number.isFinite(parsed)) {
          throw new Error(`${field.label} must be a number.`);
        }
        values[field.id] = parsed;
        break;
      }
      case "select":
        values[field.id] = typeof rawValue === "string" ? rawValue : "";
        break;
      case "string":
        values[field.id] = typeof rawValue === "string" ? rawValue : "";
        break;
    }
  }
  return values;
}

function searchProviderDetailSections(item: PluginInventoryItem): PluginDetailSection[] {
  const compatibility = item.compatibility ?? {};
  return [
    {
      id: "search-provider",
      label: "Search Provider",
      rows: compactRows([
        row("Provider", firstString(compatibility, ["provider", "searchProvider", "indexProvider"]) ?? item.label),
        row("Backend", firstString(compatibility, ["backend", "indexBackend", "engine"])),
        row("Readiness", item.readiness ? `${item.readiness.label}${item.readiness.detail ? ` · ${item.readiness.detail}` : ""}` : undefined),
        ...readinessMetricRows(item),
        row("Compatibility", summarizeCompatibility(compatibility, ["provider", "searchProvider", "indexProvider", "backend", "indexBackend", "engine"])),
        row("Surfaces", summarizeList(item.surfaces) ?? "none"),
        row("Permissions", summarizeList(item.permissions) ?? "none"),
      ]),
    },
  ];
}

function agentHarnessDetailSections(item: PluginInventoryItem): PluginDetailSection[] {
  const compatibility = item.compatibility ?? {};
  const missingRequired = item.dependencies?.filter((dependency) => dependency.required && dependency.status !== "satisfied") ?? [];
  const launchable = item.enabled && item.trust === "trusted" && missingRequired.length === 0 && item.status !== "broken" && item.status !== "missing-dependency";
  return [
    {
      id: "agent-harness",
      label: "Agent Harness",
      rows: compactRows([
        row("Harness", firstString(compatibility, ["managedAgentKind", "harnessId", "adapterId"]) ?? item.id),
        row("Readiness", item.statusLabel),
        row("Launchability", launchable ? "Launchable when selected in agent surfaces" : "Not launchable until setup/trust/dependencies are satisfied"),
        row("Setup", firstString(compatibility, ["setupSummary", "setup", "readinessSummary"])),
        row("Dependencies", item.dependencies?.length ? item.dependencies.map((dependency) => `${dependency.label}: ${dependency.statusLabel}${dependency.required ? " (required)" : ""}`).join("; ") : "none"),
        row("Surfaces", summarizeList(item.surfaces) ?? "none"),
        row("Permissions", summarizeList(item.permissions) ?? "none"),
      ]),
    },
  ];
}

function profileDetailSections(item: PluginInventoryItem, inventory: PluginInventory | undefined): PluginDetailSection[] {
  const profile = readProfilePayload(item);
  if (!profile || !isRecord(profile)) {
    return [];
  }
  const preview = buildProfilePreview(profile, inventory);
  const recommendedPlugins = readRecordArray(profile.recommendedPlugins)
    .map((plugin) => optionalString(plugin, "id"))
    .filter(isString);
  const metadataSchemas = readRecordArray(profile.metadataSchemas)
    .map((schema) => optionalString(schema, "label") ?? optionalString(schema, "id"))
    .filter(isString);
  const skills = readRecordArray(profile.skills)
    .map((skill) => {
      const label = optionalString(skill, "label") ?? optionalString(skill, "id");
      if (!label) {
        return null;
      }
      const harnesses = readStringArray(skill.harnesses);
      return `${label} (${harnesses.join(", ") || "no harness"})`;
    })
    .filter(isString);
  const graphViews = readRecordArray(profile.graphViews)
    .map((view) => optionalString(view, "label") ?? optionalString(view, "id"))
    .filter(isString);
  const analyzerSettings = readRecordArray(profile.analyzerSettings)
    .map((setting) => optionalString(setting, "analyzerId"))
    .filter(isString);
  const routineTemplateIds = readStringArray(profile.routineTemplateIds);
  const reviewPolicy = isRecord(profile.reviewPolicy) ? profile.reviewPolicy : null;
  const outputPolicy = isRecord(profile.outputPolicy) ? profile.outputPolicy : null;
  return compactSections([
    preview
      ? {
        id: "profile-preview",
        label: "Profile Plan Preview",
        rows: compactRows([
          row("Mode", "Preview only"),
          row("Actions", `${preview.totalActions}`),
          row("Ready recommendations", `${preview.readyPluginRecommendations}`),
          row("Warnings", `${preview.warningCount}`),
          row("Blockers", `${preview.blockerCount}`),
          row("Would write", preview.wouldWriteCount > 0 ? `${preview.wouldWriteCount} future apply actions` : "none"),
          row("Safety", "Writes, plugin enablement, skill installs, routine scheduling, and MCP config mutation are disabled"),
        ]),
      }
      : undefined,
    {
      id: "profile-recommendations",
      label: "Profile Recommendations",
      rows: compactRows([
        row("Recommended plugins", summarizeList(recommendedPlugins)),
        row("Metadata schemas", summarizeList(metadataSchemas)),
        row("Skills", summarizeList(skills)),
        row("Routine templates", summarizeList(routineTemplateIds)),
        row("Graph views", summarizeList(graphViews)),
        row("Analyzer settings", summarizeList(analyzerSettings)),
      ]),
    },
    {
      id: "profile-policies",
      label: "Profile Policies",
      rows: compactRows([
        row("Review", reviewPolicy
          ? `${optionalString(reviewPolicy, "fileChanges") ?? "unspecified"}; human review ${reviewPolicy.requireHumanReview === false ? "optional" : "required"}`
          : undefined),
        row("Review paths", reviewPolicy ? summarizeList(readStringArray(reviewPolicy.allowedPaths)) : undefined),
        row("Output", outputPolicy
          ? `${optionalString(outputPolicy, "fileChanges") ?? "unspecified"}; artifacts ${optionalString(outputPolicy, "artifacts") ?? "unspecified"}`
          : undefined),
        row("Output paths", outputPolicy ? summarizeList(readStringArray(outputPolicy.allowedPaths)) : undefined),
      ]),
    },
  ]);
}

function routineTemplateDetailSections(item: PluginInventoryItem): PluginDetailSection[] {
  const template = item.compatibility?.routineTemplate;
  if (!isRecord(template)) {
    return [];
  }
  const trigger = isRecord(template.trigger) ? template.trigger : null;
  const permissions = isRecord(template.permissions) ? readStringArray(template.permissions.permissions) : [];
  const outputPolicy = isRecord(template.outputPolicy) ? template.outputPolicy : null;
  return [
    {
      id: "routine-template",
      label: "Routine Template",
      rows: compactRows([
        row("Current behavior", "Manual template; setup records it but does not schedule or run it"),
        row("Default harness", optionalString(template, "harnessId")),
        row("Required skills", summarizeList(readRecordArray(template.requiredSkills).map(skillLabel).filter(isString)) ?? "none"),
        row("Trigger", trigger ? triggerLabel(trigger) : "manual"),
        row("Permissions", summarizeList(permissions) ?? "none"),
        row("Output policy", outputPolicy ? outputPolicyLabel(outputPolicy) : undefined),
        row("Output paths", outputPolicy ? summarizeList(readStringArray(outputPolicy.allowedPaths)) : undefined),
      ]),
    },
  ];
}

function graphVisualizationDetailSections(item: PluginInventoryItem): PluginDetailSection[] {
  const graphView = item.compatibility;
  if (!isRecord(graphView)) {
    return [];
  }
  const nodeKinds = readStringArray(graphView.acceptedNodeKinds);
  const edgeKinds = readStringArray(graphView.acceptedEdgeKinds);
  return [
    {
      id: "graph-compatibility",
      label: "Graph Compatibility",
      rows: [
        row("Graph data", optionalString(graphView, "graphDataVersion") ?? "0.1"),
        row("Host", optionalString(graphView, "hostSurface") ?? "editorPane"),
        row("Node kinds", summarizeList(nodeKinds) ?? "note, tag, external, unresolved"),
        row("Edge kinds", summarizeList(edgeKinds) ?? "wikilink, markdownLink, hasTag"),
      ],
    },
  ];
}

function buildProfilePreview(profile: Record<string, unknown>, inventory: PluginInventory | undefined) {
  if (!inventory) {
    return null;
  }
  const recommendations = readRecordArray(profile.recommendedPlugins);
  const metadataSchemas = readRecordArray(profile.metadataSchemas);
  const contextTemplates = readRecordArray(profile.contextTemplates);
  const instructionTemplates = readRecordArray(profile.instructionTemplates);
  const mcpConfigTemplates = readRecordArray(profile.mcpConfigTemplates);
  const skills = readRecordArray(profile.skills);
  const routineTemplateIds = readStringArray(profile.routineTemplateIds);
  const graphViews = readRecordArray(profile.graphViews);
  const analyzerSettings = readRecordArray(profile.analyzerSettings);
  const hasReviewPolicy = isRecord(profile.reviewPolicy);
  const hasOutputPolicy = isRecord(profile.outputPolicy);
  const recommendationStatuses = recommendations.map((recommendation) => {
    const id = optionalString(recommendation, "id");
    return id ? resolveRecommendedPlugin(id, inventory) : "missing";
  });
  const blockerCount = recommendations.filter((recommendation, index) =>
    recommendation.required === true && recommendationStatuses[index] !== "ready"
  ).length;
  const warningCount = recommendations.filter((recommendation, index) =>
    recommendation.required !== true && recommendationStatuses[index] !== "ready"
  ).length;
  return {
    totalActions:
      recommendations.length
      + metadataSchemas.length
      + contextTemplates.length
      + instructionTemplates.length
      + mcpConfigTemplates.length
      + skills.length
      + routineTemplateIds.length
      + graphViews.length
      + analyzerSettings.length
      + (hasReviewPolicy ? 1 : 0)
      + (hasOutputPolicy ? 1 : 0),
    readyPluginRecommendations: recommendationStatuses.filter((status) => status === "ready").length,
    warningCount,
    blockerCount,
    wouldWriteCount: contextTemplates.length + instructionTemplates.length + mcpConfigTemplates.length,
  };
}

function resolveRecommendedPlugin(id: string, inventory: PluginInventory): "ready" | "missing" | "disabled" | "untrusted" | "unavailable" {
  const matches = inventory.items.filter((item) => item.id === id || item.pluginId === id);
  if (matches.length === 0) {
    return "missing";
  }
  if (matches.some((item) => item.trust === "trusted" && item.enabled && item.status === "available")) {
    return "ready";
  }
  if (matches.some((item) => item.trust === "untrusted")) {
    return "untrusted";
  }
  if (matches.some((item) => !item.enabled || item.status === "disabled")) {
    return "disabled";
  }
  return "unavailable";
}

function isActivePluginRow(item: PluginInventoryItem): boolean {
  return item.enabled
    && item.trust === "trusted"
    && !hasSetupIssue(item)
    && (item.status === "available" || item.status === "configured");
}

function hasSetupIssue(item: PluginInventoryItem): boolean {
  return item.status === "broken"
    || item.status === "missing-dependency"
    || item.readiness?.state === "needsSetup"
    || item.readiness?.state === "degraded"
    || item.readiness?.state === "error"
    || item.dependencies?.some((dependency) => dependency.required && dependency.status !== "satisfied") === true
    || item.settings?.reviewRequired === true
    || item.settings?.configReviewRequired === true
    || (item.settings?.validationErrors.length ?? 0) > 0;
}

function matchesPluginStateFilter(item: PluginInventoryItem, stateFilterId: PluginStateFilterId): boolean {
  switch (stateFilterId) {
    case "all":
      return true;
    case "active":
      return isActivePluginRow(item);
    case "attention":
      return item.trust === "untrusted" || hasSetupIssue(item) || missingPermissions(item).length > 0;
    case "disabled":
      return !item.enabled || item.status === "disabled";
    case "untrusted":
      return item.trust === "untrusted";
    case "missing":
      return hasSetupIssue(item);
    case "local":
      return item.source === "localManifest";
    case "configurable":
      return item.settings?.hasSettings === true;
  }
}

function readinessTone(item: PluginInventoryItem): PluginRowIndicator["tone"] {
  switch (item.readiness?.state) {
    case "ready":
      return "ok";
    case "disabled":
    case "unknown":
      return "neutral";
    case "indexing":
    case "needsSetup":
    case "degraded":
      return "warning";
    case "error":
      return "danger";
    default:
      return hasSetupIssue(item) ? "danger" : "neutral";
  }
}

function readinessMetricRows(item: PluginInventoryItem): PluginDetailRow[] {
  return item.readiness?.metrics?.map((metric) => row(metric.label, String(metric.value))) ?? [];
}

function requestedPermissions(item: PluginInventoryItem): string[] {
  return item.permissionGrants?.requested ?? item.permissions ?? [];
}

function grantedPermissions(item: PluginInventoryItem): string[] {
  return item.permissionGrants?.granted ?? [];
}

function missingPermissions(item: PluginInventoryItem): string[] {
  return item.permissionGrants?.missing ?? [];
}

function pluginPermissionRows(item: PluginInventoryItem): PluginDetailRow[] {
  const requested = requestedPermissions(item);
  const granted = grantedPermissions(item);
  const missing = missingPermissions(item);
  if (requested.length === 0 && granted.length === 0 && missing.length === 0) {
    return [];
  }
  return compactRows([
    row("Requested", summarizeList(requested) ?? "none"),
    row("Granted", summarizeList(granted) ?? "none"),
    row("Needed", summarizeList(missing) ?? "none"),
    row("Grant state", item.permissionGrants?.status ?? "none"),
    row("Safety", "Permission requests are metadata only; this screen does not grant permissions or load executable plugin code"),
  ]);
}

function alternativeDetailRows(item: PluginInventoryItem, inventory: PluginInventory | undefined): PluginDetailRow[] {
  if (!inventory) {
    return [];
  }
  const alternatives = inventory.items
    .filter((candidate) => candidate.id !== item.id && candidate.categoryId === item.categoryId)
    .sort(compareInventoryItems);
  if (alternatives.length === 0) {
    return [];
  }
  const ready = alternatives.filter(isActivePluginRow);
  return compactRows([
    row("Compatible ready", summarizeList(ready.slice(0, 6).map(alternativeLabel))),
    row("Same category", summarizeList(alternatives.slice(0, 8).map(alternativeLabel))),
  ]);
}

function alternativeLabel(item: PluginInventoryItem): string {
  return `${item.label} (${item.distributionLabel}, ${item.statusLabel})`;
}

function row(label: string, value: string | undefined): PluginDetailRow {
  return { label, value: value ?? "" };
}

function compactRows(rows: PluginDetailRow[]): PluginDetailRow[] {
  return rows.filter((candidate) => candidate.value.trim().length > 0);
}

function compactSections(sections: Array<PluginDetailSection | undefined>): PluginDetailSection[] {
  return sections.filter((section): section is PluginDetailSection => Boolean(section && section.rows.length > 0));
}

function summarizeList(values: string[]): string | undefined {
  if (values.length === 0) {
    return undefined;
  }
  return values.join(", ");
}

function readProfilePayload(item: PluginInventoryItem): unknown {
  return item.compatibility?.profile;
}

function summarizeCompatibility(record: Record<string, unknown>, omitKeys: string[]): string | undefined {
  const omitted = new Set(omitKeys);
  const values = Object.entries(record)
    .filter(([key, value]) => !omitted.has(key) && value !== undefined && value !== null)
    .map(([key, value]) => `${key}: ${formatUnknown(value)}`)
    .filter(isString);
  return summarizeList(values);
}

function firstString(record: Record<string, unknown>, keys: string[]): string | undefined {
  for (const key of keys) {
    const value = optionalString(record, key);
    if (value) {
      return value;
    }
  }
  return undefined;
}

function readRecordArray(input: unknown): Record<string, unknown>[] {
  return Array.isArray(input) ? input.filter(isRecord) : [];
}

function readStringArray(input: unknown): string[] {
  return Array.isArray(input) ? input.filter(isString) : [];
}

function optionalString(record: Record<string, unknown>, key: string): string | undefined {
  const value = record[key];
  return typeof value === "string" && value.trim().length > 0 ? value : undefined;
}

function formatUnknown(value: unknown): string {
  if (typeof value === "string") {
    return value;
  }
  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }
  if (Array.isArray(value)) {
    return value.map(formatUnknown).join(", ");
  }
  if (isRecord(value)) {
    return Object.entries(value).map(([key, childValue]) => `${key} ${formatUnknown(childValue)}`).join("; ");
  }
  return "";
}

function skillLabel(skill: Record<string, unknown>): string | undefined {
  const label = optionalString(skill, "label") ?? optionalString(skill, "id");
  if (!label) {
    return undefined;
  }
  return skill.required === false ? `${label} (optional)` : label;
}

function triggerLabel(trigger: Record<string, unknown>): string {
  const kind = optionalString(trigger, "kind") ?? "manual";
  if (kind === "schedule") {
    return `schedule: ${optionalString(trigger, "schedule") ?? "unspecified"}${optionalString(trigger, "timezone") ? ` (${optionalString(trigger, "timezone")})` : ""}`;
  }
  return kind;
}

function outputPolicyLabel(outputPolicy: Record<string, unknown>): string {
  const fileChanges = optionalString(outputPolicy, "fileChanges") ?? "unspecified";
  const artifacts = optionalString(outputPolicy, "artifacts") ?? "unspecified";
  return `file changes ${fileChanges}; artifacts ${artifacts}`;
}

function isString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
