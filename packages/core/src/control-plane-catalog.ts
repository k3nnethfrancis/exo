export type ControlPlaneSurface = "mcp" | "cli" | "desktop" | "internal";

export type ControlPlaneRiskClass =
  | "orientation"
  | "read"
  | "view-control"
  | "agent-lifecycle"
  | "agent-input"
  | "destructive"
  | "admin";

export type ControlPlaneExposureProfile = "off" | "everyday" | "dev" | "custom";

export interface ControlPlaneCatalogEntry {
  id: string;
  label: string;
  description: string;
  riskClass: ControlPlaneRiskClass;
  surfaces: ControlPlaneSurface[];
  commandRoute?: string;
  mcpToolName?: string;
  defaultProfiles: ControlPlaneExposureProfile[];
  safeForAgentUse: boolean;
  safeForRoutineAutomation: boolean;
  operatorOnly: boolean;
}

export const CONTROL_PLANE_EXPOSURE_PROFILES: ControlPlaneExposureProfile[] = ["off", "everyday", "dev", "custom"];

export const CONTROL_PLANE_CATALOG: ControlPlaneCatalogEntry[] = [
  {
    id: "mcp.workspace_status",
    label: "Workspace status",
    description: "Read Exo workspace orientation, roots, index summary, and runtime health.",
    riskClass: "orientation",
    surfaces: ["mcp", "cli", "desktop"],
    commandRoute: "GET /status",
    mcpToolName: "workspace_status",
    defaultProfiles: ["everyday", "dev"],
    safeForAgentUse: true,
    safeForRoutineAutomation: true,
    operatorOnly: false,
  },
  {
    id: "mcp.search",
    label: "Search",
    description: "Search configured Exo roots through core and advanced search providers.",
    riskClass: "read",
    surfaces: ["mcp", "cli", "desktop"],
    commandRoute: "GET /search",
    mcpToolName: "search",
    defaultProfiles: ["everyday", "dev"],
    safeForAgentUse: true,
    safeForRoutineAutomation: true,
    operatorOnly: false,
  },
  {
    id: "mcp.read_document",
    label: "Read document",
    description: "Read a bounded indexed or filesystem document target.",
    riskClass: "read",
    surfaces: ["mcp", "cli", "desktop"],
    commandRoute: "POST /read",
    mcpToolName: "read_document",
    defaultProfiles: ["everyday", "dev"],
    safeForAgentUse: true,
    safeForRoutineAutomation: true,
    operatorOnly: false,
  },
  {
    id: "mcp.open_preview",
    label: "Open preview",
    description: "Open a URL or local HTML artifact in Exo's core preview host.",
    riskClass: "view-control",
    surfaces: ["mcp", "cli", "desktop"],
    commandRoute: "POST /preview/open",
    mcpToolName: "open_preview",
    defaultProfiles: ["everyday", "dev"],
    safeForAgentUse: true,
    safeForRoutineAutomation: false,
    operatorOnly: false,
  },
  {
    id: "mcp.focus_preview",
    label: "Focus preview",
    description: "Focus Exo's core preview host.",
    riskClass: "view-control",
    surfaces: ["mcp", "cli", "desktop"],
    commandRoute: "POST /preview/focus",
    mcpToolName: "focus_preview",
    defaultProfiles: ["everyday", "dev"],
    safeForAgentUse: true,
    safeForRoutineAutomation: false,
    operatorOnly: false,
  },
  {
    id: "mcp.close_preview",
    label: "Close preview",
    description: "Close an open Exo preview pane.",
    riskClass: "view-control",
    surfaces: ["mcp", "cli", "desktop"],
    commandRoute: "POST /preview/close",
    mcpToolName: "close_preview",
    defaultProfiles: ["everyday", "dev"],
    safeForAgentUse: true,
    safeForRoutineAutomation: false,
    operatorOnly: false,
  },
  {
    id: "mcp.list_agents",
    label: "List agents",
    description: "List live Exo terminal agent sessions.",
    riskClass: "orientation",
    surfaces: ["mcp", "cli", "desktop"],
    commandRoute: "GET /terminals",
    mcpToolName: "list_agents",
    defaultProfiles: ["dev"],
    safeForAgentUse: true,
    safeForRoutineAutomation: true,
    operatorOnly: false,
  },
  {
    id: "mcp.create_agent",
    label: "Create agent",
    description: "Start a supervised Exo terminal/harness session.",
    riskClass: "agent-lifecycle",
    surfaces: ["mcp", "cli", "desktop"],
    commandRoute: "POST /terminals",
    mcpToolName: "create_agent",
    defaultProfiles: ["dev"],
    safeForAgentUse: false,
    safeForRoutineAutomation: false,
    operatorOnly: true,
  },
  {
    id: "mcp.read_agent",
    label: "Read agent",
    description: "Read bounded live terminal/transcript or semantic trace evidence.",
    riskClass: "read",
    surfaces: ["mcp", "cli", "desktop"],
    commandRoute: "GET /terminals/:id/tail",
    mcpToolName: "read_agent",
    defaultProfiles: ["dev"],
    safeForAgentUse: true,
    safeForRoutineAutomation: true,
    operatorOnly: false,
  },
  {
    id: "mcp.send_agent_message",
    label: "Send agent message",
    description: "Submit semantic text to a live Exo-managed agent session.",
    riskClass: "agent-input",
    surfaces: ["mcp", "cli", "desktop"],
    commandRoute: "POST /terminals/:id/message",
    mcpToolName: "send_agent_message",
    defaultProfiles: ["dev"],
    safeForAgentUse: false,
    safeForRoutineAutomation: false,
    operatorOnly: true,
  },
  {
    id: "mcp.interrupt_agent",
    label: "Interrupt agent",
    description: "Send Escape or Ctrl-C to a live Exo-managed agent session.",
    riskClass: "agent-input",
    surfaces: ["mcp", "cli", "desktop"],
    commandRoute: "POST /terminals/:id/write",
    mcpToolName: "interrupt_agent",
    defaultProfiles: ["dev"],
    safeForAgentUse: false,
    safeForRoutineAutomation: false,
    operatorOnly: true,
  },
  {
    id: "mcp.terminate_agent",
    label: "Terminate agent",
    description: "Terminate an Exo-managed terminal/session.",
    riskClass: "destructive",
    surfaces: ["mcp", "cli", "desktop"],
    commandRoute: "DELETE /terminals/:id",
    mcpToolName: "terminate_agent",
    defaultProfiles: ["dev"],
    safeForAgentUse: false,
    safeForRoutineAutomation: false,
    operatorOnly: true,
  },
];

