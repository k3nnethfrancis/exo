import type { PluginInventoryItem } from "@exo/core";

export interface PluginInventoryGroup {
  id: string;
  label: string;
  items: PluginInventoryItem[];
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

const SOURCE_ORDER: Record<PluginInventoryItem["source"], number> = {
  core: 0,
  bundled: 1,
  localManifest: 2,
};

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

export function buildPluginDetailSections(item: PluginInventoryItem): PluginDetailSection[] {
  const sections: PluginDetailSection[] = [
    {
      id: "status",
      label: "Status",
      rows: compactRows([
        row("Source", item.sourceLabel),
        row("Lifecycle", item.lifecycle),
        row("Trust", item.trust),
        row("State", item.statusLabel),
        row("Plugin", item.pluginName),
        row("Owner", item.owner),
      ]),
    },
    {
      id: "exposure",
      label: "Exposure",
      rows: [
        row("Surfaces", item.surfaces.join(", ") || "none"),
        row("Permissions", item.permissions.join(", ") || "none"),
      ],
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

  if (item.kind === "profile") {
    sections.push(...profileDetailSections(item));
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

function profileDetailSections(item: PluginInventoryItem): PluginDetailSection[] {
  const profile = readProfilePayload(item);
  if (!profile || !isRecord(profile)) {
    return [];
  }
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
  return [
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

function row(label: string, value: string | undefined): PluginDetailRow {
  return { label, value: value ?? "" };
}

function compactRows(rows: PluginDetailRow[]): PluginDetailRow[] {
  return rows.filter((candidate) => candidate.value.trim().length > 0);
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

function isString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
