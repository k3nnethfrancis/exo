import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

import type {
  AgentLaunchPlan,
  AgentLauncherConfig,
  ManagedAgentKind,
  RuntimeConfig,
} from "./types";
import { resolveWorkspaceModel } from "./workspace";

function splitEnvArgs(rawValue?: string): string[] {
  if (!rawValue) {
    return [];
  }

  return rawValue
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);
}

function defaultShellLauncher(env: NodeJS.ProcessEnv): AgentLauncherConfig {
  const command = env.EXO_SHELL ?? env.SHELL ?? "/bin/zsh";
  const args = splitEnvArgs(env.EXO_SHELL_ARGS);

  return {
    kind: "shell",
    title: "Terminal",
    command,
    args: args.length > 0 ? args : path.basename(command).includes("zsh") ? ["-l"] : [],
  };
}

function toolLauncher(kind: "claude" | "codex", env: NodeJS.ProcessEnv): AgentLauncherConfig {
  const prefix = kind === "claude" ? "EXO_CLAUDE" : "EXO_CODEX";
  const fallbackCommand = kind === "claude" ? "claude" : "codex";
  const args = splitEnvArgs(env[`${prefix}_ARGS`]);

  return kind === "codex"
    ? {
        kind,
        title: "Codex",
        command: env[`${prefix}_COMMAND`] ?? fallbackCommand,
        args: withCodexReasoningEffortOverride(args, env),
      }
    : {
        kind,
        title: "Claude",
        command: env[`${prefix}_COMMAND`] ?? fallbackCommand,
        args,
      };
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

export function resolveRuntimeConfig(env: NodeJS.ProcessEnv = process.env): RuntimeConfig {
  const workspace = resolveWorkspaceModel(env);
  const runtimeRoot = env.EXO_RUNTIME_ROOT ?? path.join(workspace.workspaceRoot, ".exo");
  const instructionsRoot = path.join(runtimeRoot, "instructions");

  return {
    workspace,
    runtimeRoot,
    instructions: {
      primary: env.EXO_PRIMARY_INSTRUCTIONS_PATH ?? path.join(instructionsRoot, "AGENTS.md"),
      claude: env.EXO_CLAUDE_INSTRUCTIONS_PATH ?? path.join(instructionsRoot, "CLAUDE.md"),
    },
    retrieval: {
      kind: "qmd",
      enabled: env.EXO_QMD_ENABLED !== "0",
      command: env.EXO_QMD_COMMAND ?? "qmd",
    },
    communication: {
      kind: "file-sqlite",
      messagesDirectory: env.EXO_AGENT_MESSAGES_DIR ?? path.join(runtimeRoot, "messages"),
      sqlitePath: env.EXO_AGENT_SQLITE_PATH ?? path.join(runtimeRoot, "agent-communication.sqlite"),
    },
    launchers: {
      shell: defaultShellLauncher(env),
      claude: toolLauncher("claude", env),
      codex: toolLauncher("codex", env),
    },
  };
}

export function renderPrimaryAgentInstructions(config: RuntimeConfig): string {
  const workspace = config.workspace;

  return [
    "# Exo Runtime",
    "",
    "You are operating inside Exo, a local-first agentic development environment built around a shared exocortex for humans and terminal agents.",
    "",
    "## Workspace",
    `- workspace_root: ${workspace.workspaceRoot}`,
    `- default_terminal_cwd: ${workspace.defaultTerminalCwd}`,
    `- note_roots: ${workspace.noteRoots.map((root) => root.path).join(", ")}`,
    `- project_roots: ${workspace.projectRoots.map((root) => root.path).join(", ")}`,
    "",
    "## Runtime Priority",
    "- Treat AGENTS.md as the primary generic contract.",
    "- Treat CLAUDE.md as a secondary Claude-specific overlay when present.",
    "- Use Exo CLI for runtime-aware operations before inventing local state.",
    "",
    "## Exo Runtime Tools",
    "- `exo-cli workspace status`",
    "- `exo-cli workspace search <query>`",
    "- `exo-cli notes search <query>`",
    "- `exo-cli runtime status`",
    "- `exo-cli launch <shell|claude|codex> [cwd]`",
    "- `exo-cli runtime context <shell|claude|codex>`",
    "- `exo-cli runtime launch-plan <shell|claude|codex> [cwd]`",
    "- `exo-cli runtime sync`",
    "",
    "## Optional Notes Index / Retrieval Backend",
    `- provider: ${config.retrieval.kind}`,
    `- command: ${config.retrieval.command}`,
    `- enabled: ${config.retrieval.enabled ? "true" : "false"}`,
    "- current_app_search: fast note filename/path search only",
    "- guidance: treat QMD as future memory/index infrastructure unless Exo exposes an explicit retrieval command",
    "",
    "## Agent Communication",
    `- transport: ${config.communication.kind}`,
    `- messages_directory: ${config.communication.messagesDirectory}`,
    `- sqlite_path: ${config.communication.sqlitePath}`,
    "",
    "## Guidance",
    "- Keep workspace state, retrieval, and agent communication legible and inspectable.",
    "- Prefer Exo-managed context over ad hoc pasted memory dumps.",
    "",
  ].join("\n");
}

export function renderClaudeOverlay(config: RuntimeConfig): string {
  return [
    "# Exo Claude Overlay",
    "",
    "Primary runtime instructions live in AGENTS.md.",
    "",
    "Claude-specific notes:",
    "- Prefer AGENTS.md as the primary generic contract.",
    "- Use CLAUDE.md as a secondary overlay, not as the sole source of truth.",
    "- When Exo provides runtime context files or CLI commands, prefer those over manual reconstruction.",
    "",
    "Optional retrieval/index and communication are configured by Exo:",
    `- QMD command: ${config.retrieval.command}`,
    "- QMD is not the current app search path; use explicit Exo retrieval tools when available.",
    `- communication transport: ${config.communication.kind}`,
    "",
  ].join("\n");
}

export async function syncRuntimeContextFiles(config: RuntimeConfig): Promise<{ primary: string; claude: string }> {
  await mkdir(path.dirname(config.instructions.primary), { recursive: true });
  await mkdir(path.dirname(config.instructions.claude), { recursive: true });
  await mkdir(config.communication.messagesDirectory, { recursive: true });

  await writeFile(config.instructions.primary, renderPrimaryAgentInstructions(config), "utf8");
  await writeFile(config.instructions.claude, renderClaudeOverlay(config), "utf8");

  return {
    primary: config.instructions.primary,
    claude: config.instructions.claude,
  };
}

export function resolveAgentLaunchPlan(
  config: RuntimeConfig,
  kind: ManagedAgentKind,
  cwd = config.workspace.defaultTerminalCwd,
): AgentLaunchPlan {
  const launcher = config.launchers[kind];
  const secondaryInstructionsPath = kind === "claude" ? config.instructions.claude : undefined;

  return {
    kind,
    title: launcher.title,
    cwd,
    command: launcher.command,
    args: launcher.args,
    primaryInstructionsPath: config.instructions.primary,
    secondaryInstructionsPath,
    env: {
      EXO_WORKSPACE_ROOT: config.workspace.workspaceRoot,
      EXO_NOTE_ROOTS: config.workspace.noteRoots.map((root) => root.path).join(path.delimiter),
      EXO_PROJECT_ROOTS: config.workspace.projectRoots.map((root) => root.path).join(path.delimiter),
      EXO_DEFAULT_TERMINAL_CWD: config.workspace.defaultTerminalCwd,
      EXO_RUNTIME_ROOT: config.runtimeRoot,
      EXO_RUNTIME_PRIMARY_INSTRUCTIONS: config.instructions.primary,
      EXO_RUNTIME_SECONDARY_INSTRUCTIONS: secondaryInstructionsPath ?? "",
      EXO_RETRIEVAL_PROVIDER: config.retrieval.kind,
      EXO_RETRIEVAL_COMMAND: config.retrieval.command,
      EXO_AGENT_TRANSPORT: config.communication.kind,
      EXO_AGENT_MESSAGES_DIR: config.communication.messagesDirectory,
      EXO_AGENT_SQLITE_PATH: config.communication.sqlitePath,
      EXO_AGENT_KIND: kind,
    },
  };
}
