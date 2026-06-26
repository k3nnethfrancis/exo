import { readFile, readdir } from "node:fs/promises";
import path from "node:path";

import type {
  CapabilityKind,
  CapabilityLifecycle,
  CapabilityMetadata,
  CapabilityPermission,
  CapabilitySurface,
} from "./capabilities";

export const EXO_PLUGIN_MANIFEST_FILE = "exo.plugin.json";

export type PluginSource = "built-in" | "dev" | "user" | "workspace";
export type PluginTrustState = "trusted" | "untrusted" | "disabled";

export interface PluginEntrypoints {
  main?: string;
  renderer?: string;
  webview?: string;
}

export interface PluginManifest {
  id: string;
  name: string;
  version: string;
  exoApiVersion: string;
  description?: string;
  entrypoints?: PluginEntrypoints;
  capabilities: CapabilityMetadata[];
  permissions: CapabilityPermission[];
  surfaces: CapabilitySurface[];
  settingsSchema?: Record<string, unknown>;
}

export interface DiscoveredPlugin {
  manifest: PluginManifest;
  manifestPath: string;
  rootDirectory: string;
  source: PluginSource;
  trust: PluginTrustState;
}

const CAPABILITY_KINDS = [
  "searchProvider",
  "agentHarness",
  "profile",
  "analyzer",
  "traceCollector",
  "datasetExporter",
  "evalRunner",
  "routineTemplate",
  "graphVisualization",
] satisfies CapabilityKind[];

const CAPABILITY_LIFECYCLES = ["built-in", "experimental", "disabled"] satisfies CapabilityLifecycle[];

const CAPABILITY_SURFACES = ["desktop", "cli", "mcp", "commandServer", "internal"] satisfies CapabilitySurface[];

const CAPABILITY_PERMISSIONS = [
  "workspace:read",
  "notes:read",
  "notes:write",
  "projects:read",
  "projects:write",
  "terminals:launch",
  "agents:launch",
  "network:access",
  "artifacts:write",
] satisfies CapabilityPermission[];

export class PluginRegistry {
  private readonly plugins = new Map<string, DiscoveredPlugin>();
  private readonly capabilityIds = new Map<string, string>();

  constructor(plugins: DiscoveredPlugin[] = []) {
    this.registerMany(plugins);
  }

  register(plugin: DiscoveredPlugin): void {
    const id = plugin.manifest.id;
    if (this.plugins.has(id)) {
      throw new Error(`Plugin already registered: ${id}`);
    }
    // Disabled plugins remain inspectable for management UI, but their capabilities
    // must not reserve ids or appear active while a user has explicitly turned them off.
    if (plugin.trust !== "disabled") {
      for (const capability of plugin.manifest.capabilities) {
        const existingPluginId = this.capabilityIds.get(capability.id);
        if (existingPluginId) {
          throw new Error(`Plugin capability already registered: ${capability.id} (${existingPluginId})`);
        }
      }
    }
    this.plugins.set(id, plugin);
    if (plugin.trust !== "disabled") {
      for (const capability of plugin.manifest.capabilities) {
        this.capabilityIds.set(capability.id, id);
      }
    }
  }

  registerMany(plugins: DiscoveredPlugin[]): void {
    for (const plugin of plugins) {
      this.register(plugin);
    }
  }

  get(id: string): DiscoveredPlugin | undefined {
    return this.plugins.get(id);
  }

  require(id: string): DiscoveredPlugin {
    const plugin = this.get(id);
    if (!plugin) {
      throw new Error(`Plugin is not registered: ${id}`);
    }
    return plugin;
  }

  list(options: { includeDisabled?: boolean; trustedOnly?: boolean } = {}): DiscoveredPlugin[] {
    return [...this.plugins.values()].filter((plugin) => {
      if (!options.includeDisabled && plugin.trust === "disabled") {
        return false;
      }
      if (options.trustedOnly && plugin.trust !== "trusted") {
        return false;
      }
      return true;
    });
  }

  listCapabilities(options: { includeDisabled?: boolean; trustedOnly?: boolean } = {}): CapabilityMetadata[] {
    return this.list(options).flatMap((plugin) => plugin.manifest.capabilities);
  }
}

export async function discoverPluginManifests(
  directories: string[],
  options: { source: PluginSource; trust?: PluginTrustState },
): Promise<DiscoveredPlugin[]> {
  const discovered: DiscoveredPlugin[] = [];
  for (const directory of directories) {
    const entries = await safeReadDirectories(directory);
    for (const entry of entries) {
      const rootDirectory = path.join(directory, entry);
      const manifestPath = path.join(rootDirectory, EXO_PLUGIN_MANIFEST_FILE);
      const manifest = await readPluginManifest(manifestPath);
      if (!manifest) {
        continue;
      }
      discovered.push({
        manifest,
        manifestPath,
        rootDirectory,
        source: options.source,
        trust: options.trust ?? defaultPluginTrust(options.source),
      });
    }
  }
  return discovered;
}

export async function readPluginManifest(manifestPath: string): Promise<PluginManifest | null> {
  try {
    // Plugin discovery is metadata-only for now. Reading manifests lets Exo show
    // capabilities without executing arbitrary user/workspace plugin code.
    return parsePluginManifest(await readFile(manifestPath, "utf8"));
  } catch (error) {
    if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") {
      return null;
    }
    throw error;
  }
}

