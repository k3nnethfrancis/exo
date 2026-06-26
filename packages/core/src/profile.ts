import type { CapabilityLifecycle, CapabilityMetadata, CapabilityPermission, CapabilitySurface } from "./capabilities";
import type { DiscoveredPlugin } from "./plugin";
import type { RoutineOutputPolicy } from "./routine";

export interface ProfileDefinition {
  id: string;
  label: string;
  description: string;
  lifecycle: CapabilityLifecycle;
  recommendedPlugins: ProfilePluginRecommendation[];
  metadataSchemas: ProfileMetadataSchema[];
  contextTemplates: ProfileTemplateReference[];
  instructionTemplates: ProfileTemplateReference[];
  mcpConfigTemplates: ProfileTemplateReference[];
  skills: ProfileSkillReference[];
  routineTemplateIds: string[];
  graphViews: ProfileGraphViewReference[];
  analyzerSettings: ProfileAnalyzerSetting[];
  reviewPolicy?: ProfileReviewPolicy;
  outputPolicy?: RoutineOutputPolicy;
  sourceCapabilityId?: string;
  sourcePluginId?: string;
}

export interface ProfilePluginRecommendation {
  id: string;
  required: boolean;
  reason?: string;
}

export interface ProfileMetadataSchema {
  id: string;
  label: string;
  description?: string;
  scope: ProfileScopeSelector;
  frontmatter: Record<string, ProfileFieldDefinition>;
  tags: string[];
}

export interface ProfileFieldDefinition {
  type: "string" | "number" | "boolean" | "date" | "array" | "object" | "unknown";
  required: boolean;
  description?: string;
}

export interface ProfileScopeSelector {
  paths: string[];
}

export interface ProfileTemplateReference {
  id: string;
  label: string;
  target?: string;
  templatePath: string;
}

export interface ProfileSkillReference {
  id: string;
  label: string;
  harnesses: string[];
  sourcePath: string;
  required: boolean;
}

export interface ProfileGraphViewReference {
  id: string;
  label: string;
  pluginId: string;
  viewId: string;
}

export interface ProfileAnalyzerSetting {
  analyzerId: string;
  settings: Record<string, unknown>;
}

export interface ProfileReviewPolicy {
  fileChanges: "none" | "propose" | "apply";
  requireHumanReview: boolean;
  allowedPaths: string[];
}

export interface ProfileFilter {
  includeDisabled?: boolean;
  surface?: CapabilitySurface;
}

export function profilesFromPlugin(plugin: DiscoveredPlugin, filter: ProfileFilter = {}): ProfileDefinition[] {
  if (filter.surface && !plugin.manifest.surfaces.includes(filter.surface)) {
    return [];
  }
  return plugin.manifest.capabilities.flatMap((capability) => {
    if (!matchesProfileFilter(capability, filter)) {
      return [];
    }
    const profile = profileFromCapability(capability);
    if (!profile) {
      return [];
    }
    return [
      {
        ...profile,
        sourceCapabilityId: capability.id,
        sourcePluginId: plugin.manifest.id,
      },
    ];
  });
}

export function profileFromCapability(capability: CapabilityMetadata): ProfileDefinition | null {
  if (capability.kind !== "profile") {
    return null;
  }
  const profile = readProfilePayload(capability);
  return {
    ...profile,
    id: profile.id || capability.id,
    label: profile.label || capability.label,
    description: profile.description || capability.description,
    lifecycle: capability.lifecycle,
    sourceCapabilityId: capability.id,
  };
}

