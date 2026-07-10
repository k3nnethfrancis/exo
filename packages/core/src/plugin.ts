import { readFile, readdir } from "node:fs/promises";
import path from "node:path";

import type {
  CapabilityLifecycle,
  CapabilityMetadata,
  CapabilityPermission,
  CapabilitySurface,
} from "./capabilities";
import { isSupportedCapability, normalizeCapabilityPermission, parseCapabilityKind } from "./capabilities";
import { hashPluginManifest } from "./plugin-state";

export const EXO_PLUGIN_MANIFEST_FILE = "exo.plugin.json";

export type PluginSource = "built-in" | "dev" | "user" | "workspace";
export type PluginTrustState = "trusted" | "untrusted";
export type PluginExecutableLoadingState = "disabled";

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
  settingsSchema?: PluginSettingsSchema;
}

export type PluginSettingFieldType = "boolean" | "string" | "number" | "select";
export type PluginSettingValue = boolean | string | number;

export interface PluginSettingsSchema {
  version: 1;
  sections?: PluginSettingsSection[];
  fields: PluginSettingField[];
}

export interface PluginSettingsSection {
  id: string;
  label: string;
  description?: string;
  fields?: string[];
}

export type PluginSettingField =
  | PluginBooleanSettingField
  | PluginStringSettingField
  | PluginNumberSettingField
  | PluginSelectSettingField;

export interface PluginSettingFieldBase {
  id: string;
  label: string;
  description?: string;
}

export interface PluginBooleanSettingField extends PluginSettingFieldBase {
  type: "boolean";
  default?: boolean;
}

export interface PluginStringSettingField extends PluginSettingFieldBase {
  type: "string";
  default?: string;
}

export interface PluginNumberSettingField extends PluginSettingFieldBase {
  type: "number";
  default?: number;
}

export interface PluginSelectSettingField extends PluginSettingFieldBase {
  type: "select";
  options: PluginSelectSettingOption[];
  default?: string;
}

export interface PluginSelectSettingOption {
  value: string;
  label: string;
  description?: string;
}

export interface DiscoveredPlugin {
  manifest: PluginManifest;
  manifestPath: string;
  rootDirectory: string;
  source: PluginSource;
  trust: PluginTrustState;
  enabled: boolean;
  manifestHash: string;
}

export interface PluginLifecycleStatus {
  pluginId: string;
  source: PluginSource;
  trust: PluginTrustState;
  enabled: boolean;
  active: boolean;
  entrypoints?: PluginEntrypoints;
  capabilityIds: string[];
  exposedCapabilityIds: string[];
  executableLoading: PluginExecutableLoadingState;
  canLoadEntrypoints: false;
  canGrantPermissions: false;
  reason: string;
  statusNotes: string[];
}

const CAPABILITY_LIFECYCLES = ["built-in", "experimental", "disabled"] satisfies CapabilityLifecycle[];

const CAPABILITY_SURFACES = ["desktop", "cli", "commandServer", "internal"] satisfies CapabilitySurface[];

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
    // Inactive plugins remain inspectable for management UI, but their capabilities
    // must not reserve ids or appear active until they are both trusted and enabled.
    if (isActivePlugin(plugin)) {
      for (const capability of plugin.manifest.capabilities.filter(isSupportedCapability)) {
        const existingPluginId = this.capabilityIds.get(capability.id);
        if (existingPluginId) {
          throw new Error(`Plugin capability already registered: ${capability.id} (${existingPluginId})`);
        }
      }
    }
    this.plugins.set(id, plugin);
    if (isActivePlugin(plugin)) {
      for (const capability of plugin.manifest.capabilities.filter(isSupportedCapability)) {
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
      if (!options.includeDisabled && !plugin.enabled) {
        return false;
      }
      if (options.trustedOnly && plugin.trust !== "trusted") {
        return false;
      }
      return true;
    });
  }

  listCapabilities(options: { includeDisabled?: boolean; trustedOnly?: boolean; includeInactive?: boolean } = {}): CapabilityMetadata[] {
    if (options.includeInactive) {
      return this.list(options).flatMap((plugin) => plugin.manifest.capabilities);
    }
    return this.list({ ...options, trustedOnly: true }).flatMap((plugin) =>
      isActivePlugin(plugin)
        ? plugin.manifest.capabilities.filter((capability) =>
          isSupportedCapability(capability) && (options.includeDisabled || capability.lifecycle !== "disabled")
        )
        : [],
    );
  }
}

