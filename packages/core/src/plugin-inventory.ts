import type { AgentHarnessDetection, ManagedAgentKind } from "./types";
import { builtInCapabilities, type CapabilityMetadata } from "./capabilities";
import {
  discoverPluginManifests,
  type DiscoveredPlugin,
  type PluginSource,
  type PluginTrustState,
} from "./plugin";
import { routinePluginDirectoriesFromEnv, type RoutinePluginDirectory } from "./routine-service";

export type PluginInventorySource = "core" | "bundled" | "localManifest";

export interface PluginInventoryDependency {
  id: string;
  label: string;
  required: boolean;
  status: string;
  statusLabel: string;
  detail?: string;
}

export interface PluginInventoryItem {
  id: string;
  label: string;
  description: string;
  categoryId: string;
  categoryLabel: string;
  source: PluginInventorySource;
  sourceLabel: string;
  lifecycle: CapabilityMetadata["lifecycle"];
  owner: string;
  surfaces: CapabilityMetadata["surfaces"];
  permissions: CapabilityMetadata["permissions"];
  enabled: boolean;
  trust: PluginTrustState;
  status: string;
  statusLabel: string;
  pluginId?: string;
  pluginName?: string;
  pluginSource?: PluginSource;
  manifestPath?: string;
  rootDirectory?: string;
  dependencies?: PluginInventoryDependency[];
}

export interface PluginInventoryError {
  directory: string;
  message: string;
}

export interface PluginInventory {
  generatedAt: string;
  items: PluginInventoryItem[];
  errors: PluginInventoryError[];
  counts: {
    total: number;
    core: number;
    bundled: number;
    localManifest: number;
    disabled: number;
    untrusted: number;
  };
}

export interface PluginInventoryOptions {
  workspaceRoot: string;
  env?: Record<string, string | undefined>;
  harnesses?: AgentHarnessDetection[];
  builtIns?: CapabilityMetadata[];
  pluginDirectories?: RoutinePluginDirectory[];
  clock?: () => string;
}

const CORE_INVENTORY_ITEMS: PluginInventoryItem[] = [
  coreItem("core.markdown-graph", "Markdown graph", "Local-first Markdown notes, links, files, and editor primitives."),
  coreItem("core.terminal", "Terminal host", "Durable tmux-backed terminal surface and session APIs."),
  coreItem("core.web-preview", "Web preview", "Trusted local/remote URL preview surface hosted inside Exo."),
  coreItem("core.scheduler", "Scheduler", "Routine scheduling primitive for timed or recurring work."),
  coreItem("core.settings", "Settings", "Baseline workspace, appearance, indexing, and terminal configuration."),
];

export async function listPluginInventory(options: PluginInventoryOptions): Promise<PluginInventory> {
  const directories = options.pluginDirectories ?? routinePluginDirectoriesFromEnv(options.workspaceRoot, options.env ?? process.env);
  const { plugins, errors } = await discoverInventoryPlugins(directories);
  return buildPluginInventory({
    builtIns: options.builtIns ?? builtInCapabilities,
    errors,
    harnesses: options.harnesses,
    now: options.clock?.() ?? new Date().toISOString(),
    plugins,
  });
}

export function buildPluginInventory(input: {
  builtIns?: CapabilityMetadata[];
  errors?: PluginInventoryError[];
  harnesses?: AgentHarnessDetection[];
  now?: string;
  plugins?: DiscoveredPlugin[];
}): PluginInventory {
  const harnessById = new Map((input.harnesses ?? []).map((harness) => [harness.id, harness]));
  const bundledItems = (input.builtIns ?? builtInCapabilities).map((capability) => {
    const harnessKind = managedAgentKindFromCapability(capability);
    return bundledCapabilityItem(capability, harnessKind ? harnessById.get(harnessKind) : undefined);
  });
  const localItems = (input.plugins ?? []).flatMap(pluginInventoryItems);
  const items = [...CORE_INVENTORY_ITEMS, ...bundledItems, ...localItems].sort(compareInventoryItems);
  return {
    generatedAt: input.now ?? new Date().toISOString(),
    items,
    errors: input.errors ?? [],
    counts: {
      total: items.length,
      core: items.filter((item) => item.source === "core").length,
      bundled: items.filter((item) => item.source === "bundled").length,
      localManifest: items.filter((item) => item.source === "localManifest").length,
      disabled: items.filter((item) => !item.enabled).length,
      untrusted: items.filter((item) => item.trust === "untrusted").length,
    },
  };
}

function managedAgentKindFromCapability(capability: CapabilityMetadata): ManagedAgentKind | undefined {
  const rawKind = capability.compatibility?.managedAgentKind;
  return rawKind === "shell" || rawKind === "claude" || rawKind === "codex" || rawKind === "pi" || rawKind === "hermes"
    ? rawKind
    : undefined;
}