function matchesProfileFilter(capability: CapabilityMetadata, filter: ProfileFilter): boolean {
  if (capability.kind !== "profile") {
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

function readProfilePayload(capability: CapabilityMetadata): ProfileDefinition {
  const payload = capability.compatibility?.profile;
  if (!isRecord(payload)) {
    throw new Error(`Profile capability ${capability.id} must define compatibility.profile.`);
  }
  return {
    id: optionalString(payload, "id") ?? capability.id,
    label: optionalString(payload, "label") ?? capability.label,
    description: optionalString(payload, "description") ?? capability.description,
    lifecycle: capability.lifecycle,
    recommendedPlugins: validatePluginRecommendations(payload.recommendedPlugins),
    metadataSchemas: validateMetadataSchemas(payload.metadataSchemas),
    contextTemplates: validateTemplateReferences(payload.contextTemplates, "contextTemplates"),
    instructionTemplates: validateTemplateReferences(payload.instructionTemplates, "instructionTemplates"),
    mcpConfigTemplates: validateTemplateReferences(payload.mcpConfigTemplates, "mcpConfigTemplates"),
    skills: validateSkillReferences(payload.skills),
    routineTemplateIds: validateStringArray(payload.routineTemplateIds, "routineTemplateIds", []),
    graphViews: validateGraphViewReferences(payload.graphViews),
    analyzerSettings: validateAnalyzerSettings(payload.analyzerSettings),
    reviewPolicy: validateReviewPolicy(payload.reviewPolicy),
    outputPolicy: validateOutputPolicy(payload.outputPolicy),
  };
}

function validatePluginRecommendations(input: unknown): ProfilePluginRecommendation[] {
  if (input === undefined) {
    return [];
  }
  if (!Array.isArray(input)) {
    throw new Error("Profile recommendedPlugins must be an array.");
  }
  return input.map((item) => {
    if (!isRecord(item)) {
      throw new Error("Profile recommendedPlugins entries must be objects.");
    }
    return {
      id: requiredString(item, "id"),
      required: item.required === undefined ? false : requiredBoolean(item, "required"),
      reason: optionalString(item, "reason"),
    };
  });
}

function validateMetadataSchemas(input: unknown): ProfileMetadataSchema[] {
  if (input === undefined) {
    return [];
  }
  if (!Array.isArray(input)) {
    throw new Error("Profile metadataSchemas must be an array.");
  }
  return input.map((item) => {
    if (!isRecord(item)) {
      throw new Error("Profile metadataSchemas entries must be objects.");
    }
    const frontmatter = item.frontmatter;
    if (frontmatter !== undefined && !isRecord(frontmatter)) {
      throw new Error("Profile metadataSchemas.frontmatter must be an object when provided.");
    }
    return {
      id: requiredString(item, "id"),
      label: requiredString(item, "label"),
      description: optionalString(item, "description"),
      scope: validateScope(item.scope),
      frontmatter: validateFieldDefinitions(frontmatter),
      tags: validateStringArray(item.tags, "metadataSchemas.tags", []),
    };
  });
}

function validateScope(input: unknown): ProfileScopeSelector {
  if (input === undefined) {
    return { paths: [] };
  }
  if (!isRecord(input)) {
    throw new Error("Profile scope must be an object.");
  }
  return {
    paths: validateRelativePaths(input.paths, "scope.paths", []),
  };
}

function validateFieldDefinitions(input: unknown): Record<string, ProfileFieldDefinition> {
  if (input === undefined) {
    return {};
  }
  if (!isRecord(input)) {
    throw new Error("Profile frontmatter definitions must be an object.");
  }
  const definitions: Record<string, ProfileFieldDefinition> = {};
  for (const [key, value] of Object.entries(input)) {
    if (!isRecord(value)) {
      throw new Error(`Profile frontmatter field ${key} must be an object.`);
    }
    definitions[key] = {
      type: validateFieldType(optionalString(value, "type") ?? "unknown"),
      required: value.required === undefined ? false : requiredBoolean(value, "required"),
      description: optionalString(value, "description"),
    };
  }
  return definitions;
}

function validateTemplateReferences(input: unknown, field: string): ProfileTemplateReference[] {
  if (input === undefined) {
    return [];
  }
  if (!Array.isArray(input)) {
    throw new Error(`Profile ${field} must be an array.`);
  }
  return input.map((item) => {
    if (!isRecord(item)) {
      throw new Error(`Profile ${field} entries must be objects.`);
    }
    return {
      id: requiredString(item, "id"),
      label: requiredString(item, "label"),
      target: optionalRelativePath(item, "target"),
      templatePath: requiredRelativePath(item, "templatePath"),
    };
  });
}

function validateSkillReferences(input: unknown): ProfileSkillReference[] {
  if (input === undefined) {
    return [];
  }
  if (!Array.isArray(input)) {
    throw new Error("Profile skills must be an array.");
  }
  return input.map((item) => {
    if (!isRecord(item)) {
      throw new Error("Profile skills entries must be objects.");
    }
    return {
      id: requiredString(item, "id"),
      label: requiredString(item, "label"),
      harnesses: validateStringArray(item.harnesses, "skills.harnesses", []),
      sourcePath: requiredRelativePath(item, "sourcePath"),
      required: item.required === undefined ? false : requiredBoolean(item, "required"),
    };
  });
}

function validateGraphViewReferences(input: unknown): ProfileGraphViewReference[] {
  if (input === undefined) {
    return [];
  }
  if (!Array.isArray(input)) {
    throw new Error("Profile graphViews must be an array.");
  }
  return input.map((item) => {
    if (!isRecord(item)) {
      throw new Error("Profile graphViews entries must be objects.");
    }
    return {
      id: requiredString(item, "id"),
      label: requiredString(item, "label"),
      pluginId: requiredString(item, "pluginId"),
      viewId: requiredString(item, "viewId"),
    };
  });
}

function validateAnalyzerSettings(input: unknown): ProfileAnalyzerSetting[] {
  if (input === undefined) {
    return [];
  }
  if (!Array.isArray(input)) {
    throw new Error("Profile analyzerSettings must be an array.");
  }
  return input.map((item) => {
    if (!isRecord(item)) {
      throw new Error("Profile analyzerSettings entries must be objects.");
    }
    const settings = item.settings;
    return {
      analyzerId: requiredString(item, "analyzerId"),
      settings: isRecord(settings) ? settings : {},
    };
  });
}

function validateReviewPolicy(input: unknown): ProfileReviewPolicy | undefined {
  if (input === undefined) {
    return undefined;
  }
  if (!isRecord(input)) {
    throw new Error("Profile reviewPolicy must be an object.");
  }
  const fileChanges = validateFileChangePolicy(requiredString(input, "fileChanges"), "reviewPolicy.fileChanges");
  return {
    fileChanges,
    requireHumanReview: input.requireHumanReview === undefined ? true : requiredBoolean(input, "requireHumanReview"),
    allowedPaths: validateRelativePaths(input.allowedPaths, "reviewPolicy.allowedPaths", []),
  };
}

function validateOutputPolicy(input: unknown): RoutineOutputPolicy | undefined {
  if (input === undefined) {
    return undefined;
  }
  if (!isRecord(input)) {
    throw new Error("Profile outputPolicy must be an object.");
  }
  const artifacts = requiredString(input, "artifacts");
  if (artifacts !== "none" && artifacts !== "record") {
    throw new Error(`Profile outputPolicy.artifacts is unsupported: ${artifacts}`);
  }
  return {
    fileChanges: validateFileChangePolicy(requiredString(input, "fileChanges"), "outputPolicy.fileChanges"),
    artifacts,
    allowedPaths: validateRelativePaths(input.allowedPaths, "outputPolicy.allowedPaths", []),
  };
}

function validateFileChangePolicy(value: string, field: string): "none" | "propose" | "apply" {
  if (value !== "none" && value !== "propose" && value !== "apply") {
    throw new Error(`Profile ${field} is unsupported: ${value}`);
  }
  return value;
}

function validateFieldType(value: string): ProfileFieldDefinition["type"] {
  switch (value) {
    case "array":
    case "boolean":
    case "date":
    case "number":
    case "object":
    case "string":
    case "unknown":
      return value;
    default:
      throw new Error(`Profile frontmatter field type is unsupported: ${value}`);
  }
}

function validateStringArray(input: unknown, field: string, fallback: string[]): string[] {
  if (input === undefined) {
    return fallback;
  }
  if (!Array.isArray(input) || !input.every((value) => typeof value === "string" && value.trim().length > 0)) {
    throw new Error(`Profile ${field} must be an array of non-empty strings.`);
  }
  return input;
}

function validateRelativePaths(input: unknown, field: string, fallback: string[]): string[] {
  return validateStringArray(input, field, fallback).map((value) => assertRelativePath(value, field));
}

function requiredRelativePath(record: Record<string, unknown>, key: string): string {
  return assertRelativePath(requiredString(record, key), key);
}

function optionalRelativePath(record: Record<string, unknown>, key: string): string | undefined {
  const value = optionalString(record, key);
  return value === undefined ? undefined : assertRelativePath(value, key);
}

function assertRelativePath(value: string, field: string): string {
  if (value.startsWith("/") || value.includes("..") || value.includes("\\")) {
    throw new Error(`Profile ${field} must be a relative plugin/workspace path without traversal: ${value}`);
  }
  return value;
}

function requiredString(record: Record<string, unknown>, key: string): string {
  const value = record[key];
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(`Profile field ${key} must be a non-empty string.`);
  }
  return value;
}

function optionalString(record: Record<string, unknown>, key: string): string | undefined {
  const value = record[key];
  if (value === undefined) {
    return undefined;
  }
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(`Profile field ${key} must be a non-empty string when provided.`);
  }
  return value;
}

function requiredBoolean(record: Record<string, unknown>, key: string): boolean {
  const value = record[key];
  if (typeof value !== "boolean") {
    throw new Error(`Profile field ${key} must be a boolean.`);
  }
  return value;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
