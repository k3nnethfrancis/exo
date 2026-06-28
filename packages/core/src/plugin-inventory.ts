import type { AgentHarnessDetection, ManagedAgentKind } from "./types";
import { builtInCapabilities, type CapabilityMetadata } from "./capabilities";
import {
  discoverPluginManifests,
  type DiscoveredPlugin,
  isActivePlugin,
  resolvePluginLifecycle,
  type PluginSource,
  type PluginTrustState,
} from "./plugin";
import { resolvePluginLocations, type PluginLocation } from "./plugin-locations";
import {
  readPluginSettingsStore,
  resolvePluginSettings,
  type PluginSettingsStore,
} from "./plugin-settings";
import {
  readPluginPermissionStore,
  resolveCapabilityPermissionGrants,
  type PluginPermissionStore,
} from "./plugin-permissions";
import {
  applyPluginState,
  readPluginStateStore,
  type PluginStateStore,
} from "./plugin-state";

export type PluginInventorySource = "core" | "bundled" | "localManifest";
export type PluginInventoryDistribution = "core" | "official" | "local" | "developer";

export interface PluginInventoryDependency {
  id: string;
  label: string;
  required: boolean;
  status: string;
  statusLabel: string;
  detail?: string;
}

export interface PluginInventorySettingsSummary {
  hasSettings: boolean;
  fieldCount: number;
  configuredCount: number;
  reviewRequired: boolean;
  configReviewRequired: boolean;
  validationErrors: string[];
}

export interface PluginInventoryRuntimeSummary {
  executableLoading: "disabled";
  canLoadEntrypoints: false;
  canGrantPermissions: false;
  reason: string;
}

export interface PluginInventoryPermissionSummary {
  requested: CapabilityMetadata["permissions"];
  granted: CapabilityMetadata["permissions"];
  missing: CapabilityMetadata["permissions"];
  status: "inactive" | "none" | "partial" | "granted";
}

export interface PluginInventoryItem {
  id: string;
  label: string;
  description: string;
  kind: CapabilityMetadata["kind"] | "core";
  categoryId: string;
  categoryLabel: string;
  source: PluginInventorySource;
  sourceLabel: string;
  distribution: PluginInventoryDistribution;
  distributionLabel: string;
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
  compatibility?: Record<string, unknown>;
  settings?: PluginInventorySettingsSummary;
  permissionGrants?: PluginInventoryPermissionSummary;
  runtime?: PluginInventoryRuntimeSummary;
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
    official: number;
    local: number;
    developer: number;
    disabled: number;
    untrusted: number;
  };
}

export interface PluginInventoryOptions {
  workspaceRoot: string;
  runtimeRoot?: string;
  env?: Record<string, string | undefined>;
  harnesses?: AgentHarnessDetection[];
  builtIns?: CapabilityMetadata[];
  pluginDirectories?: PluginLocation[];
  pluginStateStore?: PluginStateStore;
  pluginSettingsStore?: PluginSettingsStore;
  pluginPermissionStore?: PluginPermissionStore;
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
  const directories = options.pluginDirectories ?? resolvePluginLocations({ workspaceRoot: options.workspaceRoot, env: options.env ?? process.env });
  const { plugins, errors } = await discoverInventoryPlugins(directories);
  const pluginStateStore = options.pluginStateStore ?? (options.runtimeRoot ? await readPluginStateStore(options.runtimeRoot) : undefined);
  const pluginSettingsStore = options.pluginSettingsStore ?? (options.runtimeRoot ? await readPluginSettingsStore(options.runtimeRoot) : undefined);
  const pluginPermissionStore = options.pluginPermissionStore ?? (options.runtimeRoot ? await readPluginPermissionStore(options.runtimeRoot) : undefined);
  return buildPluginInventory({
    builtIns: options.builtIns ?? builtInCapabilities,
    errors,
    harnesses: options.harnesses,
    now: options.clock?.() ?? new Date().toISOString(),
    plugins,
    pluginStateStore,
    pluginSettingsStore,
    pluginPermissionStore,
  });
}