export async function discoverPluginManifests(
  directories: string[],
  options: { source: PluginSource; trust?: PluginTrustState; enabled?: boolean },
): Promise<DiscoveredPlugin[]> {
  const discovered: DiscoveredPlugin[] = [];
  for (const directory of directories) {
    const entries = await safeReadDirectories(directory);
    for (const entry of entries) {
      const rootDirectory = path.join(directory, entry);
      const manifestPath = path.join(rootDirectory, EXO_PLUGIN_MANIFEST_FILE);
      const manifestResult = await readPluginManifestWithHash(manifestPath);
      if (!manifestResult) {
        continue;
      }
      discovered.push({
        manifest: manifestResult.manifest,
        manifestPath,
        rootDirectory,
        source: options.source,
        trust: options.trust ?? defaultPluginTrust(options.source),
        enabled: options.enabled ?? true,
        manifestHash: manifestResult.manifestHash,
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
    settingsSchema: validateSettingsSchema(input.settingsSchema),
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

export function isActivePlugin(plugin: DiscoveredPlugin): boolean {
  return plugin.enabled && plugin.trust === "trusted";
}

export function resolvePluginLifecycle(plugin: DiscoveredPlugin): PluginLifecycleStatus {
  const active = isActivePlugin(plugin);
  const exposedCapabilityIds = active
    ? plugin.manifest.capabilities
      .filter((capability) => isSupportedCapability(capability) && capability.lifecycle !== "disabled")
      .map((capability) => capability.id)
    : [];
  return {
    pluginId: plugin.manifest.id,
    source: plugin.source,
    trust: plugin.trust,
    enabled: plugin.enabled,
    active,
    entrypoints: plugin.manifest.entrypoints,
    capabilityIds: plugin.manifest.capabilities.map((capability) => capability.id),
    exposedCapabilityIds,
    executableLoading: "disabled",
    canLoadEntrypoints: false,
    canGrantPermissions: false,
    reason: lifecycleReason(plugin, active),
    statusNotes: plugin.manifest.capabilities.flatMap((capability) => capability.statusNotes ?? []),
  };
}

export function canLoadPluginEntrypoints(_plugin: DiscoveredPlugin): false {
  return false;
}

async function readPluginManifestWithHash(manifestPath: string): Promise<{ manifest: PluginManifest; manifestHash: string } | null> {
  try {
    const rawManifest = await readFile(manifestPath, "utf8");
    return {
      manifest: parsePluginManifest(rawManifest),
      manifestHash: hashPluginManifest(rawManifest),
    };
  } catch (error) {
    if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") {
      return null;
    }
    throw error;
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

function lifecycleReason(plugin: DiscoveredPlugin, active: boolean): string {
  if (!plugin.enabled) {
    return "Plugin is disabled; manifest remains inspectable but capabilities and entrypoints stay inactive.";
  }
  if (plugin.trust !== "trusted") {
    return "Plugin is untrusted; manifest remains inspectable but capabilities and entrypoints stay inactive.";
  }
  if (active) {
    // Trust and enablement expose metadata only. Entrypoints stay inert until a future
    // loader has a sandbox, explicit grants, revocation, logging, and tests.
    return "Plugin metadata is active; arbitrary plugin entrypoint execution is disabled in this foundation slice.";
  }
  return "Plugin metadata is inactive; arbitrary plugin entrypoint execution is disabled.";
}

function validateEntrypoints(input: unknown): PluginEntrypoints | undefined {
  if (input === undefined) {
    return undefined;
  }
  if (!isRecord(input)) {
    throw new Error("Plugin manifest entrypoints must be an object.");
  }
  const entrypoints = {
    main: optionalString(input, "main"),
    renderer: optionalString(input, "renderer"),
    webview: optionalString(input, "webview"),
  };
  for (const [key, value] of Object.entries(entrypoints)) {
    if (value !== undefined) {
      assertSafeRelativePath(value, `entrypoints.${key}`);
    }
  }
  return entrypoints;
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
  const parsedKind = parseCapabilityKind(requiredString(input, "kind"));
  const permissions = parsedKind.status === "unsupported-kind"
    ? validateUnsupportedCapabilityPermissions(input.permissions)
    : validatePermissions(input.permissions, "capability.permissions");
  const statusNotes = parsedKind.status === "unsupported-kind"
    ? [`Capability kind ${parsedKind.kind} is not supported by this Exo version.`]
    : undefined;
  const capability: CapabilityMetadata = {
    id: requiredString(input, "id"),
    kind: parsedKind.kind,
    label: requiredString(input, "label"),
    description: requiredString(input, "description"),
    lifecycle: validateEnum(requiredString(input, "lifecycle"), CAPABILITY_LIFECYCLES, "capability.lifecycle"),
    owner: requiredString(input, "owner"),
    surfaces: validateSurfaces(input.surfaces, "capability.surfaces"),
    permissions,
    compatibility: isRecord(input.compatibility) ? input.compatibility : undefined,
    status: parsedKind.status === "unsupported-kind" ? parsedKind.status : undefined,
    statusNotes,
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
  return validateStringArray(input, field).map((value) => {
    try {
      return normalizeCapabilityPermission(value);
    } catch (error) {
      if (error instanceof Error) {
        throw new Error(`${field} contains unsupported value: ${value} (${error.message})`);
      }
      throw error;
    }
  });
}

function validateUnsupportedCapabilityPermissions(input: unknown): CapabilityPermission[] {
  validateStringArray(input, "capability.permissions");
  return [];
}

function validateSettingsSchema(input: unknown): PluginSettingsSchema | undefined {
  if (input === undefined) {
    return undefined;
  }
  if (!isRecord(input)) {
    throw new Error("Plugin manifest settingsSchema must be an object.");
  }
  const fieldsInput = input.fields;
  if (!Array.isArray(fieldsInput)) {
    throw new Error("Plugin manifest settingsSchema.fields must be an array.");
  }
  if (input.version !== 1) {
    throw new Error("Plugin manifest settingsSchema.version must be 1.");
  }
  const fields = fieldsInput.map(validateSettingField);
  const fieldIds = new Set<string>();
  for (const field of fields) {
    if (fieldIds.has(field.id)) {
      throw new Error(`Plugin manifest settingsSchema declares duplicate field: ${field.id}`);
    }
    fieldIds.add(field.id);
  }

  const sections = validateSettingsSections(input.sections, fieldIds);
  return sections ? { version: 1, sections, fields } : { version: 1, fields };
}

function validateSettingsSections(input: unknown, fieldIds: Set<string>): PluginSettingsSection[] | undefined {
  if (input === undefined) {
    return undefined;
  }
  if (!Array.isArray(input)) {
    throw new Error("Plugin manifest settingsSchema.sections must be an array when provided.");
  }
  const sectionIds = new Set<string>();
  return input.map((sectionInput) => {
    if (!isRecord(sectionInput)) {
      throw new Error("Plugin manifest settingsSchema section must be an object.");
    }
    const section: PluginSettingsSection = {
      id: requiredString(sectionInput, "id"),
      label: requiredString(sectionInput, "label"),
      description: optionalString(sectionInput, "description"),
      fields: sectionInput.fields === undefined ? undefined : validateStringArray(sectionInput.fields, "settingsSchema.sections.fields"),
    };
    assertIdentifier(section.id, "Plugin settings section id");
    if (sectionIds.has(section.id)) {
      throw new Error(`Plugin manifest settingsSchema declares duplicate section: ${section.id}`);
    }
    sectionIds.add(section.id);
    for (const fieldId of section.fields ?? []) {
      if (!fieldIds.has(fieldId)) {
        throw new Error(`Plugin manifest settingsSchema section ${section.id} references unknown field: ${fieldId}`);
      }
    }
    return section;
  });
}

function validateSettingField(input: unknown): PluginSettingField {
  if (!isRecord(input)) {
    throw new Error("Plugin manifest settingsSchema field must be an object.");
  }
  const id = requiredString(input, "id");
  assertIdentifier(id, "Plugin settings field id");
  const base = {
    id,
    label: requiredString(input, "label"),
    description: optionalString(input, "description"),
  };
  const type = validateEnum(requiredString(input, "type"), ["boolean", "string", "number", "select"] as const, "settingsSchema.field.type");
  switch (type) {
    case "boolean":
      return { ...base, type, default: optionalSettingDefault(input, id, type) };
    case "string":
      return { ...base, type, default: optionalSettingDefault(input, id, type) };
    case "number":
      return { ...base, type, default: optionalSettingDefault(input, id, type) };
    case "select": {
      const options = validateSelectOptions(input.options, id);
      const defaultValue = optionalSettingDefault(input, id, type);
      if (defaultValue !== undefined && !options.some((option) => option.value === defaultValue)) {
        throw new Error(`Plugin manifest settingsSchema field ${id} default must match one of its select options.`);
      }
      return { ...base, type, options, default: defaultValue };
    }
  }
}

function validateSelectOptions(input: unknown, fieldId: string): PluginSelectSettingOption[] {
  if (!Array.isArray(input) || input.length === 0) {
    throw new Error(`Plugin manifest settingsSchema field ${fieldId} options must be a non-empty array.`);
  }
  const values = new Set<string>();
  return input.map((optionInput) => {
    if (!isRecord(optionInput)) {
      throw new Error(`Plugin manifest settingsSchema field ${fieldId} option must be an object.`);
    }
    const option: PluginSelectSettingOption = {
      value: requiredString(optionInput, "value"),
      label: requiredString(optionInput, "label"),
      description: optionalString(optionInput, "description"),
    };
    if (values.has(option.value)) {
      throw new Error(`Plugin manifest settingsSchema field ${fieldId} declares duplicate select option: ${option.value}`);
    }
    values.add(option.value);
    return option;
  });
}

function optionalSettingDefault<T extends PluginSettingFieldType>(
  record: Record<string, unknown>,
  fieldId: string,
  type: T,
): T extends "boolean" ? boolean | undefined : T extends "number" ? number | undefined : string | undefined {
  const value = record.default;
  if (value === undefined) {
    return undefined as T extends "boolean" ? boolean | undefined : T extends "number" ? number | undefined : string | undefined;
  }
  if ((type === "boolean" && typeof value !== "boolean") || (type === "string" && typeof value !== "string") || (type === "select" && typeof value !== "string") || (type === "number" && typeof value !== "number")) {
    throw new Error(`Plugin manifest settingsSchema field ${fieldId} default must match its ${type} type.`);
  }
  return value as T extends "boolean" ? boolean | undefined : T extends "number" ? number | undefined : string | undefined;
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

function assertSafeRelativePath(value: string, label: string): void {
  if (path.isAbsolute(value) || path.win32.isAbsolute(value)) {
    throw new Error(`Plugin manifest ${label} must be a relative path without traversal: ${value}`);
  }
  if (value.includes("\\") || value.includes("//")) {
    throw new Error(`Plugin manifest ${label} must be a relative path without traversal: ${value}`);
  }
  const parts = value.split(/[\\/]+/);
  if (parts.some((part) => part === "..") || parts.includes("")) {
    throw new Error(`Plugin manifest ${label} must be a relative path without traversal: ${value}`);
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
