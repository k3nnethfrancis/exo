import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import type {
  DiscoveredPlugin,
  PluginSettingField,
  PluginSettingsSchema,
  PluginSettingValue,
} from "./plugin";

export const EXO_PLUGIN_SETTINGS_FILE = "plugin-settings.json";

export interface PluginSettingsIdentity {
  pluginId: string;
  source: DiscoveredPlugin["source"];
  rootDirectory: string;
  manifestPath: string;
}

export interface PluginSettingsRecord extends PluginSettingsIdentity {
  manifestHash: string;
  values: Record<string, PluginSettingValue>;
  updatedAt?: string;
}

export interface PluginSettingsStore {
  version: 1;
  plugins: PluginSettingsRecord[];
}

export interface ResolvedPluginSettings {
  pluginId: string;
  hasSettings: boolean;
  fieldCount: number;
  configuredCount: number;
  values: Record<string, PluginSettingValue>;
  defaults: Record<string, PluginSettingValue>;
  userValues: Record<string, PluginSettingValue>;
  reviewRequired: boolean;
  configReviewRequired: boolean;
  validationErrors: string[];
  record?: PluginSettingsRecord;
}

export function pluginSettingsIdentity(plugin: DiscoveredPlugin): PluginSettingsIdentity {
  return {
    pluginId: plugin.manifest.id,
    source: plugin.source,
    rootDirectory: plugin.rootDirectory,
    manifestPath: plugin.manifestPath,
  };
}

export function pluginSettingsKey(identity: PluginSettingsIdentity): string {
  return createHash("sha256")
    .update(
      JSON.stringify({
        pluginId: identity.pluginId,
        source: identity.source,
        rootDirectory: path.resolve(identity.rootDirectory),
        manifestPath: path.resolve(identity.manifestPath),
      }),
    )
    .digest("hex");
}

export function pluginSettingsPath(runtimeRoot: string): string {
  return path.join(runtimeRoot, EXO_PLUGIN_SETTINGS_FILE);
}

export async function readPluginSettingsStore(runtimeRoot: string): Promise<PluginSettingsStore> {
  try {
    const raw = await readFile(pluginSettingsPath(runtimeRoot), "utf8");
    return validatePluginSettingsStore(JSON.parse(raw));
  } catch (error) {
    if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") {
      return emptyPluginSettingsStore();
    }
    throw error;
  }
}

export async function writePluginSettingsStore(runtimeRoot: string, store: PluginSettingsStore): Promise<void> {
  await mkdir(runtimeRoot, { recursive: true });
  await writeFile(pluginSettingsPath(runtimeRoot), `${JSON.stringify(validatePluginSettingsStore(store), null, 2)}\n`, "utf8");
}

export function emptyPluginSettingsStore(): PluginSettingsStore {
  return { version: 1, plugins: [] };
}

export function resolvePluginSettings(
  plugin: DiscoveredPlugin,
  store: PluginSettingsStore | undefined,
): ResolvedPluginSettings {
  const schema = plugin.manifest.settingsSchema;
  const record = findPluginSettingsRecord(plugin, store);
  const defaults = schema ? defaultsForSchema(schema) : {};
  const validationErrors: string[] = [];
  const userValues: Record<string, PluginSettingValue> = {};
  if (schema && record) {
    for (const [fieldId, value] of Object.entries(record.values)) {
      const field = schema.fields.find((candidate) => candidate.id === fieldId);
      if (!field) {
        validationErrors.push(`Unknown plugin setting field: ${fieldId}`);
        continue;
      }
      const error = validatePluginSettingValue(field, value);
      if (error) {
        validationErrors.push(error);
        continue;
      }
      userValues[fieldId] = value;
    }
  }
  const reviewRequired = Boolean(record && record.manifestHash !== plugin.manifestHash);
  return {
    pluginId: plugin.manifest.id,
    hasSettings: Boolean(schema && schema.fields.length > 0),
    fieldCount: schema?.fields.length ?? 0,
    configuredCount: Object.keys(userValues).length,
    values: { ...defaults, ...userValues },
    defaults,
    userValues,
    reviewRequired,
    configReviewRequired: reviewRequired,
    validationErrors,
    record,
  };
}

export function updatePluginSettingsStore(
  store: PluginSettingsStore,
  plugin: DiscoveredPlugin,
  patch: Record<string, PluginSettingValue>,
  updatedAt = new Date().toISOString(),
): PluginSettingsStore {
  const schema = requirePluginSettingsSchema(plugin);
  const current = resolvePluginSettings(plugin, store);
  const nextValues = { ...current.userValues, ...patch };
  validatePluginSettingsValues(schema, nextValues);
  return upsertPluginSettingsRecord(store, plugin, nextValues, updatedAt);
}

export function resetPluginSettingsStore(
  store: PluginSettingsStore,
  plugin: DiscoveredPlugin,
  updatedAt = new Date().toISOString(),
): PluginSettingsStore {
  requirePluginSettingsSchema(plugin);
  return upsertPluginSettingsRecord(store, plugin, {}, updatedAt);
}

