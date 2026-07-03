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

export type CapabilityPermission =
  | "workspace:read"
  | "notes:read"
  | "notes:write"
  | "projects:read"
  | "projects:write"
  | "terminals:launch"
  | "agents:launch"
  | "network:access"
  | "artifacts:write";

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

const LEGACY_CAPABILITY_KIND_ALIASES = {
  searchProvider: "core:searchProvider",
  agentHarness: "core:agentHarness",
  profile: "core:profile",
  routineTemplate: "core:routineTemplate",
  analyzer: "exo.graph:analyzer",
  graphVisualization: "exo.graph:visualization",
  traceCollector: "exo.training:traceCollector",
  datasetExporter: "exo.training:datasetExporter",
  evalRunner: "exo.training:evalRunner",
} satisfies Record<string, CapabilityKind>;

type LegacyCapabilityKind = keyof typeof LEGACY_CAPABILITY_KIND_ALIASES;

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
  deprecationNote?: string;
}

export function parseCapabilityKind(rawKind: string): ParsedCapabilityKind {
  if (isCapabilityKind(rawKind)) {
    return { kind: rawKind };
  }
  if (isLegacyCapabilityKind(rawKind)) {
    const alias = LEGACY_CAPABILITY_KIND_ALIASES[rawKind];
    return {
      kind: alias,
      deprecationNote: `Capability kind "${rawKind}" is deprecated; use "${alias}". TODO: remove legacy capability kind aliases after one release cycle.`,
    };
  }
  throw new Error(`capability.kind contains unsupported value: ${rawKind}`);
}

export function isCapabilityKind(value: string): value is CapabilityKind {
  return (capabilityKinds as readonly string[]).includes(value);
}

function isLegacyCapabilityKind(value: string): value is LegacyCapabilityKind {
  return Object.prototype.hasOwnProperty.call(LEGACY_CAPABILITY_KIND_ALIASES, value);
}
