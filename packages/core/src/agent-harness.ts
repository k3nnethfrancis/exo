import type { CapabilityMetadata } from "./capabilities";
import type { AgentLauncherConfig, ManagedAgentKind } from "./types";

export interface AgentHarness {
  metadata: CapabilityMetadata;
  kind: ManagedAgentKind;
  title: string;
  resolveLauncher(env: NodeJS.ProcessEnv): AgentLauncherConfig;
}

export type AgentHarnessMap = Record<ManagedAgentKind, AgentHarness>;
