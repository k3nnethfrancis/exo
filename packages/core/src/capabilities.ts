export type CapabilityKind =
  | "searchProvider"
  | "agentHarness"
  | "profile"
  | "analyzer"
  | "traceCollector"
  | "datasetExporter"
  | "evalRunner"
  | "routineTemplate";

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
}

export const builtInCapabilities = [
  {
    id: "qmd",
    kind: "searchProvider",
    label: "QMD",
    description: "Default local Markdown search and indexing provider.",
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
    kind: "agentHarness",
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
    kind: "agentHarness",
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
    kind: "agentHarness",
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
    id: "guardian-angel-trace-collector",
    kind: "traceCollector",
    label: "Guardian Angel Trace Collector",
    description: "Experimental trace collector contract for Guardian Angel runs, review labels, and export artifacts.",
    lifecycle: "experimental",
    owner: "@exo/core/guardian-angel",
    surfaces: ["internal"],
    permissions: ["workspace:read", "notes:read", "artifacts:write"],
    compatibility: {
      routineFamily: "guardian-angel",
    },
  },
] satisfies CapabilityMetadata[];