export function buildPluginInventory(input: {
  builtIns?: CapabilityMetadata[];
  errors?: PluginInventoryError[];
  harnesses?: AgentHarnessDetection[];
  now?: string;
  plugins?: DiscoveredPlugin[];
  pluginStateStore?: PluginStateStore;
  pluginSettingsStore?: PluginSettingsStore;
  pluginPermissionStore?: PluginPermissionStore;
}): PluginInventory {
  const harnessById = new Map((input.harnesses ?? []).map((harness) => [harness.id, harness]));
  const bundledItems = (input.builtIns ?? builtInCapabilities).map((capability) => {
    const harnessKind = managedAgentKindFromCapability(capability);
    return bundledCapabilityItem(capability, harnessKind ? harnessById.get(harnessKind) : undefined);
  });
  const plugins = (input.plugins ?? []).map((plugin) => applyPluginState(plugin, input.pluginStateStore));
  const localItems = plugins.flatMap((plugin) => pluginInventoryItems(plugin, input.pluginSettingsStore, input.pluginPermissionStore));
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
      official: items.filter((item) => item.distribution === "official").length,
      local: items.filter((item) => item.distribution === "local").length,
      developer: items.filter((item) => item.distribution === "developer").length,
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

async function discoverInventoryPlugins(directories: PluginLocation[]): Promise<{
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
          enabled: directory.enabled,
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
    kind: "core",
    categoryLabel: "Core",
    source: "core",
    sourceLabel: "Core",
    distribution: "core",
    distributionLabel: "Core",
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
    kind: capability.kind,
    categoryLabel: capabilityKindLabel(capability.kind),
    source: "bundled",
    sourceLabel: "Official plugin",
    distribution: "official",
    distributionLabel: "Official",
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
    compatibility: capability.compatibility,
  };
}

function pluginInventoryItems(
  plugin: DiscoveredPlugin,
  pluginSettingsStore: PluginSettingsStore | undefined,
  pluginPermissionStore: PluginPermissionStore | undefined,
): PluginInventoryItem[] {
  const settings = settingsSummary(plugin, pluginSettingsStore);
  const runtime = runtimeSummary(plugin);
  return plugin.manifest.capabilities.map((capability) => {
    const enabled = isActivePlugin(plugin) && capability.lifecycle !== "disabled";
    const permissionGrants = permissionSummary(plugin, capability.id, pluginPermissionStore);
    return {
      id: capability.id,
      label: capability.label,
      description: capability.description,
      categoryId: capability.kind,
      kind: capability.kind,
      categoryLabel: capabilityKindLabel(capability.kind),
      source: "localManifest",
      sourceLabel: sourceLabel(plugin.source),
      distribution: distributionForPluginSource(plugin.source),
      distributionLabel: distributionLabel(distributionForPluginSource(plugin.source)),
      lifecycle: capability.lifecycle,
      owner: capability.owner,
      surfaces: capability.surfaces,
      permissions: capability.permissions,
      enabled,
      trust: plugin.trust,
      status: !plugin.enabled ? "disabled" : plugin.trust === "untrusted" ? "review-required" : enabled ? "available" : "disabled",
      statusLabel: !plugin.enabled ? "Disabled" : plugin.trust === "untrusted" ? "Review required" : enabled ? "Available" : "Disabled",
      pluginId: plugin.manifest.id,
      pluginName: plugin.manifest.name,
      pluginSource: plugin.source,
      manifestPath: plugin.manifestPath,
      rootDirectory: plugin.rootDirectory,
      compatibility: capability.compatibility,
      settings,
      permissionGrants,
      runtime,
    };
  });
}

function runtimeSummary(plugin: DiscoveredPlugin): PluginInventoryRuntimeSummary {
  const lifecycle = resolvePluginLifecycle(plugin);
  return {
    executableLoading: lifecycle.executableLoading,
    canLoadEntrypoints: lifecycle.canLoadEntrypoints,
    canGrantPermissions: lifecycle.canGrantPermissions,
    reason: lifecycle.reason,
  };
}

function settingsSummary(plugin: DiscoveredPlugin, pluginSettingsStore: PluginSettingsStore | undefined): PluginInventorySettingsSummary {
  const settings = resolvePluginSettings(plugin, pluginSettingsStore);
  return {
    hasSettings: settings.hasSettings,
    fieldCount: settings.fieldCount,
    configuredCount: settings.configuredCount,
    reviewRequired: settings.reviewRequired,
    configReviewRequired: settings.configReviewRequired,
    validationErrors: settings.validationErrors,
  };
}

function permissionSummary(
  plugin: DiscoveredPlugin,
  capabilityId: string,
  pluginPermissionStore: PluginPermissionStore | undefined,
): PluginInventoryPermissionSummary {
  const grants = resolveCapabilityPermissionGrants(plugin, capabilityId, pluginPermissionStore);
  return {
    requested: grants.requestedPermissions,
    granted: grants.grantedPermissions,
    missing: grants.missingPermissions,
    status: grants.status,
  };
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
      return "Official plugin";
    case "dev":
      return "Developer manifest";
    case "user":
      return "Local user plugin";
    case "workspace":
      return "Local workspace plugin";
  }
}

function distributionForPluginSource(source: PluginSource): PluginInventoryDistribution {
  switch (source) {
    case "built-in":
      return "official";
    case "dev":
      return "developer";
    case "user":
    case "workspace":
      return "local";
  }
}

function distributionLabel(distribution: PluginInventoryDistribution): string {
  switch (distribution) {
    case "core":
      return "Core";
    case "official":
      return "Official";
    case "developer":
      return "Developer";
    case "local":
      return "Local";
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
