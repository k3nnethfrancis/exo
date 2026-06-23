import type { CapabilityMetadata, CapabilityPermission, CapabilitySurface } from "./capabilities";
import type { DiscoveredPlugin } from "./plugin";
import type {
  HarnessSkillRequirement,
  RoutineDefinition,
  RoutineOutputPolicy,
  RoutinePermissionSet,
  RoutineScope,
  RoutineTrigger,
} from "./routine";

export interface RoutineTemplateDefinition {
  id: string;
  title: string;
  description: string;
  prompt: string;
  harnessId: string;
  requiredSkills: HarnessSkillRequirement[];
  trigger: RoutineTrigger;
  permissions: RoutinePermissionSet;
  outputPolicy: RoutineOutputPolicy;
  sourceCapabilityId?: string;
  sourcePluginId?: string;
}

export interface RoutineInstantiationOptions {
  id: string;
  scope: RoutineScope;
  title?: string;
  prompt?: string;
  harnessId?: string;
  requiredSkills?: HarnessSkillRequirement[];
  trigger?: RoutineTrigger;
  permissions?: RoutinePermissionSet;
  outputPolicy?: RoutineOutputPolicy;
  enabled?: boolean;
  now?: string;
}

export interface RoutineTemplateFilter {
  includeDisabled?: boolean;
  surface?: CapabilitySurface;
}