export function validatePluginSettingsStore(input: unknown): PluginSettingsStore {
  if (!isRecord(input) || input.version !== 1 || !Array.isArray(input.plugins)) {
    throw new Error("Plugin settings store must be a version 1 object with plugins.");
  }
  return {
    version: 1,
    plugins: input.plugins.map(validatePluginSettingsRecord),
  };
}

export function validatePluginSettingsValues(schema: PluginSettingsSchema, values: Record<string, PluginSettingValue>): void {
  for (const [fieldId, value] of Object.entries(values)) {
    const field = schema.fields.find((candidate) => candidate.id === fieldId);
    if (!field) {
      throw new Error(`Unknown plugin setting field: ${fieldId}`);
    }
    const error = validatePluginSettingValue(field, value);
    if (error) {
      throw new Error(error);
    }
  }
}

function upsertPluginSettingsRecord(
  store: PluginSettingsStore,
  plugin: DiscoveredPlugin,
  values: Record<string, PluginSettingValue>,
  updatedAt: string,
): PluginSettingsStore {
  const record: PluginSettingsRecord = {
    ...pluginSettingsIdentity(plugin),
    manifestHash: plugin.manifestHash,
    values,
    updatedAt,
  };
  const nextKey = pluginSettingsKey(record);
  const plugins = [
    ...store.plugins.filter((candidate) => pluginSettingsKey(candidate) !== nextKey),
    record,
  ].sort((a, b) => `${a.source}:${a.pluginId}:${a.rootDirectory}`.localeCompare(`${b.source}:${b.pluginId}:${b.rootDirectory}`));
  return validatePluginSettingsStore({ version: 1, plugins });
}

function findPluginSettingsRecord(
  plugin: DiscoveredPlugin,
  store: PluginSettingsStore | undefined,
): PluginSettingsRecord | undefined {
  const identity = pluginSettingsIdentity(plugin);
  return store?.plugins.find((candidate) => pluginSettingsKey(candidate) === pluginSettingsKey(identity));
}

function requirePluginSettingsSchema(plugin: DiscoveredPlugin): PluginSettingsSchema {
  const schema = plugin.manifest.settingsSchema;
  if (!schema || schema.fields.length === 0) {
    throw new Error(`Plugin does not declare settings: ${plugin.manifest.id}`);
  }
  return schema;
}

function defaultsForSchema(schema: PluginSettingsSchema): Record<string, PluginSettingValue> {
  const values: Record<string, PluginSettingValue> = {};
  for (const field of schema.fields) {
    if (field.default !== undefined) {
      values[field.id] = field.default;
    }
  }
  return values;
}

function validatePluginSettingValue(field: PluginSettingField, value: unknown): string | undefined {
  switch (field.type) {
    case "boolean":
      return typeof value === "boolean" ? undefined : `Plugin setting ${field.id} must be a boolean.`;
    case "string":
      return typeof value === "string" ? undefined : `Plugin setting ${field.id} must be a string.`;
    case "number":
      return typeof value === "number" ? undefined : `Plugin setting ${field.id} must be a number.`;
    case "select":
      if (typeof value !== "string") {
        return `Plugin setting ${field.id} must be a string.`;
      }
      return field.options.some((option) => option.value === value)
        ? undefined
        : `Plugin setting ${field.id} must match one of its select options.`;
  }
}

function validatePluginSettingsRecord(input: unknown): PluginSettingsRecord {
  if (!isRecord(input)) {
    throw new Error("Plugin settings record must be an object.");
  }
  const rawValues = input.values;
  if (!isRecord(rawValues)) {
    throw new Error("Plugin settings record values must be an object.");
  }
  const values: Record<string, PluginSettingValue> = {};
  for (const [key, value] of Object.entries(rawValues)) {
    if (typeof value !== "boolean" && typeof value !== "string" && typeof value !== "number") {
      throw new Error(`Plugin settings value ${key} must be a boolean, string, or number.`);
    }
    values[key] = value;
  }
  return {
    pluginId: requiredString(input, "pluginId"),
    source: validateSource(requiredString(input, "source")),
    rootDirectory: requiredString(input, "rootDirectory"),
    manifestPath: requiredString(input, "manifestPath"),
    manifestHash: requiredString(input, "manifestHash"),
    values,
    updatedAt: optionalString(input, "updatedAt"),
  };
}

function validateSource(value: string): DiscoveredPlugin["source"] {
  if (value !== "built-in" && value !== "dev" && value !== "user" && value !== "workspace") {
    throw new Error(`Plugin settings source contains unsupported value: ${value}`);
  }
  return value;
}

function requiredString(record: Record<string, unknown>, key: string): string {
  const value = record[key];
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(`Plugin settings field ${key} must be a non-empty string.`);
  }
  return value;
}

function optionalString(record: Record<string, unknown>, key: string): string | undefined {
  const value = record[key];
  if (value === undefined) {
    return undefined;
  }
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(`Plugin settings field ${key} must be a non-empty string when provided.`);
  }
  return value;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
