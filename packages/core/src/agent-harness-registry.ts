import { builtInAgentHarnesses } from "./agent-harnesses/builtins";
import type { AgentHarness } from "./agent-harness";
import {
  MANAGED_AGENT_KINDS,
  type AgentHarnessId,
  type AgentHarnessDetection,
  type AgentLauncherConfig,
  type ManagedAgentKind,
} from "./types";
import type { CapabilitySurface } from "./capabilities";

export class AgentHarnessRegistry {
  private readonly harnesses = new Map<string, AgentHarness>();

  constructor(harnesses: AgentHarness[] = []) {
    this.registerMany(harnesses);
  }

  register(harness: AgentHarness): void {
    const id = harness.metadata.id;
    if (this.harnesses.has(id)) {
      throw new Error(`Agent harness already registered: ${id}`);
    }
    this.harnesses.set(id, harness);
  }

  registerMany(harnesses: AgentHarness[]): void {
    for (const harness of harnesses) {
      this.register(harness);
    }
  }

  get(id: string): AgentHarness | undefined {
    return this.harnesses.get(id);
  }

  require(id: string): AgentHarness {
    const harness = this.get(id);
    if (!harness) {
      throw new Error(`Agent harness is not registered: ${id}`);
    }
    return harness;
  }

  list(): AgentHarness[] {
    return [...this.harnesses.values()];
  }
}

export interface AgentHarnessSurfaceFilter {
  surface: CapabilitySurface;
  requireLaunchable?: boolean;
}

export interface ValidatedAgentHarnessLaunch {
  harnessId: AgentHarnessId;
  terminalKind: ManagedAgentKind;
  detection: AgentHarnessDetection;
  launcher: AgentLauncherConfig;
}

export function createBuiltInAgentHarnessRegistry(): AgentHarnessRegistry {
  return new AgentHarnessRegistry(MANAGED_AGENT_KINDS.map((kind) => builtInAgentHarnesses[kind]));
}

export const agentHarnessRegistry = createBuiltInAgentHarnessRegistry();

export function resolveRegisteredAgentLauncher(kind: ManagedAgentKind, env: NodeJS.ProcessEnv) {
  return agentHarnessRegistry.require(kind).resolveLauncher(env);
}

export function resolveRegisteredAgentLaunchers(env: NodeJS.ProcessEnv): Record<ManagedAgentKind, AgentLauncherConfig> {
  return Object.fromEntries(
    MANAGED_AGENT_KINDS.map((kind) => [kind, resolveRegisteredAgentLauncher(kind, env)]),
  ) as Record<ManagedAgentKind, AgentLauncherConfig>;
}

export function resolveRegisteredAgentHarnessDetection(
  kind: string,
  env: NodeJS.ProcessEnv = process.env,
): AgentHarnessDetection | undefined {
  const harness = agentHarnessRegistry.get(kind);
  if (!harness) {
    return undefined;
  }

  if (harness.resolveDetection) {
    return harness.resolveDetection(env);
  }

  // Compatibility path for simple built-in adapters.
  // Third-party harnesses should provide resolveDetection so missing binaries do not
  // look launchable just because a launcher can be described.
  const launcher = harness.resolveLauncher(env);
  return {
    id: harness.metadata.id,
    adapterId: harness.adapter?.id ?? (harness.kind === "claude" ? "claude-code" : harness.kind),
    family: harness.adapter?.family ?? (harness.kind === "claude" ? "claude-code" : harness.kind),
    label: harness.title,
    productName: harness.adapter?.productName ?? harness.title,
    enabled: true,
    configured: false,
    detected: true,
    launchable: true,
    status: "available",
    statusLabel: "Available",
    setupSummary: "Detected and ready to launch.",
    launcher,
  };
}

export function validateRegisteredAgentHarnessLaunch(kind: string, env: NodeJS.ProcessEnv = process.env): AgentHarnessDetection {
  const detection = resolveRegisteredAgentHarnessDetection(kind, env);
  if (!detection) {
    throw new Error(`Agent harness is not registered: ${kind}. Registered harnesses: ${registeredHarnessIds() || "(none)"}.`);
  }
  if (!detection.launchable) {
    const detail = detection.detail ? ` ${detection.detail}` : "";
    throw new Error(`Agent harness is not launchable: ${kind} (${detection.statusLabel}).${detail}`);
  }
  return detection;
}

