import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import type { CapabilityPermission, PermissionGrant } from "./capabilities";
import { describeCapabilityPermission, isSupportedCapability, normalizeCapabilityPermission } from "./capabilities";
import type { DiscoveredPlugin } from "./plugin";
import { isActivePlugin } from "./plugin";

export const EXO_PLUGIN_PERMISSIONS_FILE = "plugin-permissions.json";

export interface PluginPermissionIdentity {
  pluginId: string;
  source: DiscoveredPlugin["source"];
  rootDirectory: string;
  manifestPath: string;
  manifestHash: string;
}

export type PluginPermissionDecisionAction = "grant" | "revoke";

export interface PluginPermissionDecision {
  permission: CapabilityPermission;
  action: PluginPermissionDecisionAction;
  decidedAt: string;
  reason?: string;
}

export interface PluginPermissionRecord extends PluginPermissionIdentity {
  decisions: PluginPermissionDecision[];
}

export interface PluginPermissionStore {
  version: 1;
  plugins: PluginPermissionRecord[];
}

export interface ResolvedPluginPermissionGrants {
  pluginId: string;
  active: boolean;
  requestedPermissions: CapabilityPermission[];
  grantedPermissions: CapabilityPermission[];
  missingPermissions: CapabilityPermission[];
  status: "inactive" | "none" | "partial" | "granted";
  record?: PluginPermissionRecord;
}

export interface ResolvedCapabilityPermissionGrants extends ResolvedPluginPermissionGrants {
  capabilityId: string;
}

export function parsePluginPermission(permission: string): PermissionGrant {
  return describeCapabilityPermission(normalizeCapabilityPermission(permission));
}

export function normalizePluginPermission(permission: string): CapabilityPermission {
  return normalizeCapabilityPermission(permission);
}

export function pluginPermissionIdentity(plugin: DiscoveredPlugin): PluginPermissionIdentity {
  return {
    pluginId: plugin.manifest.id,
    source: plugin.source,
    rootDirectory: plugin.rootDirectory,
    manifestPath: plugin.manifestPath,
    manifestHash: plugin.manifestHash,
  };
}

export function pluginPermissionKey(identity: PluginPermissionIdentity): string {
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

export function pluginPermissionsPath(runtimeRoot: string): string {
  return path.join(runtimeRoot, EXO_PLUGIN_PERMISSIONS_FILE);
}

export async function readPluginPermissionStore(runtimeRoot: string): Promise<PluginPermissionStore> {
  try {
    const raw = await readFile(pluginPermissionsPath(runtimeRoot), "utf8");
    return validatePluginPermissionStore(JSON.parse(raw));
  } catch (error) {
    if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") {
      return emptyPluginPermissionStore();
    }
    throw error;
  }
}

export async function writePluginPermissionStore(runtimeRoot: string, store: PluginPermissionStore): Promise<void> {
  await mkdir(runtimeRoot, { recursive: true });
  await writeFile(pluginPermissionsPath(runtimeRoot), `${JSON.stringify(validatePluginPermissionStore(store), null, 2)}\n`, "utf8");
}

export function emptyPluginPermissionStore(): PluginPermissionStore {
  return { version: 1, plugins: [] };
}

export function resolvePluginPermissionGrants(
  plugin: DiscoveredPlugin,
  store: PluginPermissionStore | undefined,
): ResolvedPluginPermissionGrants {
  const requestedPermissions = requestedPluginPermissions(plugin);
  const record = findPluginPermissionRecord(plugin, store);
  const active = isActivePlugin(plugin);
  const grantedPermissions = active && record
    ? requestedPermissions.filter((permission) => effectivePermissionSet(record).has(permission))
    : [];
  const missingPermissions = requestedPermissions.filter((permission) => !grantedPermissions.includes(permission));
  return {
    pluginId: plugin.manifest.id,
    active,
    requestedPermissions,
    grantedPermissions,
    missingPermissions,
    status: !active ? "inactive" : grantedPermissions.length === 0 ? "none" : missingPermissions.length === 0 ? "granted" : "partial",
    record,
  };
}

