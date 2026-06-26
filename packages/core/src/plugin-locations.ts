import path from "node:path";

import type { PluginSource, PluginTrustState } from "./plugin";

export type PluginLocationKind = "resources" | "source" | "dev-env" | "operator-env" | "user" | "workspace";

export interface PluginLocation {
  path: string;
  source: PluginSource;
  trust: PluginTrustState;
  enabled: boolean;
  kind: PluginLocationKind;
}

export interface PluginLocationResolverOptions {
  workspaceRoot: string;
  env?: Record<string, string | undefined>;
  sourceRoot?: string;
  resourcesRoot?: string;
}

export function resolvePluginLocations(options: PluginLocationResolverOptions): PluginLocation[] {
  const env = options.env ?? process.env;
  const locations: PluginLocation[] = [];
  const sourceRoot = options.sourceRoot ?? env.EXO_PROJECT_ROOT;
  const resourcesRoot = options.resourcesRoot ?? env.EXO_RESOURCES_PATH;

  if (resourcesRoot) {
    locations.push(trustedLocation(path.join(resourcesRoot, "plugins"), "built-in", "resources"));
  }
  if (sourceRoot) {
    locations.push(trustedLocation(path.join(sourceRoot, "plugins"), "built-in", "source"));
  }

  locations.push(
    ...splitPathList(env.EXO_DEV_PLUGIN_DIRS).map((directory): PluginLocation =>
      trustedLocation(directory, "dev", "dev-env"),
    ),
  );
  locations.push(
    ...splitPathList(env.EXO_PLUGIN_DIRS).map((directory): PluginLocation =>
      trustedLocation(directory, "dev", "operator-env"),
    ),
  );

  if (env.EXO_USER_DATA_PATH) {
    locations.push({
      path: path.join(env.EXO_USER_DATA_PATH, "plugins"),
      source: "user",
      trust: "untrusted",
      enabled: true,
      kind: "user",
    });
  }
  locations.push({
    path: path.join(options.workspaceRoot, ".exo", "plugins"),
    source: "workspace",
    trust: "untrusted",
    enabled: true,
    kind: "workspace",
  });

  return dedupeLocations(locations);
}

export function splitPluginPathList(rawValue: string | undefined): string[] {
  return splitPathList(rawValue);
}

function trustedLocation(directory: string, source: PluginSource, kind: PluginLocationKind): PluginLocation {
  return {
    path: directory,
    source,
    trust: "trusted",
    enabled: true,
    kind,
  };
}

function splitPathList(rawValue: string | undefined): string[] {
  return rawValue?.split(path.delimiter).filter(Boolean).map((entry) => path.resolve(entry)) ?? [];
}

function dedupeLocations(locations: PluginLocation[]): PluginLocation[] {
  const seen = new Set<string>();
  return locations.filter((location) => {
    const key = path.resolve(location.path);
    if (seen.has(key)) {
      return false;
    }
    seen.add(key);
    return true;
  });
}
