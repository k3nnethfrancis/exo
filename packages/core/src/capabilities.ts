export type CapabilityKind =
  | "core:searchProvider"
  | "core:agentHarness"
  | "core:profile"
  | "core:routineTemplate"
  | "exo.graph:analyzer"
  | "exo.graph:visualization"
  | "exo.training:traceCollector"
  | "exo.training:datasetExporter"
  | "exo.training:evalRunner";

export type CapabilityLifecycle = "built-in" | "experimental" | "disabled";
export type CapabilitySurface = "desktop" | "cli" | "mcp" | "commandServer" | "internal";

export type PermissionResource = "workspace" | "notes" | "projects" | "terminals" | "agents" | "network" | "artifacts";
export type PermissionAction = "read" | "propose" | "write" | "launch" | "access";
export type PermissionScopeKind = "root" | "path" | "harness";
export type PermissionScope =
  | { kind: "root"; noteRootId: string }
  | { kind: "path"; workspaceRelativePrefix: string }
  | { kind: "harness"; harnessId: string };
export type CapabilityPermission =
  | `${PermissionResource}:${PermissionAction}`
  | `${PermissionResource}:${PermissionAction}:${PermissionScopeKind}:${string}`;
export type PermissionCompatibilityStatus = "current" | "compatible-unscoped" | "broad-write";

export interface PermissionActionMetadata {
  action: PermissionAction;
  label: string;
  reviewCopy: string;
  risk: "low" | "reviewed-write" | "direct-write" | "launch" | "network";
}

export interface PermissionGrant {
  permission: CapabilityPermission;
  resource: PermissionResource;
  action: PermissionAction;
  scope?: PermissionScope;
  compatibilityStatus: PermissionCompatibilityStatus;
  actionMetadata: PermissionActionMetadata;
  breadthCopy?: string;
}

export interface CapabilityMetadata {
  id: string;
  kind: CapabilityKind;
  label: string;
  description: string;
  lifecycle: CapabilityLifecycle;
  owner: string;
  surfaces: CapabilitySurface[];
  permissions: CapabilityPermission[];
  compatibility?: Record<string, unknown>;
  statusNotes?: string[];
}

const PERMISSION_ACTION_METADATA = {
  read: {
    action: "read",
    label: "Read",
    reviewCopy: "Read matching workspace data.",
    risk: "low",
  },
  propose: {
    action: "propose",
    label: "Suggest changes",
    reviewCopy: "The plugin drafts edits; nothing is written until you review and accept.",
    risk: "reviewed-write",
  },
  write: {
    action: "write",
    label: "Edit files directly",
    reviewCopy: "Changes are applied immediately, without review.",
    risk: "direct-write",
  },
  launch: {
    action: "launch",
    label: "Launch",
    reviewCopy: "Launch matching local runtime resources.",
    risk: "launch",
  },
  access: {
    action: "access",
    label: "Access",
    reviewCopy: "Access matching external resources.",
    risk: "network",
  },
} satisfies Record<PermissionAction, PermissionActionMetadata>;

const RESOURCE_ACTIONS = {
  workspace: ["read"],
  notes: ["read", "propose", "write"],
  projects: ["read", "propose", "write"],
  terminals: ["launch"],
  agents: ["launch"],
  network: ["access"],
  artifacts: ["write"],
} satisfies Record<PermissionResource, readonly PermissionAction[]>;

const SCOPES = ["root", "path", "harness"] satisfies PermissionScopeKind[];

