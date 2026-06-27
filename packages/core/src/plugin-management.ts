import {
  discoverPluginManifests,
  type DiscoveredPlugin,
  isActivePlugin,
  type PluginSettingValue,
} from "./plugin";
import { resolvePluginLocations, type PluginLocation } from "./plugin-locations";
import {
  readPluginSettingsStore,
  resetPluginSettingsStore,
  resolvePluginSettings,
  updatePluginSettingsStore,
  writePluginSettingsStore,
  type ResolvedPluginSettings,
} from "./plugin-settings";
import {
  readPluginStateStore,
  applyPluginState,
  resolvePluginState,
  upsertPluginStateRecord,
  writePluginStateStore,
  type ResolvedPluginState,
} from "./plugin-state";

export type PluginStateAction = "enable" | "disable" | "trust" | "untrust";

export interface PluginStateActionResult {
  action: PluginStateAction;
  pluginId: string;
  capabilityIds: string[];
  state: ResolvedPluginState;
}

export interface PluginStateActionOptions {
  workspaceRoot: string;
  runtimeRoot: string;
  pluginId: string;
  action: PluginStateAction;
  source?: DiscoveredPlugin["source"];
  manifestPath?: string;
  rootDirectory?: string;
  env?: Record<string, string | undefined>;
  pluginDirectories?: PluginLocation[];
  now?: () => string;
}

export interface PluginSettingsActionOptions {
  workspaceRoot: string;
  runtimeRoot: string;
  pluginId: string;
  source?: DiscoveredPlugin["source"];
  manifestPath?: string;
  rootDirectory?: string;
  values?: Record<string, PluginSettingValue>;
  env?: Record<string, string | undefined>;
  pluginDirectories?: PluginLocation[];
  now?: () => string;
}

export interface PluginSettingsActionResult {
  pluginId: string;
  settings: ResolvedPluginSettings;
}

export async function applyPluginStateAction(options: PluginStateActionOptions): Promise<PluginStateActionResult> {
  const plugins = await discoverManagedPlugins(options);
  const plugin = findPlugin(plugins, options);
  if (!plugin) {
    throw new Error(`Plugin not found: ${options.pluginId}`);
  }
  if (plugin.source === "built-in") {
    throw new Error(`Official plugin manifests are read-only in Plugin Enablement v0: ${plugin.manifest.id}`);
  }

  const store = await readPluginStateStore(options.runtimeRoot);
  const nextStore = upsertPluginStateRecord(store, plugin, patchForAction(options.action, options.now?.() ?? new Date().toISOString()));
  await writePluginStateStore(options.runtimeRoot, nextStore);

  return {
    action: options.action,
    pluginId: plugin.manifest.id,
    capabilityIds: plugin.manifest.capabilities.map((capability) => capability.id),
    state: resolvePluginState(plugin, nextStore),
  };
}

export async function updateManagedPluginSettings(options: PluginSettingsActionOptions): Promise<PluginSettingsActionResult> {
  const plugin = await requireConfigurablePlugin(options);
  const store = await readPluginSettingsStore(options.runtimeRoot);
  const nextStore = updatePluginSettingsStore(store, plugin, options.values ?? {}, options.now?.() ?? new Date().toISOString());
  await writePluginSettingsStore(options.runtimeRoot, nextStore);
  return {
    pluginId: plugin.manifest.id,
    settings: resolvePluginSettings(plugin, nextStore),
  };
}

export async function readManagedPluginSettings(options: Omit<PluginSettingsActionOptions, "values">): Promise<PluginSettingsActionResult> {
  const plugin = await requireConfigurablePlugin(options);
  const store = await readPluginSettingsStore(options.runtimeRoot);
  return {
    pluginId: plugin.manifest.id,
    settings: resolvePluginSettings(plugin, store),
  };
}

export async function resetManagedPluginSettings(options: Omit<PluginSettingsActionOptions, "values">): Promise<PluginSettingsActionResult> {
  const plugin = await requireConfigurablePlugin(options);
  const store = await readPluginSettingsStore(options.runtimeRoot);
  const nextStore = resetPluginSettingsStore(store, plugin, options.now?.() ?? new Date().toISOString());
  await writePluginSettingsStore(options.runtimeRoot, nextStore);
  return {
    pluginId: plugin.manifest.id,
    settings: resolvePluginSettings(plugin, nextStore),
  };
}

export async function discoverManagedPlugins(options: {
  workspaceRoot: string;
  env?: Record<string, string | undefined>;
  pluginDirectories?: PluginLocation[];
}): Promise<DiscoveredPlugin[]> {
  const directories = options.pluginDirectories ?? resolvePluginLocations({ workspaceRoot: options.workspaceRoot, env: options.env ?? process.env });
  const plugins: DiscoveredPlugin[] = [];
  for (const directory of directories) {
    plugins.push(
      ...(await discoverPluginManifests([directory.path], {
        source: directory.source,
        trust: directory.trust,
        enabled: directory.enabled,
      })),
    );
  }
  return plugins;
}

function findPlugin(plugins: DiscoveredPlugin[], options: Pick<PluginStateActionOptions, "pluginId" | "source" | "manifestPath" | "rootDirectory">): DiscoveredPlugin | undefined {
  return plugins.find((plugin) =>
    (plugin.manifest.id === options.pluginId || plugin.manifest.capabilities.some((capability) => capability.id === options.pluginId))
    && (!options.source || plugin.source === options.source)
    && (!options.manifestPath || plugin.manifestPath === options.manifestPath)
    && (!options.rootDirectory || plugin.rootDirectory === options.rootDirectory),
  );
}

async function requireConfigurablePlugin(options: PluginSettingsActionOptions | Omit<PluginSettingsActionOptions, "values">): Promise<DiscoveredPlugin> {
  const plugins = await discoverManagedPlugins(options);
  const discoveredPlugin = findPlugin(plugins, options);
  if (!discoveredPlugin) {
    throw new Error(`Plugin not found: ${options.pluginId}`);
  }
  const pluginStateStore = await readPluginStateStore(options.runtimeRoot);
  const plugin = applyPluginState(discoveredPlugin, pluginStateStore);
  if (!isActivePlugin(plugin)) {
    throw new Error(`Plugin settings require a trusted and enabled plugin: ${plugin.manifest.id}`);
  }
  if (!plugin.manifest.settingsSchema || plugin.manifest.settingsSchema.fields.length === 0) {
    throw new Error(`Plugin does not declare settings: ${plugin.manifest.id}`);
  }
  return plugin;
}

function patchForAction(action: PluginStateAction, reviewedAt: string) {
  switch (action) {
    case "enable":
      return { enabled: true };
    case "disable":
      return { enabled: false };
    case "trust":
      return { trust: "trusted" as const, enabled: true, reviewedAt };
    case "untrust":
      return { trust: "untrusted" as const, reviewedAt: null };
  }
}
