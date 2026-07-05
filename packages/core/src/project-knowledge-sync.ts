// status: unstable. This is profile/plugin metadata only; no core behavior acts on these declarations yet.
// Freeze vocabulary growth until the first acting implementation proves which terms are actually needed.
export type ProjectKnowledgeRelationshipMode = "index" | "proposal" | "copy" | "symlink" | "remote";
export type ProjectKnowledgeConflictAction =
  | "report"
  | "block"
  | "preferProject"
  | "preferExograph"
  | "proposeMerge";
export type ProjectKnowledgeRemoteProvider = "github";

export interface ProjectKnowledgeSyncDefinition {
  id: string;
  label: string;
  description?: string;
  scope: ProjectKnowledgeSyncScope;
  canonicalFiles: ProjectKnowledgeCanonicalFile[];
  relationship: ProjectKnowledgeRelationship;
  conflictPolicy: ProjectKnowledgeConflictPolicy;
  reviewPolicy: ProjectKnowledgeReviewPolicy;
  remote?: ProjectKnowledgeRemoteMetadata;
}

export interface ProjectKnowledgeSyncScope {
  projectRoots: string[];
  exographRoots: string[];
  paths: string[];
}

export interface ProjectKnowledgeCanonicalFile {
  id: string;
  label?: string;
  category?: string;
  names: string[];
  patterns: string[];
  targetPath?: string;
}

export interface ProjectKnowledgeRelationship {
  mode: ProjectKnowledgeRelationshipMode;
  targetPrefix?: string;
}

export interface ProjectKnowledgeConflictPolicy {
  onDivergence: ProjectKnowledgeConflictAction;
  requireBaseHash: boolean;
  compareRemoteState: boolean;
}

export interface ProjectKnowledgeReviewPolicy {
  requireHumanReview: boolean;
  proposalRequired: boolean;
  allowedTargets: string[];
}

export interface ProjectKnowledgeRemoteMetadata {
  provider: ProjectKnowledgeRemoteProvider;
  owner?: string;
  repo?: string;
  branch?: string;
  issueLabels: string[];
  pullRequestLabels: string[];
}

export function validateProjectKnowledgeSyncDefinitions(input: unknown): ProjectKnowledgeSyncDefinition[] {
  if (input === undefined) {
    return [];
  }
  if (!Array.isArray(input)) {
    throw new Error("Profile projectKnowledgeSync must be an array.");
  }
  return input.map((item) => {
    if (!isRecord(item)) {
      throw new Error("Profile projectKnowledgeSync entries must be objects.");
    }
    return {
      id: requiredString(item, "id"),
      label: requiredString(item, "label"),
      description: optionalString(item, "description"),
      scope: validateScope(item.scope),
      canonicalFiles: validateCanonicalFiles(item.canonicalFiles),
      relationship: validateRelationship(item.relationship),
      conflictPolicy: validateConflictPolicy(item.conflictPolicy),
      reviewPolicy: validateReviewPolicy(item.reviewPolicy),
      remote: validateRemoteMetadata(item.remote),
    };
  });
}

function validateScope(input: unknown): ProjectKnowledgeSyncScope {
  if (input === undefined) {
    return { projectRoots: [], exographRoots: [], paths: [] };
  }
  if (!isRecord(input)) {
    throw new Error("Profile projectKnowledgeSync.scope must be an object.");
  }
  return {
    projectRoots: validateSafePathList(input.projectRoots, "projectKnowledgeSync.scope.projectRoots", []),
    exographRoots: validateSafePathList(input.exographRoots, "projectKnowledgeSync.scope.exographRoots", []),
    paths: validateSafePathList(input.paths, "projectKnowledgeSync.scope.paths", []),
  };
}

function validateCanonicalFiles(input: unknown): ProjectKnowledgeCanonicalFile[] {
  if (!Array.isArray(input) || input.length === 0) {
    throw new Error("Profile projectKnowledgeSync.canonicalFiles must be a non-empty array.");
  }
  return input.map((item) => {
    if (!isRecord(item)) {
      throw new Error("Profile projectKnowledgeSync.canonicalFiles entries must be objects.");
    }
    const names = validateSafePathList(item.names, "projectKnowledgeSync.canonicalFiles.names", []);
    const patterns = validateSafePathList(item.patterns, "projectKnowledgeSync.canonicalFiles.patterns", []);
    if (names.length === 0 && patterns.length === 0) {
      throw new Error("Profile projectKnowledgeSync canonical files must declare names or patterns.");
    }
    return {
      id: requiredString(item, "id"),
      label: optionalString(item, "label"),
      category: optionalString(item, "category"),
      names,
      patterns,
      targetPath: optionalSafePath(item, "targetPath", "projectKnowledgeSync.canonicalFiles.targetPath"),
    };
  });
}

