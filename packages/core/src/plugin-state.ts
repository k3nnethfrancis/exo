import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import type { DiscoveredPlugin, PluginSource, PluginTrustState } from "./plugin";

export const EXO_PLUGIN_STATE_FILE = "plugin-state.json";

export interface PluginStateIdentity {
  pluginId: string;
  source: PluginSource;
  rootDirectory: string;
  manifestPath: string;
  manifestHash: string;
}

export interface PluginStateRecord extends PluginStateIdentity {
  trust: PluginTrustState;
  enabled: boolean;
  reviewedAt?: string;
}

export interface PluginStateStore {
  version: 1;
  plugins: PluginStateRecord[];
}

export interface ResolvedPluginState {
  trust: PluginTrustState;
  enabled: boolean;
  status: "available" | "review-required" | "disabled";
  reviewRequired: boolean;
  record?: PluginStateRecord;
}

export function hashPluginManifest(rawManifest: string): string {
  return createHash("sha256").update(rawManifest).digest("hex");
}

export function pluginStateIdentity(plugin: DiscoveredPlugin): PluginStateIdentity {
  return {
    pluginId: plugin.manifest.id,
    source: plugin.source,
    rootDirectory: plugin.rootDirectory,
    manifestPath: plugin.manifestPath,
    manifestHash: plugin.manifestHash,
  };
}

export function pluginStateKey(identity: PluginStateIdentity): string {
  return createHash("sha256")
    .update(
      JSON.stringify({
        pluginId: identity.pluginId,
        source: identity.source,
        rootDirectory: path.resolve(identity.rootDirectory),
        manifestPath: path.resolve(identity.manifestPath),
        manifestHash: identity.manifestHash,
      }),
    )
    .digest("hex");
}

export function resolvePluginState(
  plugin: DiscoveredPlugin,
  store: PluginStateStore | undefined,
): ResolvedPluginState {
  const identity = pluginStateIdentity(plugin);
  const record = store?.plugins.find((candidate) => pluginStateKey(candidate) === pluginStateKey(identity));
  const trust = record?.trust ?? plugin.trust;
  const enabled = record?.enabled ?? plugin.enabled;
  const reviewRequired = enabled && trust === "untrusted";
  return {
    trust,
    enabled,
    status: !enabled ? "disabled" : reviewRequired ? "review-required" : "available",
    reviewRequired,
    record,
  };
}

export function applyPluginState(plugin: DiscoveredPlugin, store: PluginStateStore | undefined): DiscoveredPlugin {
  const state = resolvePluginState(plugin, store);
  return {
    ...plugin,
    trust: state.trust,
    enabled: state.enabled,
  };
}

export function upsertPluginStateRecord(
  store: PluginStateStore,
  plugin: DiscoveredPlugin,
  patch: {
    trust?: PluginTrustState;
    enabled?: boolean;
    reviewedAt?: string | null;
  },
): PluginStateStore {
  const identity = pluginStateIdentity(plugin);
  const current = resolvePluginState(plugin, store);
  const nextRecord: PluginStateRecord = {
    ...identity,
    trust: patch.trust ?? current.trust,
    enabled: patch.enabled ?? current.enabled,
    reviewedAt: patch.reviewedAt === undefined ? current.record?.reviewedAt : patch.reviewedAt === null ? undefined : patch.reviewedAt,
  };
  const nextKey = pluginStateKey(nextRecord);
  const plugins = [
    ...store.plugins.filter((record) => pluginStateKey(record) !== nextKey),
    nextRecord,
  ].sort((a, b) => `${a.source}:${a.pluginId}:${a.rootDirectory}`.localeCompare(`${b.source}:${b.pluginId}:${b.rootDirectory}`));
  return validatePluginStateStore({ version: 1, plugins });
}

export function pluginStatePath(runtimeRoot: string): string {
  return path.join(runtimeRoot, EXO_PLUGIN_STATE_FILE);
}

export async function readPluginStateStore(runtimeRoot: string): Promise<PluginStateStore> {
  try {
    const raw = await readFile(pluginStatePath(runtimeRoot), "utf8");
    return validatePluginStateStore(JSON.parse(raw));
  } catch (error) {
    if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") {
      return emptyPluginStateStore();
    }
    throw error;
  }
}

export async function writePluginStateStore(runtimeRoot: string, store: PluginStateStore): Promise<void> {
  await mkdir(runtimeRoot, { recursive: true });
  await writeFile(pluginStatePath(runtimeRoot), `${JSON.stringify(validatePluginStateStore(store), null, 2)}\n`, "utf8");
}

export function emptyPluginStateStore(): PluginStateStore {
  return { version: 1, plugins: [] };
}

export function validatePluginStateStore(input: unknown): PluginStateStore {
  if (!isRecord(input) || input.version !== 1 || !Array.isArray(input.plugins)) {
    throw new Error("Plugin state store must be a version 1 object with plugins.");
  }
  return {
    version: 1,
    plugins: input.plugins.map(validatePluginStateRecord),
  };
}

function validatePluginStateRecord(input: unknown): PluginStateRecord {
  if (!isRecord(input)) {
    throw new Error("Plugin state record must be an object.");
  }
  const record: PluginStateRecord = {
    pluginId: requiredString(input, "pluginId"),
    source: validateSource(requiredString(input, "source")),
    rootDirectory: requiredString(input, "rootDirectory"),
    manifestPath: requiredString(input, "manifestPath"),
    manifestHash: requiredString(input, "manifestHash"),
    trust: validateTrust(requiredString(input, "trust")),
    enabled: requiredBoolean(input, "enabled"),
    reviewedAt: optionalString(input, "reviewedAt"),
  };
  return record;
}

function validateSource(value: string): PluginSource {
  if (value !== "built-in" && value !== "dev" && value !== "user" && value !== "workspace") {
    throw new Error(`Plugin state source contains unsupported value: ${value}`);
  }
  return value;
}

function validateTrust(value: string): PluginTrustState {
  if (value !== "trusted" && value !== "untrusted") {
    throw new Error(`Plugin state trust contains unsupported value: ${value}`);
  }
  return value;
}

function requiredString(record: Record<string, unknown>, key: string): string {
  const value = record[key];
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(`Plugin state field ${key} must be a non-empty string.`);
  }
  return value;
}

function optionalString(record: Record<string, unknown>, key: string): string | undefined {
  const value = record[key];
  if (value === undefined) {
    return undefined;
  }
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(`Plugin state field ${key} must be a non-empty string when provided.`);
  }
  return value;
}

function requiredBoolean(record: Record<string, unknown>, key: string): boolean {
  const value = record[key];
  if (typeof value !== "boolean") {
    throw new Error(`Plugin state field ${key} must be a boolean.`);
  }
  return value;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