const ROUTINE_TEMPLATE_PERMISSIONS = [
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

export function instantiateRoutineTemplate(
  template: RoutineTemplateDefinition,
  options: RoutineInstantiationOptions,
): RoutineDefinition {
  const now = options.now ?? new Date().toISOString();
  return {
    id: options.id,
    title: options.title ?? template.title,
    prompt: options.prompt ?? template.prompt,
    harnessId: options.harnessId ?? template.harnessId,
    requiredSkills: options.requiredSkills ?? template.requiredSkills,
    trigger: options.trigger ?? template.trigger,
    scope: options.scope,
    permissions: options.permissions ?? template.permissions,
    outputPolicy: options.outputPolicy ?? template.outputPolicy,
    enabled: options.enabled ?? true,
    createdAt: now,
    updatedAt: now,
  };
}

export function routineTemplatesFromPlugin(plugin: DiscoveredPlugin, filter: RoutineTemplateFilter = {}): RoutineTemplateDefinition[] {
  if (filter.surface && !plugin.manifest.surfaces.includes(filter.surface)) {
    return [];
  }
  return plugin.manifest.capabilities.flatMap((capability) => {
    if (!matchesRoutineTemplateFilter(capability, filter)) {
      return [];
    }
    const template = routineTemplateFromCapability(capability);
    if (!template) {
      return [];
    }
    return [
      {
        ...template,
        sourceCapabilityId: capability.id,
        sourcePluginId: plugin.manifest.id,
      },
    ];
  });
}

function matchesRoutineTemplateFilter(capability: CapabilityMetadata, filter: RoutineTemplateFilter): boolean {
  if (capability.kind !== "routineTemplate") {
    return false;
  }
  if (!filter.includeDisabled && capability.lifecycle === "disabled") {
    return false;
  }
  if (filter.surface && !capability.surfaces.includes(filter.surface)) {
    return false;
  }
  return true;
}

export function routineTemplateFromCapability(capability: CapabilityMetadata): RoutineTemplateDefinition | null {
  if (capability.kind !== "routineTemplate") {
    return null;
  }
  const template = readRoutineTemplatePayload(capability);
  return {
    ...template,
    id: template.id || capability.id,
    title: template.title || capability.label,
    description: template.description || capability.description,
    sourceCapabilityId: capability.id,
  };
}

function readRoutineTemplatePayload(capability: CapabilityMetadata): RoutineTemplateDefinition {
  const payload = capability.compatibility?.routineTemplate;
  if (!isRecord(payload)) {
    throw new Error(`Routine template capability ${capability.id} must define compatibility.routineTemplate.`);
  }

  return {
    id: optionalString(payload, "id") ?? capability.id,
    title: optionalString(payload, "title") ?? capability.label,
    description: optionalString(payload, "description") ?? capability.description,
    prompt: requiredString(payload, "prompt"),
    harnessId: requiredString(payload, "harnessId"),
    requiredSkills: validateSkillRequirements(payload.requiredSkills),
    trigger: validateTrigger(payload.trigger),
    permissions: validatePermissions(payload.permissions),
    outputPolicy: validateOutputPolicy(payload.outputPolicy),
  };
}

function validateSkillRequirements(input: unknown): HarnessSkillRequirement[] {
  if (input === undefined) {
    return [];
  }
  if (!Array.isArray(input)) {
    throw new Error("Routine template requiredSkills must be an array.");
  }
  return input.map((item) => {
    if (!isRecord(item)) {
      throw new Error("Routine template requiredSkills entries must be objects.");
    }
    return {
      id: requiredString(item, "id"),
      label: optionalString(item, "label"),
      required: item.required === undefined ? true : requiredBoolean(item, "required"),
    };
  });
}

function validateTrigger(input: unknown): RoutineTrigger {
  if (input === undefined) {
    return { kind: "manual" };
  }
  if (!isRecord(input)) {
    throw new Error("Routine template trigger must be an object.");
  }
  const kind = requiredString(input, "kind");
  if (kind === "manual") {
    return { kind };
  }
  if (kind === "schedule") {
    return {
      kind,
      schedule: requiredString(input, "schedule"),
      timezone: optionalString(input, "timezone"),
    };
  }
  throw new Error(`Routine template trigger kind is unsupported: ${kind}`);
}

function validatePermissions(input: unknown): RoutinePermissionSet {
  if (!isRecord(input)) {
    throw new Error("Routine template permissions must be an object.");
  }
  const permissions = input.permissions;
  if (!Array.isArray(permissions) || !permissions.every((value) => typeof value === "string" && value.trim().length > 0)) {
    throw new Error("Routine template permissions.permissions must be an array of non-empty strings.");
  }
  return {
    permissions: permissions.map((permission) => {
      if (!ROUTINE_TEMPLATE_PERMISSIONS.includes(permission as CapabilityPermission)) {
        throw new Error(`Routine template permissions.permissions contains unsupported value: ${permission}`);
      }
      return permission as CapabilityPermission;
    }),
  };
}

function validateOutputPolicy(input: unknown): RoutineOutputPolicy {
  if (!isRecord(input)) {
    throw new Error("Routine template outputPolicy must be an object.");
  }
  const fileChanges = requiredString(input, "fileChanges");
  if (fileChanges !== "none" && fileChanges !== "propose" && fileChanges !== "apply") {
    throw new Error(`Routine template outputPolicy.fileChanges is unsupported: ${fileChanges}`);
  }
  const artifacts = requiredString(input, "artifacts");
  if (artifacts !== "none" && artifacts !== "record") {
    throw new Error(`Routine template outputPolicy.artifacts is unsupported: ${artifacts}`);
  }
  const allowedPaths = input.allowedPaths;
  if (!Array.isArray(allowedPaths) || !allowedPaths.every((value) => typeof value === "string" && value.trim().length > 0)) {
    throw new Error("Routine template outputPolicy.allowedPaths must be an array of non-empty strings.");
  }
  return { fileChanges, artifacts, allowedPaths };
}

function requiredString(record: Record<string, unknown>, key: string): string {
  const value = record[key];
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(`Routine template field ${key} must be a non-empty string.`);
  }
  return value;
}

function optionalString(record: Record<string, unknown>, key: string): string | undefined {
  const value = record[key];
  if (value === undefined) {
    return undefined;
  }
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(`Routine template field ${key} must be a non-empty string when provided.`);
  }
  return value;
}

function requiredBoolean(record: Record<string, unknown>, key: string): boolean {
  const value = record[key];
  if (typeof value !== "boolean") {
    throw new Error(`Routine template field ${key} must be a boolean.`);
  }
  return value;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
