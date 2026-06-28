import path from "node:path";

import type { PluginSource, PluginTrustState } from "./plugin";

export const EXO_PLUGIN_DIRECTORY_NAME = "plugins";
export const EXO_WORKSPACE_PLUGIN_DIRECTORY = path.join(".exo", EXO_PLUGIN_DIRECTORY_NAME);

export type PluginLocationKind = "resources" | "source" | "dev-env" | "operator-env" | "user" | "workspace";
export type PluginLocationPurpose = "bundled-install" | "developer-load" | "local-install";

export interface PluginLocation {
  path: string;
  source: PluginSource;
  trust: PluginTrustState;
  enabled: boolean;
  kind: PluginLocationKind;
  purpose?: PluginLocationPurpose;
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
    locations.push(trustedLocation(path.join(resourcesRoot, EXO_PLUGIN_DIRECTORY_NAME), "built-in", "resources", "bundled-install"));
  }
  if (sourceRoot) {
    locations.push(trustedLocation(path.join(sourceRoot, EXO_PLUGIN_DIRECTORY_NAME), "built-in", "source", "bundled-install"));
  }

  locations.push(
    ...splitPathList(env.EXO_DEV_PLUGIN_DIRS).map((directory): PluginLocation =>
      trustedLocation(directory, "dev", "dev-env", "developer-load"),
    ),
  );
  locations.push(
    ...splitPathList(env.EXO_PLUGIN_DIRS).map((directory): PluginLocation =>
      trustedLocation(directory, "dev", "operator-env", "developer-load"),
    ),
  );

  if (env.EXO_USER_DATA_PATH) {
    locations.push({
      path: path.join(env.EXO_USER_DATA_PATH, EXO_PLUGIN_DIRECTORY_NAME),
      source: "user",
      trust: "untrusted",
      enabled: true,
      kind: "user",
      purpose: "local-install",
    });
  }
  locations.push({
    path: path.join(options.workspaceRoot, EXO_WORKSPACE_PLUGIN_DIRECTORY),
    source: "workspace",
    trust: "untrusted",
    enabled: true,
    kind: "workspace",
    purpose: "local-install",
  });

  return dedupeLocations(locations);
}

export function splitPluginPathList(rawValue: string | undefined): string[] {
  return splitPathList(rawValue);
}

function trustedLocation(
  directory: string,
  source: PluginSource,
  kind: PluginLocationKind,
  purpose: PluginLocationPurpose,
): PluginLocation {
  return {
    path: directory,
    source,
    trust: "trusted",
    enabled: true,
    kind,
    purpose,
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
