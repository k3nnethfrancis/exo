import path from "node:path";
import { accessSync, constants, existsSync, readFileSync } from "node:fs";

import { builtInCapabilities, type CapabilityMetadata } from "../capabilities";
import type { AgentHarness, AgentHarnessMap, HarnessLaunchArgsContext } from "../agent-harness";
import { buildExoMcpServerSpec } from "../integrations";
import type {
  AgentHarnessAdapterId,
  AgentHarnessDependencyStatus,
  AgentHarnessDetection,
  AgentLauncherConfig,
  ManagedAgentKind,
} from "../types";
import type { RuntimeConfig } from "../types";

const SHELL_SEMANTIC_MESSAGES = {
  modes: ["stdin"],
  defaultMode: "stdin",
  supportsMultiline: true,
  submitOnEnter: true,
  detail: "Shell semantic messages are written as plain stdin text.",
} as const;

const PASTE_ENTER_SEMANTIC_MESSAGES = {
  modes: ["paste-enter"],
  defaultMode: "paste-enter",
  supportsMultiline: true,
  submitOnEnter: true,
  detail: "Agent semantic messages use bracketed paste, then Enter when submitted.",
} as const;

const SIDECAR_SEMANTIC_TRACE_EVENT_KINDS = [
  "session.started",
  "turn.started",
  "message",
  "tool.call",
  "tool.result",
  "lifecycle",
  "harness.raw",
] as const;

const CLAUDE_SEMANTIC_TRACE = {
  schemaVersion: "exo.semantic-trace.v1",
  sources: ["sidecar-jsonl"],
  eventKinds: SIDECAR_SEMANTIC_TRACE_EVENT_KINDS,
  defaultVisibility: "private",
  artifactFileName: "semantic-trace.ndjson",
  detail: "Claude Code-compatible harnesses may emit stream-json events to the sidecar path declared through EXO_CLAUDE_SEMANTIC_TRACE_PATH.",
} as const;

const PI_SEMANTIC_TRACE = {
  schemaVersion: "exo.semantic-trace.v1",
  sources: ["sidecar-jsonl"],
  eventKinds: SIDECAR_SEMANTIC_TRACE_EVENT_KINDS,
  defaultVisibility: "private",
  artifactFileName: "semantic-trace.ndjson",
  detail: "Pi-compatible harnesses may emit stream-json events to the sidecar path declared through EXO_PI_SEMANTIC_TRACE_PATH.",
} as const;

const CODEX_SEMANTIC_MESSAGES = {
  ...PASTE_ENTER_SEMANTIC_MESSAGES,
  queueSubmittedInputUntilReady: true,
  readiness: {
    signal: "prompt-pattern",
    patterns: [
      "\\bask codex\\b",
      "\\bopenai codex\\b",
      "\\btype (?:a )?message\\b",
      "\\bwhat can i help\\b",
      "\\bcodex is ready\\b",
    ],
    initialReadiness: "starting",
    initialDetail: "Waiting briefly for Codex startup interstitials.",
    readyDetail: "Codex chat input is ready.",
    graceReadyDetail: "Codex startup grace elapsed.",
    blockedPatterns: [
      {
        id: "trust",
        readiness: "blocked",
        patterns: [
          "\\bdo you trust\\b",
          "\\btrust (?:the )?(?:files|folder|directory|workspace|repo|repository)\\b",
          "\\b(?:folder|directory|workspace|repo|repository).{0,80}\\btrust\\b",
        ],
        detail: "Codex startup trust prompt is waiting for interactive confirmation.",
      },
      {
        id: "update",
        readiness: "blocked",
        patterns: [
          "\\bupdate available\\b(?=.*\\bskip until next version\\b)",
          "\\bskip until next version\\b(?=.*\\bupdate available\\b)",
        ],
        detail: "Codex startup update prompt is waiting for Skip, Skip until next version, or Update.",
      },
    ],
    detail: "Codex startup readiness waits for chat-input prompt text and blocks queued sends at trust/update interstitials.",
  },
} as const;

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