export function parsePluginManifest(raw: string): PluginManifest {
  return validatePluginManifest(JSON.parse(raw));
}

export function validatePluginManifest(input: unknown): PluginManifest {
  if (!isRecord(input)) {
    throw new Error("Plugin manifest must be an object.");
  }
  const manifest: PluginManifest = {
    id: requiredString(input, "id"),
    name: requiredString(input, "name"),
    version: requiredString(input, "version"),
    exoApiVersion: requiredString(input, "exoApiVersion"),
    description: optionalString(input, "description"),
    entrypoints: validateEntrypoints(input.entrypoints),
    capabilities: validateCapabilities(input.capabilities),
    permissions: validatePermissions(input.permissions, "permissions"),
    surfaces: validateSurfaces(input.surfaces, "surfaces"),
    settingsSchema: isRecord(input.settingsSchema) ? input.settingsSchema : undefined,
  };

  assertIdentifier(manifest.id, "Plugin id");
  if (manifest.capabilities.length === 0) {
    throw new Error(`Plugin manifest ${manifest.id} must declare at least one capability.`);
  }
  const capabilityIds = new Set<string>();
  for (const capability of manifest.capabilities) {
    if (capabilityIds.has(capability.id)) {
      throw new Error(`Plugin manifest ${manifest.id} declares duplicate capability: ${capability.id}`);
    }
    capabilityIds.add(capability.id);
  }
  return manifest;
}

export function defaultPluginTrust(source: PluginSource): PluginTrustState {
  switch (source) {
    case "built-in":
    case "dev":
      return "trusted";
    case "user":
    case "workspace":
      return "untrusted";
  }
}

async function safeReadDirectories(directory: string): Promise<string[]> {
  try {
    const entries = await readdir(directory, { withFileTypes: true });
    return entries
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
      .sort();
  } catch (error) {
    if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") {
      return [];
    }
    throw error;
  }
}

function validateEntrypoints(input: unknown): PluginEntrypoints | undefined {
  if (input === undefined) {
    return undefined;
  }
  if (!isRecord(input)) {
    throw new Error("Plugin manifest entrypoints must be an object.");
  }
  return {
    main: optionalString(input, "main"),
    renderer: optionalString(input, "renderer"),
    webview: optionalString(input, "webview"),
  };
}

function validateCapabilities(input: unknown): CapabilityMetadata[] {
  if (!Array.isArray(input)) {
    throw new Error("Plugin manifest capabilities must be an array.");
  }
  return input.map(validateCapabilityMetadata);
}

function validateCapabilityMetadata(input: unknown): CapabilityMetadata {
  if (!isRecord(input)) {
    throw new Error("Plugin capability must be an object.");
  }
  const capability: CapabilityMetadata = {
    id: requiredString(input, "id"),
    kind: validateEnum(requiredString(input, "kind"), CAPABILITY_KINDS, "capability.kind"),
    label: requiredString(input, "label"),
    description: requiredString(input, "description"),
    lifecycle: validateEnum(requiredString(input, "lifecycle"), CAPABILITY_LIFECYCLES, "capability.lifecycle"),
    owner: requiredString(input, "owner"),
    surfaces: validateSurfaces(input.surfaces, "capability.surfaces"),
    permissions: validatePermissions(input.permissions, "capability.permissions"),
    compatibility: isRecord(input.compatibility) ? input.compatibility : undefined,
  };
  assertIdentifier(capability.id, "Capability id");
  return capability;
}

function requiredString(record: Record<string, unknown>, key: string): string {
  const value = record[key];
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(`Plugin manifest field ${key} must be a non-empty string.`);
  }
  return value;
}

function optionalString(record: Record<string, unknown>, key: string): string | undefined {
  const value = record[key];
  if (value === undefined) {
    return undefined;
  }
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(`Plugin manifest field ${key} must be a non-empty string when provided.`);
  }
  return value;
}

function validateStringArray(input: unknown, field: string): string[] {
  if (!Array.isArray(input) || !input.every((value) => typeof value === "string" && value.trim().length > 0)) {
    throw new Error(`Plugin manifest field ${field} must be an array of non-empty strings.`);
  }
  return input;
}

function validateSurfaces(input: unknown, field: string): CapabilitySurface[] {
  return validateStringArray(input, field).map((value) => validateEnum(value, CAPABILITY_SURFACES, field));
}

function validatePermissions(input: unknown, field: string): CapabilityPermission[] {
  return validateStringArray(input, field).map((value) => validateEnum(value, CAPABILITY_PERMISSIONS, field));
}

function validateEnum<const T extends string>(value: string, allowed: readonly T[], field: string): T {
  if (!allowed.includes(value as T)) {
    throw new Error(`Plugin manifest field ${field} contains unsupported value: ${value}`);
  }
  return value as T;
}

function assertIdentifier(value: string, label: string): void {
  if (!/^[a-z][a-z0-9.-]*$/.test(value)) {
    throw new Error(`${label} must be lowercase alphanumeric with dots or hyphens: ${value}`);
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