export function parseCapabilityPermission(rawPermission: string): PermissionGrant {
  const parts = rawPermission.split(":");
  if (parts.length !== 2 && parts.length !== 4) {
    throw new Error(`Plugin permission must be <resource>:<action> or <resource>:<action>:<scopeKind>:<scopeValue>: ${rawPermission}`);
  }
  const resource = parts[0] ?? "";
  const action = parts[1];
  const scopeKind = parts[2];
  const scopeValue = parts[3] ?? "";
  if (!isPermissionResource(resource)) {
    throw new Error(`Plugin permission contains unsupported resource: ${resource}`);
  }
  if (!isPermissionActionForResource(resource, action)) {
    throw new Error(`Plugin permission ${rawPermission} contains unsupported action for ${resource}: ${action}`);
  }
  const scope = parsePermissionScope(rawPermission, scopeKind, scopeValue);
  const permission = serializePermissionGrant({ resource, action, scope });
  return {
    permission,
    resource,
    action,
    scope,
    compatibilityStatus: permissionCompatibilityStatus(resource, action, scope),
    actionMetadata: PERMISSION_ACTION_METADATA[action],
    breadthCopy: permissionBreadthCopy(resource, action, scope),
  };
}

export function normalizeCapabilityPermission(rawPermission: string): CapabilityPermission {
  return parseCapabilityPermission(rawPermission).permission;
}

export function serializePermissionGrant(input: {
  resource: PermissionResource;
  action: PermissionAction;
  scope?: PermissionScope;
}): CapabilityPermission {
  if (input.scope === undefined) {
    return `${input.resource}:${input.action}`;
  }
  switch (input.scope.kind) {
    case "root":
      return `${input.resource}:${input.action}:root:${input.scope.noteRootId}`;
    case "path":
      return `${input.resource}:${input.action}:path:${input.scope.workspaceRelativePrefix}`;
    case "harness":
      return `${input.resource}:${input.action}:harness:${input.scope.harnessId}`;
  }
}

export function permissionActionMetadata(action: PermissionAction): PermissionActionMetadata {
  return PERMISSION_ACTION_METADATA[action];
}

export function describeCapabilityPermission(permission: CapabilityPermission): PermissionGrant {
  return parseCapabilityPermission(permission);
}

function parsePermissionScope(
  rawPermission: string,
  scopeKind: string | undefined,
  scopeValue: string,
): PermissionScope | undefined {
  if (scopeKind === undefined) {
    return undefined;
  }
  if (!isPermissionScopeKind(scopeKind)) {
    throw new Error(`Plugin permission ${rawPermission} contains unsupported scope kind: ${scopeKind}`);
  }
  if (scopeValue.trim().length === 0) {
    throw new Error(`Plugin permission ${rawPermission} must include a non-empty ${scopeKind} scope value.`);
  }
  if (scopeKind === "path") {
    assertSafePermissionPath(scopeValue, rawPermission);
    return { kind: scopeKind, workspaceRelativePrefix: scopeValue };
  }
  if (scopeKind === "root") {
    return { kind: scopeKind, noteRootId: scopeValue };
  }
  return { kind: scopeKind, harnessId: scopeValue };
}

function permissionCompatibilityStatus(
  resource: PermissionResource,
  action: PermissionAction,
  scope: PermissionScope | undefined,
): PermissionCompatibilityStatus {
  if (scope !== undefined) {
    return "current";
  }
  if (action === "write" && (resource === "notes" || resource === "projects" || resource === "artifacts")) {
    return "broad-write";
  }
  return "compatible-unscoped";
}

function permissionBreadthCopy(
  resource: PermissionResource,
  action: PermissionAction,
  scope: PermissionScope | undefined,
): string | undefined {
  if (scope !== undefined) {
    return undefined;
  }
  if (action === "write" && resource === "notes") {
    return "Can edit any file in your vault, without review.";
  }
  if (action === "write" && resource === "projects") {
    return "Can edit any file in your projects, without review.";
  }
  if (action === "write" && resource === "artifacts") {
    return "Can write artifacts without review.";
  }
  return undefined;
}

function assertSafePermissionPath(value: string, rawPermission: string): void {
  if (value.startsWith("/") || value.split("/").some((segment) => segment === "..")) {
    throw new Error(`Plugin permission ${rawPermission} path scope must be a workspace-relative prefix.`);
  }
}

function isPermissionResource(value: string): value is PermissionResource {
  return Object.prototype.hasOwnProperty.call(RESOURCE_ACTIONS, value);
}

