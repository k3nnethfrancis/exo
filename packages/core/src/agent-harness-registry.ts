import { builtInAgentHarnesses } from "./agent-harnesses/builtins";
import type { AgentHarness } from "./agent-harness";
import type { AgentHarnessDetection, ManagedAgentKind } from "./types";

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

  require(id: ManagedAgentKind): AgentHarness {
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

export function createBuiltInAgentHarnessRegistry(): AgentHarnessRegistry {
  return new AgentHarnessRegistry([
    builtInAgentHarnesses.shell,
    builtInAgentHarnesses.claude,
    builtInAgentHarnesses.codex,
    builtInAgentHarnesses.pi,
    builtInAgentHarnesses.hermes,
  ]);
}

export const agentHarnessRegistry = createBuiltInAgentHarnessRegistry();

export function resolveRegisteredAgentLauncher(kind: ManagedAgentKind, env: NodeJS.ProcessEnv) {
  return agentHarnessRegistry.require(kind).resolveLauncher(env);
}

export function resolveRegisteredAgentHarnesses(env: NodeJS.ProcessEnv = process.env): AgentHarnessDetection[] {
  return agentHarnessRegistry.list().map((harness) => {
    if (harness.resolveDetection) {
      return harness.resolveDetection(env);
    }

    const launcher = harness.resolveLauncher(env);
    return {
      id: harness.kind,
      adapterId: harness.kind === "claude" ? "claude-code" : harness.kind,
      family: harness.kind === "claude" ? "claude-code" : harness.kind,
      label: harness.title,
      productName: harness.title,
      enabled: true,
      configured: false,
      detected: true,
      launchable: true,
      status: "available",
      statusLabel: "Available",
      launcher,
    };
  });
}