const MCP_TOOL_NAMES = new Set(CONTROL_PLANE_CATALOG.flatMap((entry) => entry.mcpToolName ? [entry.mcpToolName] : []));

export function controlPlaneEntriesForSurface(surface: ControlPlaneSurface): ControlPlaneCatalogEntry[] {
  return CONTROL_PLANE_CATALOG.filter((entry) => entry.surfaces.includes(surface));
}

export function resolveControlPlaneExposureProfile(value: string | undefined, fallback: ControlPlaneExposureProfile = "dev"): ControlPlaneExposureProfile {
  if (!value) {
    return fallback;
  }
  return isControlPlaneExposureProfile(value) ? value : fallback;
}

export function isControlPlaneExposureProfile(value: string): value is ControlPlaneExposureProfile {
  return (CONTROL_PLANE_EXPOSURE_PROFILES as string[]).includes(value);
}

export function isKnownMcpToolName(value: string): boolean {
  return MCP_TOOL_NAMES.has(value);
}

export function mcpToolsForExposureProfile(profile: ControlPlaneExposureProfile, customTools: Iterable<string> = []): string[] {
  if (profile === "off") {
    return [];
  }
  if (profile === "custom") {
    return Array.from(new Set(Array.from(customTools).filter((tool) => MCP_TOOL_NAMES.has(tool)))).sort();
  }
  return CONTROL_PLANE_CATALOG
    .filter((entry) => entry.mcpToolName && entry.defaultProfiles.includes(profile))
    .map((entry) => entry.mcpToolName!)
    .sort();
}

export function isMcpToolExposed(toolName: string, profile: ControlPlaneExposureProfile, customTools: Iterable<string> = []): boolean {
  return mcpToolsForExposureProfile(profile, customTools).includes(toolName);
}

export function parseMcpCustomToolList(value: string | undefined): string[] {
  if (!value) {
    return [];
  }
  return value.split(",").map((item) => item.trim()).filter(Boolean);
}
