import type { CapabilityMetadata } from "./capabilities";
import type {
  AgentHarnessAdapterId,
  AgentHarnessDependencyStatus,
  AgentHarnessDetection,
  AgentLauncherConfig,
  ManagedAgentKind,
} from "./types";

export type HarnessSkillSource = "built-in" | "filesystem" | "external";
export type HarnessConfigSource = "environment" | "filesystem" | "command" | "service";
export type HarnessConfigValueKind = "string" | "path" | "url" | "boolean" | "number" | "secret" | "json";
export type HarnessSemanticMessageMode = "paste-enter" | "stdin" | "command" | "file";
export type HarnessReadinessSignal = "none" | "process-started" | "stdout-pattern" | "stderr-pattern" | "prompt-pattern" | "external-probe";
export type HarnessSetupActionKind = "install" | "configure" | "authenticate" | "start-service" | "verify";
export type AgentHarnessPluginContractVersion = "agent-harness.v1";

export interface AgentHarnessAdapterMetadata {
  id: AgentHarnessAdapterId;
  family: AgentHarnessAdapterId;
  productName: string;
  executableNames?: readonly string[];
  homepageUrl?: string;
  documentationUrl?: string;
}

export interface HarnessSkillMetadata {
  id: string;
  label: string;
  description?: string;
  source: HarnessSkillSource;
  enabled: boolean;
  harnesses?: readonly AgentHarnessAdapterId[];
  configPaths?: readonly string[];
  required?: boolean;
  detail?: string;
}

export interface HarnessConfigInventoryItem {
  id: string;
  label: string;
  source: HarnessConfigSource;
  valueKind: HarnessConfigValueKind;
  required: boolean;
  configured: boolean;
  location?: string;
  envVar?: string;
  command?: string;
  redacted?: boolean;
  detail?: string;
}

export interface HarnessReadinessContract {
  signal: HarnessReadinessSignal;
  pattern?: string;
  timeoutMs?: number;
  graceMs?: number;
  failurePatterns?: readonly string[];
  detail?: string;
}

export interface HarnessSemanticMessageContract {
  modes: readonly HarnessSemanticMessageMode[];
  defaultMode: HarnessSemanticMessageMode;
  supportsMultiline: boolean;
  submitOnEnter: boolean;
  submitDelayMs?: number;
  readiness?: HarnessReadinessContract;
  detail?: string;
}

export interface HarnessSetupAction {
  id: string;
  kind: HarnessSetupActionKind;
  label: string;
  description?: string;
  command?: string;
  url?: string;
  required: boolean;
}

export interface HarnessSetupGuide {
  summary: string;
  actions: readonly HarnessSetupAction[];
  dependencies?: readonly AgentHarnessDependencyStatus[];
}

export interface AgentHarness {
  readonly contractVersion?: AgentHarnessPluginContractVersion;
  metadata: CapabilityMetadata;
  kind: ManagedAgentKind;
  title: string;
  adapter?: AgentHarnessAdapterMetadata;
  skills: readonly HarnessSkillMetadata[];
  configs?: readonly HarnessConfigInventoryItem[];
  semanticMessages?: HarnessSemanticMessageContract;
  setup?: HarnessSetupGuide;
  terminalOwnership?: "core";
  resolveLauncher(env: NodeJS.ProcessEnv): AgentLauncherConfig;
  resolveDetection?(env: NodeJS.ProcessEnv): AgentHarnessDetection;
}

export type AgentHarnessMap = Record<ManagedAgentKind, AgentHarness>;