function isPermissionActionForResource(
  resource: PermissionResource,
  value: string | undefined,
): value is PermissionAction {
  if (value === undefined) {
    return false;
  }
  return (RESOURCE_ACTIONS[resource] as readonly string[]).includes(value);
}

function isPermissionScopeKind(value: string): value is PermissionScopeKind {
  return (SCOPES as readonly string[]).includes(value);
}

export const builtInCapabilities = [
  {
    id: "qmd",
    kind: "core:searchProvider",
    label: "QMD advanced search",
    description: "Bundled advanced local Markdown search provider plugin. Core filename, path, and text search remains available without it.",
    lifecycle: "built-in",
    owner: "@exo/core/qmd",
    surfaces: ["desktop", "cli", "mcp", "commandServer", "internal"],
    permissions: ["workspace:read", "notes:read"],
    compatibility: {
      indexBackend: "qmd",
    },
  },
  {
    id: "shell",
    kind: "core:agentHarness",
    label: "Shell",
    description: "Built-in interactive shell harness.",
    lifecycle: "built-in",
    owner: "@exo/core/runtime",
    surfaces: ["desktop", "cli", "mcp", "commandServer", "internal"],
    permissions: ["workspace:read", "projects:read", "terminals:launch", "agents:launch"],
    compatibility: {
      managedAgentKind: "shell",
    },
  },
  {
    id: "claude",
    kind: "core:agentHarness",
    label: "Claude",
    description: "Built-in Claude terminal agent harness.",
    lifecycle: "built-in",
    owner: "@exo/core/runtime",
    surfaces: ["desktop", "cli", "mcp", "commandServer", "internal"],
    permissions: ["workspace:read", "notes:read", "projects:read", "terminals:launch", "agents:launch"],
    compatibility: {
      managedAgentKind: "claude",
    },
  },
  {
    id: "codex",
    kind: "core:agentHarness",
    label: "Codex",
    description: "Built-in Codex terminal agent harness.",
    lifecycle: "built-in",
    owner: "@exo/core/runtime",
    surfaces: ["desktop", "cli", "mcp", "commandServer", "internal"],
    permissions: ["workspace:read", "notes:read", "projects:read", "terminals:launch", "agents:launch"],
    compatibility: {
      managedAgentKind: "codex",
    },
  },
  {
    id: "pi",
    kind: "core:agentHarness",
    label: "Pi",
    description: "Built-in Pi terminal agent harness adapter.",
    lifecycle: "built-in",
    owner: "@exo/core/runtime",
    surfaces: ["desktop", "cli", "mcp", "commandServer", "internal"],
    permissions: ["workspace:read", "notes:read", "projects:read", "terminals:launch", "agents:launch"],
    compatibility: {
      managedAgentKind: "pi",
    },
  },
  {
    id: "hermes",
    kind: "core:agentHarness",
    label: "Hermes",
    description: "Built-in Hermes terminal agent harness adapter.",
    lifecycle: "built-in",
    owner: "@exo/core/runtime",
    surfaces: ["desktop", "cli", "mcp", "commandServer", "internal"],
    permissions: ["workspace:read", "notes:read", "projects:read", "terminals:launch", "agents:launch"],
    compatibility: {
      managedAgentKind: "hermes",
    },
  },
] satisfies CapabilityMetadata[];

export const capabilityKinds = [
  "core:searchProvider",
  "core:agentHarness",
  "core:profile",
  "core:routineTemplate",
  "exo.graph:analyzer",
  "exo.graph:visualization",
  "exo.training:traceCollector",
  "exo.training:datasetExporter",
  "exo.training:evalRunner",
] satisfies CapabilityKind[];

export interface ParsedCapabilityKind {
  kind: CapabilityKind;
}

export function parseCapabilityKind(rawKind: string): ParsedCapabilityKind {
  if (isCapabilityKind(rawKind)) {
    return { kind: rawKind };
  }
  throw new Error(`capability.kind contains unsupported value: ${rawKind}`);
}

export function isCapabilityKind(value: string): value is CapabilityKind {
  return (capabilityKinds as readonly string[]).includes(value);
}
