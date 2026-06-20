import type { CapabilityMetadata } from "./capabilities";
import type { AgentHarnessDetection, AgentLauncherConfig, ManagedAgentKind } from "./types";

export type HarnessSkillSource = "built-in" | "filesystem" | "external";

export interface HarnessSkillMetadata {
  id: string;
  label: string;
  description?: string;
  source: HarnessSkillSource;
  enabled: boolean;
}

export interface AgentHarness {
  metadata: CapabilityMetadata;
  kind: ManagedAgentKind;
  title: string;
  skills: readonly HarnessSkillMetadata[];
  resolveLauncher(env: NodeJS.ProcessEnv): AgentLauncherConfig;
  resolveDetection?(env: NodeJS.ProcessEnv): AgentHarnessDetection;
}

export type AgentHarnessMap = Record<ManagedAgentKind, AgentHarness>;
