import { builtInAgentHarnesses } from "./agent-harnesses/builtins";
import type { AgentHarness } from "./agent-harness";
import type { ManagedAgentKind } from "./types";

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
  return new AgentHarnessRegistry([builtInAgentHarnesses.shell, builtInAgentHarnesses.claude, builtInAgentHarnesses.codex]);
}

export const agentHarnessRegistry = createBuiltInAgentHarnessRegistry();

export function resolveRegisteredAgentLauncher(kind: ManagedAgentKind, env: NodeJS.ProcessEnv) {
  return agentHarnessRegistry.require(kind).resolveLauncher(env);
}
