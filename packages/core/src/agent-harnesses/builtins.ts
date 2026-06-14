import path from "node:path";

import { builtInCapabilities, type CapabilityMetadata } from "../capabilities";
import type { AgentHarness, AgentHarnessMap } from "../agent-harness";
import type { AgentLauncherConfig, ManagedAgentKind } from "../types";

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
}

class ClaudeAgentHarness implements AgentHarness {
  readonly kind = "claude";
  readonly title = "Claude";
  readonly metadata = resolveCapabilityMetadata(this.kind);

  resolveLauncher(env: NodeJS.ProcessEnv): AgentLauncherConfig {
    return {
      kind: this.kind,
      title: this.title,
      command: env.EXO_CLAUDE_COMMAND ?? "claude",
      args: splitEnvArgs(env.EXO_CLAUDE_ARGS),
    };
  }
}

class CodexAgentHarness implements AgentHarness {
  readonly kind = "codex";
  readonly title = "Codex";
  readonly metadata = resolveCapabilityMetadata(this.kind);

  resolveLauncher(env: NodeJS.ProcessEnv): AgentLauncherConfig {
    return {
      kind: this.kind,
      title: this.title,
      command: env.EXO_CODEX_COMMAND ?? "codex",
      args: withCodexReasoningEffortOverride(splitEnvArgs(env.EXO_CODEX_ARGS), env),
    };
  }
}

export const builtInAgentHarnesses: AgentHarnessMap = {
  shell: new ShellAgentHarness(),
  claude: new ClaudeAgentHarness(),
  codex: new CodexAgentHarness(),
};

export function resolveBuiltInAgentLauncher(kind: ManagedAgentKind, env: NodeJS.ProcessEnv): AgentLauncherConfig {
  return builtInAgentHarnesses[kind].resolveLauncher(env);
}
