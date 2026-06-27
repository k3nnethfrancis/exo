import type { PluginInventory, PluginInventoryItem } from "@exo/core";
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

export interface PluginActionAvailability {
  mutable: boolean;
  reason: string;
  actions: PluginManagerAction[];
}

const SOURCE_ORDER: Record<PluginInventoryItem["source"], number> = {
  core: 0,
  bundled: 1,
  localManifest: 2,
};

const CATEGORY_ORDER = [
  ["core", "Core"],
  ["searchProvider", "Search providers"],
  ["agentHarness", "Agent harnesses"],
  ["routineTemplate", "Routine templates"],
  ["profile", "Profiles"],
  ["graphVisualization", "Graph visualizations"],
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
    .filter(([id]) => !knownIds.has(id as (typeof CATEGORY_ORDER)[number][0]))
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
    .filter((item) => categoryId === "other" ? !knownIds.has(item.categoryId as (typeof CATEGORY_ORDER)[number][0]) : item.categoryId === categoryId)
    .sort(compareInventoryItems);
}

function compareInventoryItems(a: PluginInventoryItem, b: PluginInventoryItem): number {
  return `${SOURCE_ORDER[a.source]}:${a.label}`.localeCompare(`${SOURCE_ORDER[b.source]}:${b.label}`);
}

function categorySort(categoryId: string): number {
  switch (categoryId) {
    case "core":
      return 0;
    case "searchProvider":
      return 1;
    case "agentHarness":
      return 2;
    case "routineTemplate":
      return 3;
    case "profile":
      return 4;
    case "graphVisualization":
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

  if (item.kind === "searchProvider") {
    sections.push(...searchProviderDetailSections(item));
  }
  if (item.kind === "agentHarness") {
    sections.push(...agentHarnessDetailSections(item));
  }
  if (item.kind === "profile") {
    sections.push(...profileDetailSections(item, inventory));
  }
  if (item.kind === "routineTemplate") {
    sections.push(...routineTemplateDetailSections(item));
  }
  if (item.kind === "graphVisualization") {
    sections.push(...graphVisualizationDetailSections(item));
  }
  if (item.manifestPath || item.rootDirectory) {
    sections.push({
      id: "paths",
      label: "Paths",
      rows: compactRows([row("Manifest", item.manifestPath), row("Root", item.rootDirectory)]),
    });
  }
  return sections.filter((section) => section.rows.length > 0);
}

export function pluginActionAvailability(item: PluginInventoryItem): PluginActionAvailability {
  if (item.source === "core") {
    return { mutable: false, reason: "Core surfaces are built in and cannot be disabled.", actions: [] };
  }
  if (item.distribution === "official" || item.source === "bundled") {
    return { mutable: false, reason: "Official plugin rows are read-only in Plugin Enablement v0.", actions: [] };
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

function searchProviderDetailSections(item: PluginInventoryItem): PluginDetailSection[] {
  const compatibility = item.compatibility ?? {};
  return [
    {
      id: "search-provider",
      label: "Search Provider",
      rows: compactRows([
        row("Provider", firstString(compatibility, ["provider", "searchProvider", "indexProvider"]) ?? item.label),
        row("Backend", firstString(compatibility, ["backend", "indexBackend", "engine"])),
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
        row("Default harness", optionalString(template, "harnessId")),
        row("Skills", summarizeList(readRecordArray(template.requiredSkills).map(skillLabel).filter(isString))),
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