function invalidPiCommandDetail(command?: string): string | undefined {
  if (!command) {
    return undefined;
  }

  const basename = path.basename(command).toLowerCase();
  if (basename === "codex") {
    return "Configured Pi command points at Codex. Choose a Pi-compatible command or source checkout.";
  }

  if (basename === "exo" && command.includes(`${path.sep}Contents${path.sep}MacOS${path.sep}Exo`)) {
    return "Configured Pi command points at the packaged Exo app. Choose a Pi-compatible command or source checkout.";
  }

  return undefined;
}

function validPiCommand(env: NodeJS.ProcessEnv): string | undefined {
  return invalidPiCommandDetail(env.EXO_PI_COMMAND) ? undefined : env.EXO_PI_COMMAND;
}

function resolveNodeCommand(env: NodeJS.ProcessEnv): string | undefined {
  const fromPath = resolvePathCommand("node", env);
  if (fromPath) {
    return fromPath;
  }

  // Source-checkout Pi launches through Node so packaged Exo never treats its
  // own app binary as the harness runtime. `process.execPath` is safe only when
  // this process is actually Node, which is true for CLI/tests but false for
  // Finder-launched Exo.app.
  if (path.basename(process.execPath).toLowerCase() === "node" && isExecutable(process.execPath)) {
    return process.execPath;
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
  setupSummary?: string;
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
    setupSummary: input.setupSummary ?? setupSummaryFor({
      enabled,
      configured: input.configured,
      detected,
      launchable,
      status,
      detail: input.detail,
      dependencies: input.dependencies,
    }),
    launcher: launchable ? input.launcher : undefined,
    visible: input.visible,
  };
}