export function resolveCapabilityPermissionGrants(
  plugin: DiscoveredPlugin,
  capabilityId: string,
  store: PluginPermissionStore | undefined,
): ResolvedCapabilityPermissionGrants {
  const capability = plugin.manifest.capabilities.find((candidate) => candidate.id === capabilityId);
  if (!capability) {
    throw new Error(`Plugin capability is not declared by ${plugin.manifest.id}: ${capabilityId}`);
  }
  const requestedPermissions = uniquePermissions(capability.permissions);
  const pluginGrants = resolvePluginPermissionGrants(plugin, store);
  const active = pluginGrants.active && isSupportedCapability(capability) && capability.lifecycle !== "disabled";
  const grantedPermissions = active
    ? requestedPermissions.filter((permission) => pluginGrants.grantedPermissions.includes(permission))
    : [];
  const missingPermissions = requestedPermissions.filter((permission) => !grantedPermissions.includes(permission));
  return {
    ...pluginGrants,
    capabilityId,
    active,
    requestedPermissions,
    grantedPermissions,
    missingPermissions,
    status: !active ? "inactive" : grantedPermissions.length === 0 ? "none" : missingPermissions.length === 0 ? "granted" : "partial",
  };
}

export function hasGrantedPluginPermission(
  plugin: DiscoveredPlugin,
  store: PluginPermissionStore | undefined,
  permission: CapabilityPermission,
): boolean {
  return resolvePluginPermissionGrants(plugin, store).grantedPermissions.includes(permission);
}

export function hasGrantedCapabilityPermission(
  plugin: DiscoveredPlugin,
  capabilityId: string,
  store: PluginPermissionStore | undefined,
  permission: CapabilityPermission,
): boolean {
  return resolveCapabilityPermissionGrants(plugin, capabilityId, store).grantedPermissions.includes(permission);
}

export function grantPluginPermissions(
  store: PluginPermissionStore,
  plugin: DiscoveredPlugin,
  permissions: CapabilityPermission[],
  decidedAt = new Date().toISOString(),
  reason?: string,
): PluginPermissionStore {
  if (!isActivePlugin(plugin)) {
    throw new Error(`Cannot grant permissions to inactive plugin: ${plugin.manifest.id}`);
  }
  const requested = requestedPluginPermissions(plugin);
  const normalized = normalizeRequestedPermissions(permissions, requested, "grant");
  return appendPermissionDecisions(store, plugin, normalized.map((permission) => decision(permission, "grant", decidedAt, reason)));
}

export function revokePluginPermissions(
  store: PluginPermissionStore,
  plugin: DiscoveredPlugin,
  permissions: CapabilityPermission[],
  decidedAt = new Date().toISOString(),
  reason?: string,
): PluginPermissionStore {
  const requested = requestedPluginPermissions(plugin);
  const normalized = normalizeRequestedPermissions(permissions, requested, "revoke");
  return appendPermissionDecisions(store, plugin, normalized.map((permission) => decision(permission, "revoke", decidedAt, reason)));
}

export function validatePluginPermissionStore(input: unknown): PluginPermissionStore {
  if (!isRecord(input) || input.version !== 1 || !Array.isArray(input.plugins)) {
    throw new Error("Plugin permission store must be a version 1 object with plugins.");
  }
  return {
    version: 1,
    plugins: input.plugins.map(validatePluginPermissionRecord),
  };
}

function appendPermissionDecisions(
  store: PluginPermissionStore,
  plugin: DiscoveredPlugin,
  decisions: PluginPermissionDecision[],
): PluginPermissionStore {
  const identity = pluginPermissionIdentity(plugin);
  const existing = findPluginPermissionRecord(plugin, store);
  const record: PluginPermissionRecord = {
    ...identity,
    decisions: [...(existing?.decisions ?? []), ...decisions],
  };
  const nextKey = pluginPermissionKey(record);
  const plugins = [
    ...store.plugins.filter((candidate) => pluginPermissionKey(candidate) !== nextKey),
    record,
  ].sort((a, b) => `${a.source}:${a.pluginId}:${a.rootDirectory}`.localeCompare(`${b.source}:${b.pluginId}:${b.rootDirectory}`));
  return validatePluginPermissionStore({ version: 1, plugins });
}