export function validateRegisteredAgentHarnessLaunchForSurface(
  harnessId: string,
  filter: AgentHarnessSurfaceFilter,
  env: NodeJS.ProcessEnv = process.env,
): ValidatedAgentHarnessLaunch {
  const harness = agentHarnessRegistry.get(harnessId);
  const launchableIds = formatRegisteredAgentHarnessUsage({ ...filter, requireLaunchable: true }, env) || "(none)";
  if (!harness) {
    throw new Error(
      `Agent harness is not registered: ${harnessId}. Registered harnesses: ${registeredHarnessIds() || "(none)"}. Approved launchable harnesses for ${filter.surface}: ${launchableIds}.`,
    );
  }
  if (
    harness.metadata.lifecycle === "disabled" ||
    !harness.metadata.surfaces.includes(filter.surface) ||
    !harness.metadata.permissions.includes("agents:launch")
  ) {
    throw new Error(
      `Agent harness is not approved for ${filter.surface} launch: ${harnessId}. Approved launchable harnesses for ${filter.surface}: ${launchableIds}.`,
    );
  }

  const detection = resolveRegisteredAgentHarnessDetection(harnessId, env);
  if (!detection || !detection.enabled || detection.visible === false) {
    const status = detection ? `${detection.statusLabel}${detection.detail ? `. ${detection.detail}` : ""}` : "No detection metadata.";
    throw new Error(
      `Agent harness is registered but not enabled for ${filter.surface} launch: ${harnessId} (${status}). Approved launchable harnesses for ${filter.surface}: ${launchableIds}.`,
    );
  }
  if (filter.requireLaunchable && !detection.launchable) {
    const detail = detection.detail ? ` ${detection.detail}` : "";
    throw new Error(
      `Agent harness is not launchable: ${harnessId} (${detection.statusLabel}).${detail} Approved launchable harnesses for ${filter.surface}: ${launchableIds}.`,
    );
  }

  const launcher = detection.launcher ?? harness.resolveLauncher(env);
  return {
    harnessId: detection.id,
    terminalKind: launcher.kind,
    detection,
    launcher,
  };
}

export function resolveRegisteredAgentHarnesses(env: NodeJS.ProcessEnv = process.env): AgentHarnessDetection[] {
  return agentHarnessRegistry
    .list()
    .map((harness) => resolveRegisteredAgentHarnessDetection(harness.metadata.id, env))
    .filter((detection): detection is AgentHarnessDetection => {
      if (!detection) {
        return false;
      }
      return detection.visible !== false;
    });
}

export function resolveRegisteredAgentHarnessesForSurface(
  filter: AgentHarnessSurfaceFilter,
  env: NodeJS.ProcessEnv = process.env,
): AgentHarnessDetection[] {
  const seen = new Set<AgentHarnessId>();
  const harnesses: AgentHarnessDetection[] = [];
  for (const harness of agentHarnessRegistry.list()) {
    if (
      harness.metadata.lifecycle === "disabled" ||
      !harness.metadata.surfaces.includes(filter.surface) ||
      !harness.metadata.permissions.includes("agents:launch")
    ) {
      continue;
    }

    const detection = resolveRegisteredAgentHarnessDetection(harness.metadata.id, env);
    if (
      !detection ||
      !detection.enabled ||
      detection.visible === false ||
      (filter.requireLaunchable && !detection.launchable) ||
      seen.has(detection.id)
    ) {
      continue;
    }
    seen.add(detection.id);
    harnesses.push(detection);
  }
  return harnesses;
}

export function formatRegisteredAgentHarnessUsage(
  filter: AgentHarnessSurfaceFilter,
  env: NodeJS.ProcessEnv = process.env,
): string {
  return resolveRegisteredAgentHarnessesForSurface(filter, env).map((harness) => harness.id).join("|");
}

export function normalizeRegisteredAgentHarnessKindForSurface(
  value: string | undefined,
  filter: AgentHarnessSurfaceFilter,
  env: NodeJS.ProcessEnv = process.env,
): AgentHarnessId | null {
  if (!value) {
    return null;
  }
  return resolveRegisteredAgentHarnessesForSurface(filter, env).find((harness) => harness.id === value)?.id ?? null;
}

function registeredHarnessIds(): string {
  return agentHarnessRegistry.list().map((harness) => harness.metadata.id).join("|");
}