async function discoverInventoryPlugins(directories: RoutinePluginDirectory[]): Promise<{
  plugins: DiscoveredPlugin[];
  errors: PluginInventoryError[];
}> {
  const plugins: DiscoveredPlugin[] = [];
  const errors: PluginInventoryError[] = [];
  for (const directory of directories) {
    try {
      plugins.push(
        ...(await discoverPluginManifests([directory.path], {
          source: directory.source,
          trust: directory.trust,
        })),
      );
    } catch (error) {
      errors.push({
        directory: directory.path,
        message: error instanceof Error ? error.message : String(error),
      });
    }
  }
  return { plugins, errors };
}

function coreItem(id: string, label: string, description: string): PluginInventoryItem {
  return {
    id,
    label,
    description,
    categoryId: "core",
    categoryLabel: "Core",
    source: "core",
    sourceLabel: "Core",
    lifecycle: "built-in",
    owner: "@exo/core",
    surfaces: ["desktop", "cli", "mcp", "commandServer", "internal"],
    permissions: [],
    enabled: true,
    trust: "trusted",
    status: "available",
    statusLabel: "Built in",
  };
}

function bundledCapabilityItem(
  capability: CapabilityMetadata,
  harness: AgentHarnessDetection | undefined,
): PluginInventoryItem {
  const isHarness = capability.kind === "agentHarness";
  const enabled = capability.lifecycle !== "disabled" && (!isHarness || harness?.enabled !== false);
  return {
    id: capability.id,
    label: capability.label,
    description: capability.description,
    categoryId: capability.kind,
    categoryLabel: capabilityKindLabel(capability.kind),
    source: "bundled",
    sourceLabel: "Bundled plugin",
    lifecycle: capability.lifecycle,
    owner: capability.owner,
    surfaces: capability.surfaces,
    permissions: capability.permissions,
    enabled,
    trust: "trusted",
    status: harness?.status ?? (enabled ? "available" : "disabled"),
    statusLabel: harness?.statusLabel ?? (enabled ? "Available" : "Disabled"),
    dependencies: harness?.dependencies?.map((dependency) => ({
      id: dependency.id,
      label: dependency.label,
      required: dependency.required,
      status: dependency.satisfied ? "satisfied" : "missing",
      statusLabel: dependency.statusLabel,
      detail: dependency.detail,
    })),
  };
}

function pluginInventoryItems(plugin: DiscoveredPlugin): PluginInventoryItem[] {
  return plugin.manifest.capabilities.map((capability) => {
    const enabled = plugin.trust !== "disabled" && capability.lifecycle !== "disabled";
    return {
      id: capability.id,
      label: capability.label,
      description: capability.description,
      categoryId: capability.kind,
      categoryLabel: capabilityKindLabel(capability.kind),
      source: "localManifest",
      sourceLabel: sourceLabel(plugin.source),
      lifecycle: capability.lifecycle,
      owner: capability.owner,
      surfaces: capability.surfaces,
      permissions: capability.permissions,
      enabled,
      trust: plugin.trust,
      status: plugin.trust === "untrusted" ? "review-required" : enabled ? "available" : "disabled",
      statusLabel: plugin.trust === "untrusted" ? "Review required" : enabled ? "Available" : "Disabled",
      pluginId: plugin.manifest.id,
      pluginName: plugin.manifest.name,
      pluginSource: plugin.source,
      manifestPath: plugin.manifestPath,
      rootDirectory: plugin.rootDirectory,
    };
  });
}

function capabilityKindLabel(kind: CapabilityMetadata["kind"]): string {
  switch (kind) {
    case "agentHarness":
      return "Agent harnesses";
    case "analyzer":
      return "Analyzers";
    case "datasetExporter":
      return "Dataset exporters";
    case "evalRunner":
      return "Eval runners";
    case "profile":
      return "Profiles";
    case "routineTemplate":
      return "Routine templates";
    case "searchProvider":
      return "Search providers";
    case "traceCollector":
      return "Trace collectors";
    case "graphVisualization":
      return "Graph visualizations";
  }
}

function sourceLabel(source: PluginSource): string {
  switch (source) {
    case "built-in":
      return "Bundled plugin";
    case "dev":
      return "Developer manifest";
    case "user":
      return "User manifest";
    case "workspace":
      return "Workspace manifest";
  }
}

function compareInventoryItems(a: PluginInventoryItem, b: PluginInventoryItem): number {
  return `${sourceSort(a.source)}:${a.categoryLabel}:${a.label}`.localeCompare(
    `${sourceSort(b.source)}:${b.categoryLabel}:${b.label}`,
  );
}

function sourceSort(source: PluginInventorySource): number {
  switch (source) {
    case "core":
      return 0;
    case "bundled":
      return 1;
    case "localManifest":
      return 2;
  }
}
