import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

import { resolveBuiltInAgentLauncher } from "./agent-harnesses/builtins";
import type {
  AgentLaunchPlan,
  ManagedAgentKind,
  RuntimeConfig,
} from "./types";
import { resolveWorkspaceModel } from "./workspace";

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
      shell: resolveBuiltInAgentLauncher("shell", env),
      claude: resolveBuiltInAgentLauncher("claude", env),
      codex: resolveBuiltInAgentLauncher("codex", env),
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
    "- Treat AGENTS.md as the generic contract for every agent.",
    "- Treat CLAUDE.md as an identical compatibility alias for tools that discover it.",
    "- Use Exo CLI for runtime-aware operations before inventing local state.",
    "",
    "## Exo Runtime Tools",
    "- `exo-cli workspace status`",
    "- `exo-cli workspace search <query>`",
    "- `exo-cli notes search <query>`",
    "- `exo-cli search <query>`",
    "- `exo-cli read <path-or-docid>`",
    "- `exo-cli index status`",
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
    `- index_mode: ${workspace.indexing.mode}`,
    `- indexed_roots: ${workspace.indexedRoots.map((root) => `${root.id}:${root.path}`).join(", ") || "(none)"}`,
    "- guidance: use `exo-cli search` and `exo-cli read` for Exo-managed knowledge index access when available.",
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
  return renderPrimaryAgentInstructions(config);
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

  return {
    kind,
    title: launcher.title,
    cwd,
    command: launcher.command,
    args: launcher.args,
    primaryInstructionsPath: config.instructions.primary,
    secondaryInstructionsPath: undefined,
    env: {
      EXO_WORKSPACE_ROOT: config.workspace.workspaceRoot,
      EXO_NOTE_ROOTS: config.workspace.noteRoots.map((root) => root.path).join(path.delimiter),
      EXO_PROJECT_ROOTS: config.workspace.projectRoots.map((root) => root.path).join(path.delimiter),
      EXO_DEFAULT_TERMINAL_CWD: config.workspace.defaultTerminalCwd,
      EXO_RUNTIME_ROOT: config.runtimeRoot,
      EXO_RUNTIME_PRIMARY_INSTRUCTIONS: config.instructions.primary,
      EXO_RUNTIME_SECONDARY_INSTRUCTIONS: "",
      EXO_RETRIEVAL_PROVIDER: config.retrieval.kind,
      EXO_RETRIEVAL_COMMAND: config.retrieval.command,
      EXO_AGENT_TRANSPORT: config.communication.kind,
      EXO_AGENT_MESSAGES_DIR: config.communication.messagesDirectory,
      EXO_AGENT_SQLITE_PATH: config.communication.sqlitePath,
      EXO_AGENT_KIND: kind,
    },
  };
}