function validateRelationship(input: unknown): ProjectKnowledgeRelationship {
  if (input === undefined) {
    return { mode: "index" };
  }
  if (!isRecord(input)) {
    throw new Error("Profile projectKnowledgeSync.relationship must be an object.");
  }
  return {
    mode: validateRelationshipMode(optionalString(input, "mode") ?? "index"),
    targetPrefix: optionalSafePath(input, "targetPrefix", "projectKnowledgeSync.relationship.targetPrefix"),
  };
}

function validateConflictPolicy(input: unknown): ProjectKnowledgeConflictPolicy {
  if (input === undefined) {
    return { onDivergence: "report", requireBaseHash: true, compareRemoteState: false };
  }
  if (!isRecord(input)) {
    throw new Error("Profile projectKnowledgeSync.conflictPolicy must be an object.");
  }
  return {
    onDivergence: validateConflictAction(optionalString(input, "onDivergence") ?? "report"),
    requireBaseHash: input.requireBaseHash === undefined ? true : requiredBoolean(input, "requireBaseHash"),
    compareRemoteState: input.compareRemoteState === undefined ? false : requiredBoolean(input, "compareRemoteState"),
  };
}

function validateReviewPolicy(input: unknown): ProjectKnowledgeReviewPolicy {
  if (input === undefined) {
    return { requireHumanReview: true, proposalRequired: true, allowedTargets: [] };
  }
  if (!isRecord(input)) {
    throw new Error("Profile projectKnowledgeSync.reviewPolicy must be an object.");
  }
  return {
    requireHumanReview: input.requireHumanReview === undefined ? true : requiredBoolean(input, "requireHumanReview"),
    proposalRequired: input.proposalRequired === undefined ? true : requiredBoolean(input, "proposalRequired"),
    allowedTargets: validateSafePathList(input.allowedTargets, "projectKnowledgeSync.reviewPolicy.allowedTargets", []),
  };
}

function validateRemoteMetadata(input: unknown): ProjectKnowledgeRemoteMetadata | undefined {
  if (input === undefined) {
    return undefined;
  }
  if (!isRecord(input)) {
    throw new Error("Profile projectKnowledgeSync.remote must be an object.");
  }
  const provider = optionalString(input, "provider") ?? "github";
  if (provider !== "github") {
    throw new Error(`Profile projectKnowledgeSync.remote.provider is unsupported: ${provider}`);
  }
  return {
    provider,
    owner: optionalString(input, "owner"),
    repo: optionalString(input, "repo"),
    branch: optionalString(input, "branch"),
    issueLabels: validatePlainStringList(input.issueLabels, "projectKnowledgeSync.remote.issueLabels", []),
    pullRequestLabels: validatePlainStringList(
      input.pullRequestLabels,
      "projectKnowledgeSync.remote.pullRequestLabels",
      [],
    ),
  };
}

function validateRelationshipMode(value: string): ProjectKnowledgeRelationshipMode {
  switch (value) {
    case "index":
    case "proposal":
    case "copy":
    case "symlink":
    case "remote":
      return value;
    default:
      throw new Error(`Profile projectKnowledgeSync.relationship.mode is unsupported: ${value}`);
  }
}

function validateConflictAction(value: string): ProjectKnowledgeConflictAction {
  switch (value) {
    case "report":
    case "block":
    case "preferProject":
    case "preferExograph":
    case "proposeMerge":
      return value;
    default:
      throw new Error(`Profile projectKnowledgeSync.conflictPolicy.onDivergence is unsupported: ${value}`);
  }
}

function validateSafePathList(input: unknown, field: string, fallback: string[]): string[] {
  return validatePlainStringList(input, field, fallback).map((value) => assertSafeRelativePathOrPattern(value, field));
}

function validatePlainStringList(input: unknown, field: string, fallback: string[]): string[] {
  if (input === undefined) {
    return fallback;
  }
  if (!Array.isArray(input) || !input.every((value) => typeof value === "string" && value.trim().length > 0)) {
    throw new Error(`Profile ${field} must be an array of non-empty strings.`);
  }
  return input.map((value) => value.trim());
}

function optionalSafePath(record: Record<string, unknown>, key: string, field: string): string | undefined {
  const value = optionalString(record, key);
  return value === undefined ? undefined : assertSafeRelativePathOrPattern(value, field);
}

function assertSafeRelativePathOrPattern(value: string, field: string): string {
  if (
    value.startsWith("/") ||
    value.includes("\\") ||
    value.split("/").some((segment) => segment === "..") ||
    /^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(value)
  ) {
    throw new Error(`Profile ${field} must be a relative workspace/project path or pattern without traversal: ${value}`);
  }
  return value;
}

function requiredString(record: Record<string, unknown>, key: string): string {
  const value = record[key];
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(`Profile field ${key} must be a non-empty string.`);
  }
  return value.trim();
}

function optionalString(record: Record<string, unknown>, key: string): string | undefined {
  const value = record[key];
  if (value === undefined) {
    return undefined;
  }
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(`Profile field ${key} must be a non-empty string when provided.`);
  }
  return value.trim();
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