function requestedPluginPermissions(plugin: DiscoveredPlugin): CapabilityPermission[] {
  return uniquePermissions([
    ...plugin.manifest.permissions,
    ...plugin.manifest.capabilities.filter(isSupportedCapability).flatMap((capability) => capability.permissions),
  ]);
}

function uniquePermissions(permissions: CapabilityPermission[]): CapabilityPermission[] {
  return [...new Set(permissions)].sort();
}

function normalizeRequestedPermissions(
  permissions: CapabilityPermission[],
  requested: CapabilityPermission[],
  action: PluginPermissionDecisionAction,
): CapabilityPermission[] {
  if (permissions.length === 0) {
    throw new Error(`Plugin permission ${action} requires at least one permission.`);
  }
  const normalized = uniquePermissions(permissions.map(validatePermission));
  const unsupported = normalized.filter((permission) => !requested.includes(permission));
  if (unsupported.length > 0) {
    throw new Error(`Cannot ${action} permissions not requested by plugin manifest: ${unsupported.join(", ")}`);
  }
  return normalized;
}

function effectivePermissionSet(record: PluginPermissionRecord): Set<CapabilityPermission> {
  const permissions = new Set<CapabilityPermission>();
  for (const entry of record.decisions) {
    if (entry.action === "grant") {
      permissions.add(entry.permission);
    } else {
      permissions.delete(entry.permission);
    }
  }
  return permissions;
}

function decision(
  permission: CapabilityPermission,
  action: PluginPermissionDecisionAction,
  decidedAt: string,
  reason: string | undefined,
): PluginPermissionDecision {
  return reason === undefined ? { permission, action, decidedAt } : { permission, action, decidedAt, reason };
}

function findPluginPermissionRecord(
  plugin: DiscoveredPlugin,
  store: PluginPermissionStore | undefined,
): PluginPermissionRecord | undefined {
  const identity = pluginPermissionIdentity(plugin);
  return store?.plugins.find((candidate) => pluginPermissionKey(candidate) === pluginPermissionKey(identity));
}

function validatePluginPermissionRecord(input: unknown): PluginPermissionRecord {
  if (!isRecord(input) || !Array.isArray(input.decisions)) {
    throw new Error("Plugin permission record must be an object with decisions.");
  }
  return {
    pluginId: requiredString(input, "pluginId"),
    source: validateSource(requiredString(input, "source")),
    rootDirectory: requiredString(input, "rootDirectory"),
    manifestPath: requiredString(input, "manifestPath"),
    manifestHash: requiredString(input, "manifestHash"),
    decisions: input.decisions.map(validatePluginPermissionDecision),
  };
}

function validatePluginPermissionDecision(input: unknown): PluginPermissionDecision {
  if (!isRecord(input)) {
    throw new Error("Plugin permission decision must be an object.");
  }
  const reason = optionalString(input, "reason");
  return {
    permission: validatePermission(requiredString(input, "permission")),
    action: validateAction(requiredString(input, "action")),
    decidedAt: requiredString(input, "decidedAt"),
    ...(reason === undefined ? {} : { reason }),
  };
}

function validatePermission(value: string): CapabilityPermission {
  try {
    return normalizePluginPermission(value);
  } catch (error) {
    if (error instanceof Error) {
      throw new Error(`Plugin permission contains unsupported value: ${value} (${error.message})`);
    }
    throw error;
  }
}

function validateAction(value: string): PluginPermissionDecisionAction {
  if (value !== "grant" && value !== "revoke") {
    throw new Error(`Plugin permission action contains unsupported value: ${value}`);
  }
  return value;
}

function validateSource(value: string): DiscoveredPlugin["source"] {
  if (value !== "built-in" && value !== "dev" && value !== "user" && value !== "workspace") {
    throw new Error(`Plugin permission source contains unsupported value: ${value}`);
  }
  return value;
}

function requiredString(record: Record<string, unknown>, key: string): string {
  const value = record[key];
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(`Plugin permission field ${key} must be a non-empty string.`);
  }
  return value;
}

function optionalString(record: Record<string, unknown>, key: string): string | undefined {
  const value = record[key];
  if (value === undefined) {
    return undefined;
  }
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(`Plugin permission field ${key} must be a non-empty string when provided.`);
  }
  return value;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
