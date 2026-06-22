import path from "node:path";
import { accessSync, constants, existsSync } from "node:fs";

import { builtInCapabilities, type CapabilityMetadata } from "../capabilities";
import type { AgentHarness, AgentHarnessMap } from "../agent-harness";
import type {
  AgentHarnessAdapterId,
  AgentHarnessDependencyStatus,
  AgentHarnessDetection,
  AgentLauncherConfig,
  ManagedAgentKind,
} from "../types";

function splitEnvArgs(rawValue?: string): string[] {
  if (!rawValue) {
    return [];
  }

  return rawValue
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);
}

function resolveCapabilityMetadata(id: ManagedAgentKind): CapabilityMetadata {
  const metadata = builtInCapabilities.find((capability) => capability.id === id);
  if (!metadata) {
    throw new Error(`Built-in agent harness metadata is not registered: ${id}`);
  }
  return metadata;
}

function isExecutable(filePath: string): boolean {
  try {
    accessSync(filePath, constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

function resolvePathCommand(command: string, env: NodeJS.ProcessEnv): string | undefined {
  if (path.isAbsolute(command) || command.includes(path.sep)) {
    return isExecutable(command) ? command : undefined;
  }

  const pathValue = env.PATH ?? process.env.PATH ?? "";
  for (const directory of pathValue.split(path.delimiter).filter(Boolean)) {
    const candidate = path.join(directory, command);
    if (isExecutable(candidate)) {
      return candidate;
    }
  }

  return undefined;
}

function splitPathList(rawValue?: string): string[] {
  return rawValue?.split(path.delimiter).map((value) => value.trim()).filter(Boolean) ?? [];
}

function envFlagEnabled(rawValue?: string): boolean {
  return rawValue !== "0" && rawValue !== "false";
}

function discoverPiSourceCheckout(env: NodeJS.ProcessEnv): { repoPath: string; cliPath: string } | undefined {
  const candidates = [
    env.EXO_PI_REPO_PATH,
    ...splitPathList(env.EXO_PROJECT_ROOTS),
  ].filter((value): value is string => Boolean(value));

  for (const repoPath of candidates) {
    const cliPath = path.join(repoPath, "packages", "coding-agent", "dist", "cli.js");
    if (existsSync(cliPath)) {
      return { repoPath, cliPath };
    }
  }

  return undefined;
}

function detectionFor(input: {
  id: ManagedAgentKind;
  adapterId: AgentHarnessAdapterId;
  label: string;
  productName?: string;
  launcher: AgentLauncherConfig;
  configured: boolean;
  enabled?: boolean;
  executablePath?: string;
  repoPath?: string;
  channel?: string;
  build?: string;
  install?: AgentHarnessDetection["install"];
  detail?: string;
  dependencies?: AgentHarnessDependencyStatus[];
  visible?: boolean;
}): AgentHarnessDetection {
  const enabled = input.enabled ?? true;
  const repoExists = input.repoPath ? existsSync(input.repoPath) : false;
  const detected = Boolean(input.executablePath) || repoExists;
  const missingRequiredDependencies = input.dependencies?.filter((dependency) => dependency.required && !dependency.satisfied) ?? [];
  const launchable = enabled && Boolean(input.executablePath) && missingRequiredDependencies.length === 0;
  const status = !enabled
    ? "disabled"
    : missingRequiredDependencies.length > 0 && detected
      ? "missing-dependency"
      : launchable
      ? input.configured ? "configured" : "available"
      : input.configured || repoExists
        ? "broken"
        : "not-found";

  return {
    id: input.id,
    adapterId: input.adapterId,
    family: input.adapterId,
    label: input.label,
    productName: input.productName ?? input.label,
    enabled,
    configured: input.configured,
    detected,
    launchable,
    status,
    statusLabel: statusLabel(status),
    executablePath: input.executablePath,
    repoPath: input.repoPath,
    channel: input.channel,
    build: input.build,
    install: input.install,
    detail: input.detail,
    dependencies: input.dependencies,
    launcher: launchable ? input.launcher : undefined,
    visible: input.visible,
  };
}

function statusLabel(status: AgentHarnessDetection["status"]): string {
  switch (status) {
    case "available":
      return "Available";
    case "configured":
      return "Configured";
    case "not-found":
      return "Not found";
    case "disabled":
      return "Disabled";
    case "broken":
      return "Broken";
    case "missing-dependency":
      return "Missing dependency";
  }
}

function withCodexReasoningEffortOverride(args: string[], env: NodeJS.ProcessEnv): string[] {
  const configuredArgs = [...args];
  const alreadyOverridesReasoningEffort = configuredArgs.some((arg, index) => {
    if (arg.includes("model_reasoning_effort")) {
      return true;
    }

    return arg === "-c" && typeof configuredArgs[index + 1] === "string" && configuredArgs[index + 1].includes("model_reasoning_effort");
  });

  if (alreadyOverridesReasoningEffort) {
    return configuredArgs;
  }

  const effort = normalizeCodexReasoningEffort(env.EXO_CODEX_REASONING_EFFORT);
  configuredArgs.push("-c", `model_reasoning_effort="${effort}"`);
  return configuredArgs;
}

function normalizeCodexReasoningEffort(rawValue?: string): "minimal" | "low" | "medium" | "high" {
  switch (rawValue) {
    case "minimal":
    case "low":
    case "medium":
    case "high":
      return rawValue;
    default:
      return "high";
  }
}

class ShellAgentHarness implements AgentHarness {
  readonly kind = "shell";
  readonly title = "Terminal";
  readonly metadata = resolveCapabilityMetadata(this.kind);
  readonly skills = [];

  resolveLauncher(env: NodeJS.ProcessEnv): AgentLauncherConfig {
    const command = env.EXO_SHELL ?? env.SHELL ?? "/bin/zsh";
    const args = splitEnvArgs(env.EXO_SHELL_ARGS);

    return {
      kind: this.kind,
      title: this.title,
      command,
      args: args.length > 0 ? args : path.basename(command).includes("zsh") ? ["-l"] : [],
    };
  }

  resolveDetection(env: NodeJS.ProcessEnv): AgentHarnessDetection {
    const launcher = this.resolveLauncher(env);
    return detectionFor({
      id: this.kind,
      adapterId: "shell",
      label: this.title,
      launcher,
      configured: Boolean(env.EXO_SHELL),
      executablePath: resolvePathCommand(launcher.command, env),
    });
  }
}

class ClaudeAgentHarness implements AgentHarness {
  readonly kind = "claude";
  readonly title = "Claude";
  readonly metadata = resolveCapabilityMetadata(this.kind);
  readonly skills = [];

  resolveLauncher(env: NodeJS.ProcessEnv): AgentLauncherConfig {
    return {
      kind: this.kind,
      title: this.title,
      command: env.EXO_CLAUDE_COMMAND ?? "claude",
      args: splitEnvArgs(env.EXO_CLAUDE_ARGS),
    };
  }

  resolveDetection(env: NodeJS.ProcessEnv): AgentHarnessDetection {
    const launcher = this.resolveLauncher(env);
    return detectionFor({
      id: this.kind,
      adapterId: "claude-code",
      label: this.title,
      productName: "Claude Code",
      launcher,
      configured: Boolean(env.EXO_CLAUDE_COMMAND),
      executablePath: resolvePathCommand(launcher.command, env),
      install: {
        label: "Claude Code setup",
        url: "https://docs.anthropic.com/en/docs/claude-code/setup",
      },
    });
  }
}

class CodexAgentHarness implements AgentHarness {
  readonly kind = "codex";
  readonly title = "Codex";
  readonly metadata = resolveCapabilityMetadata(this.kind);
  readonly skills = [];

  resolveLauncher(env: NodeJS.ProcessEnv): AgentLauncherConfig {
    return {
      kind: this.kind,
      title: this.title,
      command: env.EXO_CODEX_COMMAND ?? "codex",
      args: withCodexReasoningEffortOverride(splitEnvArgs(env.EXO_CODEX_ARGS), env),
    };
  }

  resolveDetection(env: NodeJS.ProcessEnv): AgentHarnessDetection {
    const launcher = this.resolveLauncher(env);
    return detectionFor({
      id: this.kind,
      adapterId: "codex",
      label: this.title,
      launcher,
      configured: Boolean(env.EXO_CODEX_COMMAND),
      executablePath: resolvePathCommand(launcher.command, env),
      install: {
        label: "Codex CLI setup",
        url: "https://developers.openai.com/codex/cli/",
      },
    });
  }
}

class PiAgentHarness implements AgentHarness {
  readonly kind = "pi";
  readonly title = "Pi";
  readonly metadata = resolveCapabilityMetadata(this.kind);
  readonly skills = [];

  resolveLauncher(env: NodeJS.ProcessEnv): AgentLauncherConfig {
    const sourceCheckout = env.EXO_PI_COMMAND ? undefined : discoverPiSourceCheckout(env);
    return {
      kind: this.kind,
      title: env.EXO_PI_LABEL ?? "Pi-compatible harness",
      command: env.EXO_PI_COMMAND ?? (sourceCheckout ? process.execPath : "pi"),
      args: sourceCheckout ? [sourceCheckout.cliPath, ...splitEnvArgs(env.EXO_PI_ARGS)] : splitEnvArgs(env.EXO_PI_ARGS),
    };
  }

  resolveDetection(env: NodeJS.ProcessEnv): AgentHarnessDetection {
    const launcher = this.resolveLauncher(env);
    const sourceCheckout = env.EXO_PI_COMMAND ? undefined : discoverPiSourceCheckout(env);
    const configured = Boolean(env.EXO_PI_COMMAND || env.EXO_PI_REPO_PATH);
    const executablePath = env.EXO_PI_COMMAND ? resolvePathCommand(env.EXO_PI_COMMAND, env) : resolvePathCommand(launcher.command, env);
    const backendDependency = resolvePiBackendDependency(env);
    return detectionFor({
      id: this.kind,
      adapterId: "pi",
      label: launcher.title,
      productName: "Pi-compatible harness",
      launcher,
      configured,
      enabled: envFlagEnabled(env.EXO_PI_ENABLED),
      executablePath,
      repoPath: env.EXO_PI_REPO_PATH ?? sourceCheckout?.repoPath,
      channel: env.EXO_PI_CHANNEL ?? (configured ? "custom" : sourceCheckout ? "source" : undefined),
      build: env.EXO_PI_BUILD,
      install: {
        label: "Configure a local Pi build",
      },
      detail: piHarnessDetail({ configured, executablePath, backendDependency }),
      dependencies: [backendDependency],
    });
  }
}

function resolvePiBackendDependency(env: NodeJS.ProcessEnv): AgentHarnessDependencyStatus {
  const backendLabel = env.EXO_PI_BACKEND_LABEL ?? env.EXO_PI_BACKEND_KIND ?? "Pi inference backend";
  const configured = Boolean(env.EXO_PI_BACKEND_URL || env.EXO_PI_BACKEND_COMMAND || env.EXO_PI_BACKEND_READY);
  const detected = env.EXO_PI_BACKEND_READY ? envFlagEnabled(env.EXO_PI_BACKEND_READY) : configured;
  const satisfied = configured && detected;
  const statusLabel = satisfied ? "Configured" : "Missing";
  const detail = satisfied
    ? backendDetail(env)
    : "Configure EXO_PI_BACKEND_URL or EXO_PI_BACKEND_COMMAND for a compatible local inference backend.";

  return {
    id: "pi-inference-backend",
    kind: "inference-backend",
    label: backendLabel,
    required: true,
    configured,
    detected,
    satisfied,
    statusLabel,
    detail,
  };
}

function backendDetail(env: NodeJS.ProcessEnv): string | undefined {
  if (env.EXO_PI_BACKEND_URL) {
    return env.EXO_PI_BACKEND_URL;
  }
  if (env.EXO_PI_BACKEND_COMMAND) {
    return env.EXO_PI_BACKEND_COMMAND;
  }
  return undefined;
}

function piHarnessDetail(input: {
  configured: boolean;
  executablePath?: string;
  backendDependency: AgentHarnessDependencyStatus;
}): string | undefined {
  if (input.configured && !input.executablePath) {
    return "Pi is configured, but no executable command was found.";
  }
  if (!input.backendDependency.satisfied) {
    return input.backendDependency.detail;
  }
  return undefined;
}

class HermesAgentHarness implements AgentHarness {
  readonly kind = "hermes";
  readonly title = "Hermes";
  readonly metadata = resolveCapabilityMetadata(this.kind);
  readonly skills = [];

  resolveLauncher(env: NodeJS.ProcessEnv): AgentLauncherConfig {
    return {
      kind: this.kind,
      title: env.EXO_HERMES_LABEL ?? this.title,
      command: env.EXO_HERMES_COMMAND ?? "hermes",
      args: splitEnvArgs(env.EXO_HERMES_ARGS),
    };
  }

  resolveDetection(env: NodeJS.ProcessEnv): AgentHarnessDetection {
    const launcher = this.resolveLauncher(env);
    const configured = Boolean(env.EXO_HERMES_COMMAND || env.EXO_HERMES_ENABLED);
    const executablePath = resolvePathCommand(launcher.command, env);
    return detectionFor({
      id: this.kind,
      adapterId: "hermes",
      label: launcher.title,
      launcher,
      configured,
      enabled: configured && envFlagEnabled(env.EXO_HERMES_ENABLED),
      executablePath,
      install: {
        label: "Configure Hermes",
      },
      visible: configured,
    });
  }
}

export const builtInAgentHarnesses: AgentHarnessMap = {
  shell: new ShellAgentHarness(),
  claude: new ClaudeAgentHarness(),
  codex: new CodexAgentHarness(),
  pi: new PiAgentHarness(),
  hermes: new HermesAgentHarness(),
};

export function resolveBuiltInAgentLauncher(kind: ManagedAgentKind, env: NodeJS.ProcessEnv): AgentLauncherConfig {
  return builtInAgentHarnesses[kind].resolveLauncher(env);
}
