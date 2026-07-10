import { discoverPluginManifests, type DiscoveredPlugin } from "./plugin";
import { resolvePluginLocations, type PluginLocation } from "./plugin-locations";

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