function setupSummaryFor(input: {
  enabled: boolean;
  configured: boolean;
  detected: boolean;
  launchable: boolean;
  status: AgentHarnessDetection["status"];
  detail?: string;
  dependencies?: AgentHarnessDependencyStatus[];
}): string {
  if (!input.enabled) {
    return "Disabled.";
  }
  if (input.launchable) {
    return input.configured ? "Configured and ready to launch." : "Detected and ready to launch.";
  }
  const missingRequiredDependency = input.dependencies?.find((dependency) => dependency.required && !dependency.satisfied);
  if (missingRequiredDependency) {
    return missingRequiredDependency.detail ?? `${missingRequiredDependency.label} is required before launch.`;
  }
  if (input.detail) {
    return input.detail;
  }
  if (!input.detected) {
    return input.configured ? "Configured, but no executable was detected." : "Install or configure this harness before launch.";
  }
  if (input.status === "broken") {
    return "Detected configuration is incomplete or not executable.";
  }
  return statusLabel(input.status);
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

function withCodexMcpOverrides(args: readonly string[], config: RuntimeConfig, cwd: string, env: NodeJS.ProcessEnv): string[] {
  const exoRoot = findExoRepoRoot(config, cwd);
  if (!exoRoot) {
    return [...args];
  }

  const spec = buildExoMcpServerSpec({
    exoRoot,
    workspaceRoot: config.workspace.workspaceRoot,
    nodeCommand: resolveNodeCommandForMcpOverride(env),
  });

  return [
    ...args,
    "-c",
    `mcp_servers.${spec.serverName}.command=${tomlString(spec.command)}`,
    "-c",
    `mcp_servers.${spec.serverName}.args=${tomlStringArray(spec.args)}`,
    "-c",
    `mcp_servers.${spec.serverName}.env=${tomlInlineTable(spec.env)}`,
  ];
}

function resolveNodeCommandForMcpOverride(env: NodeJS.ProcessEnv): string {
  // In the packaged app, process.execPath is Electron, not Node. Prefer the
  // Node executable captured from the launch environment so Codex does not
  // resolve a different or missing `node` when it starts Exo MCP.
  return env.NODE || env.npm_node_execpath || "node";
}

function findExoRepoRoot(config: RuntimeConfig, cwd: string): string | null {
  const candidates = [
    // Exo-launched agents often run inside git worktrees for the code they are
    // editing. Those worktrees may not have built MCP artifacts, so the MCP
    // launcher must prefer the imported/running Exo project root before the
    // terminal cwd.
    ...config.workspace.projectRoots.map((root) => root.path),
    config.workspace.workspaceRoot,
    config.workspace.defaultTerminalCwd,
    process.cwd(),
    cwd,
  ];

  for (const candidate of candidates) {
    const root = findExoRepoRootFrom(candidate);
    if (root) {
      return root;
    }
  }

  return null;
}

function findExoRepoRootFrom(startPath: string): string | null {
  let current = path.resolve(startPath);
  while (true) {
    if (isExoRepoRoot(current)) {
      return current;
    }
    const parent = path.dirname(current);
    if (parent === current) {
      return null;
    }
    current = parent;
  }
}

function isExoRepoRoot(candidate: string): boolean {
  const packageJsonPath = path.join(candidate, "package.json");
  const mcpLauncherPath = path.join(candidate, "packages", "mcp", "bin", "exo-mcp.mjs");
  if (!existsSync(packageJsonPath) || !existsSync(mcpLauncherPath)) {
    return false;
  }

  try {
    const packageJson = JSON.parse(readFileSync(packageJsonPath, "utf8")) as { name?: string };
    return packageJson.name === "exo";
  } catch {
    return false;
  }
}

function tomlString(value: string): string {
  return JSON.stringify(value);
}

function tomlStringArray(values: string[]): string {
  return `[${values.map(tomlString).join(", ")}]`;
}

function tomlInlineTable(values: Record<string, string>): string {
  return `{${Object.entries(values)
    .map(([key, value]) => `${key}=${tomlString(value)}`)
    .join(", ")}}`;
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
  readonly contractVersion = "agent-harness.v1";
  readonly kind = "shell";
  readonly title = "Terminal";
  readonly metadata = resolveCapabilityMetadata(this.kind);
  readonly adapter = {
    id: "shell",
    family: "shell",
    productName: "Shell",
    executableNames: ["zsh", "bash", "sh"],
  } as const;
  readonly skills = [];
  readonly semanticMessages = SHELL_SEMANTIC_MESSAGES;
  readonly terminalOwnership = "core";

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
  readonly contractVersion = "agent-harness.v1";
  readonly kind = "claude";
  readonly title = "Claude";
  readonly metadata = resolveCapabilityMetadata(this.kind);
  readonly adapter = {
    id: "claude-code",
    family: "claude-code",
    productName: "Claude Code",
    executableNames: ["claude"],
    documentationUrl: "https://docs.anthropic.com/en/docs/claude-code",
  } as const;
  readonly skills = [];
  readonly semanticMessages = PASTE_ENTER_SEMANTIC_MESSAGES;
  readonly semanticTrace = CLAUDE_SEMANTIC_TRACE;
  readonly terminalOwnership = "core";

  resolveLauncher(env: NodeJS.ProcessEnv): AgentLauncherConfig {
    return {
      kind: this.kind,
      title: this.title,
      command: env.EXO_CLAUDE_COMMAND ?? "claude",
      args: splitEnvArgs(env.EXO_CLAUDE_ARGS),
      traceCapture: {
        schemaVersion: "exo.semantic-trace.v1",
        source: "sidecar-jsonl",
        artifactFileName: CLAUDE_SEMANTIC_TRACE.artifactFileName,
        eventFormat: "stream-json",
        envVar: "EXO_CLAUDE_SEMANTIC_TRACE_PATH",
      },
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
  readonly contractVersion = "agent-harness.v1";
  readonly kind = "codex";
  readonly title = "Codex";
  readonly metadata = resolveCapabilityMetadata(this.kind);
  readonly adapter = {
    id: "codex",
    family: "codex",
    productName: "Codex CLI",
    executableNames: ["codex"],
    documentationUrl: "https://developers.openai.com/codex/cli/",
  } as const;
  readonly skills = [];
  readonly semanticMessages = CODEX_SEMANTIC_MESSAGES;
  readonly terminalOwnership = "core";

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

  prepareLaunchArgs(context: HarnessLaunchArgsContext): string[] {
    return withCodexMcpOverrides(context.args, context.runtimeConfig, context.cwd, context.env);
  }
}

class PiAgentHarness implements AgentHarness {
  readonly contractVersion = "agent-harness.v1";
  readonly kind = "pi";
  readonly title = "Pi";
  readonly metadata = resolveCapabilityMetadata(this.kind);
  readonly adapter = {
    id: "pi",
    family: "pi",
    productName: "Pi-compatible harness",
  } as const;
  readonly skills = [];
  readonly semanticTrace = PI_SEMANTIC_TRACE;
  readonly terminalOwnership = "core";

  resolveLauncher(env: NodeJS.ProcessEnv): AgentLauncherConfig {
    const command = validPiCommand(env);
    const sourceCheckout = command ? undefined : discoverPiSourceCheckout(env);
    const sourceCheckoutNode = sourceCheckout ? resolveNodeCommand(env) : undefined;
    return {
      kind: this.kind,
      title: env.EXO_PI_LABEL ?? "Pi-compatible harness",
      command: command ?? sourceCheckoutNode ?? "pi",
      args: sourceCheckout && sourceCheckoutNode ? [sourceCheckout.cliPath, ...splitEnvArgs(env.EXO_PI_ARGS)] : splitEnvArgs(env.EXO_PI_ARGS),
      traceCapture: {
        schemaVersion: "exo.semantic-trace.v1",
        source: "sidecar-jsonl",
        artifactFileName: PI_SEMANTIC_TRACE.artifactFileName,
        eventFormat: "stream-json",
        envVar: "EXO_PI_SEMANTIC_TRACE_PATH",
      },
    };
  }

  resolveDetection(env: NodeJS.ProcessEnv): AgentHarnessDetection {
    const launcher = this.resolveLauncher(env);
    const command = validPiCommand(env);
    const invalidCommandDetail = invalidPiCommandDetail(env.EXO_PI_COMMAND);
    const sourceCheckout = command ? undefined : discoverPiSourceCheckout(env);
    const configured = Boolean(env.EXO_PI_COMMAND || env.EXO_PI_REPO_PATH);
    const executablePath = command ? resolvePathCommand(command, env) : resolvePathCommand(launcher.command, env);
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
      detail: piHarnessDetail({ configured, executablePath, invalidCommandDetail, backendDependency }),
      dependencies: [backendDependency],
    });
  }
}

function resolvePiBackendDependency(env: NodeJS.ProcessEnv): AgentHarnessDependencyStatus {
  const backendLabel = env.EXO_PI_BACKEND_LABEL ?? env.EXO_PI_BACKEND_KIND ?? "Pi inference backend";
  const configured = Boolean(env.EXO_PI_BACKEND_URL || env.EXO_PI_BACKEND_COMMAND);
  const ready = Boolean(env.EXO_PI_BACKEND_READY) && envFlagEnabled(env.EXO_PI_BACKEND_READY);
  const detected = ready;
  const satisfied = configured && ready;
  const statusLabel = satisfied ? "Ready" : configured ? "Not ready" : "Missing";
  const detail = satisfied ? backendDetail(env) : missingPiBackendDetail(env, configured);
  const autoStart = !satisfied && env.EXO_PI_BACKEND_COMMAND && env.EXO_PI_BACKEND_URL
    ? {
      command: env.EXO_PI_BACKEND_COMMAND,
      probeUrl: env.EXO_PI_BACKEND_URL,
      readyEnv: { EXO_PI_BACKEND_READY: "1" },
    }
    : undefined;

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
    ...(autoStart ? { autoStart } : {}),
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

function missingPiBackendDetail(env: NodeJS.ProcessEnv, configured: boolean): string {
  if (!configured) {
    return "Configure EXO_PI_BACKEND_URL or EXO_PI_BACKEND_COMMAND for a compatible local inference backend.";
  }

  const details = ["Pi backend is configured but not confirmed ready. Set EXO_PI_BACKEND_READY=1 after starting it."];
  if (env.EXO_PI_BACKEND_URL) {
    details.push(`URL: ${env.EXO_PI_BACKEND_URL}`);
  }
  if (env.EXO_PI_BACKEND_COMMAND) {
    details.push(`Start command: ${env.EXO_PI_BACKEND_COMMAND}`);
  }
  if (!env.EXO_PI_BACKEND_COMMAND) {
    details.push("Start command: set EXO_PI_BACKEND_COMMAND or start the backend separately.");
  }
  return details.join(" ");
}

function piHarnessDetail(input: {
  configured: boolean;
  executablePath?: string;
  invalidCommandDetail?: string;
  backendDependency: AgentHarnessDependencyStatus;
}): string | undefined {
  if (input.invalidCommandDetail) {
    return input.invalidCommandDetail;
  }
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
