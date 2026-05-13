#!/usr/bin/env node

import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  EXO_MCP_INTEGRATION_CLIENTS,
  buildExoMcpIntegrationSpec,
  formatMcpServerJson,
  formatShellCommand,
  parseMcpListOutput,
  createBranchFile,
  getBranchFamily,
  readWorkspaceDocument,
  renderClaudeOverlay,
  renderPrimaryAgentInstructions,
  resolveAgentLaunchPlan,
  resolveRuntimeConfig,
  resolveWorkspaceModel,
  searchNotes,
  searchWorkspace,
  syncRuntimeContextFiles,
  type ManagedAgentKind,
  type ExoMcpIntegrationClient,
} from "@exo/core";

import { AppClient } from "./app-client";

interface CommandRunResult {
  code: number;
  stdout: string;
  stderr: string;
}

type CommandRunner = (
  command: string,
  args: string[],
  options?: { cwd?: string; env?: NodeJS.ProcessEnv },
) => Promise<CommandRunResult>;

export async function runCli(
  argv: string[],
  options: {
    env?: NodeJS.ProcessEnv;
    stdin?: NodeJS.ReadStream;
    stdout?: { write: (text: string) => void };
    stderr?: { write: (text: string) => void };
    cwd?: string;
    runCommand?: CommandRunner;
  } = {},
): Promise<number> {
  const env = options.env ?? process.env;
  const stdin = options.stdin ?? process.stdin;
  const stdout = options.stdout ?? process.stdout;
  const stderr = options.stderr ?? process.stderr;
  const cwd = options.cwd ?? process.cwd();
  const runCommand = options.runCommand ?? runProcess;

  const [, , command, subcommand, ...args] = argv;

  // ─── Search ──────────────────────────────────────────────────────────
  // Standalone fast workspace search. QMD is intentionally not in this path.

  if (command === "search") {
    const query = subcommand === "--deep" ? args.join(" ") : [subcommand, ...args].filter(Boolean).join(" ");
    if (!query) {
      throw new Error("Expected a search query.");
    }

    const config = resolveRuntimeConfig(env);
    const model = config.workspace;

    if (subcommand === "--deep") {
      stderr.write("QMD/deep search is disabled; running fast workspace search only.\n");
    }

    const fast = await searchWorkspace(model, query);
    stdout.write(`${JSON.stringify(fast, null, 2)}\n`);
    return 0;
  }

  // ─── Local agent integrations ───────────────────────────────────────

  if (command === "integrations") {
    const exoRoot = resolveExoRoot(env);
    const workspaceRoot = resolveRuntimeConfig(env).workspace.workspaceRoot;
    const targets = parseIntegrationTargets(args);

    if (subcommand === "doctor" || !subcommand) {
      const statuses = await Promise.all(
        EXO_MCP_INTEGRATION_CLIENTS.map((client) => getIntegrationStatus(client, { exoRoot, workspaceRoot }, runCommand, env)),
      );
      const pnpm = await detectExecutable("pnpm", runCommand, env);
      stdout.write(formatIntegrationDoctor({ exoRoot, workspaceRoot, pnpmFound: pnpm.found, statuses }));
      return 0;
    }

    if (subcommand === "config") {
      const clients = targets.clients;
      if (clients.length === 0) {
        throw new Error("Usage: exo integrations config <codex|claude|all>");
      }

      stdout.write(
        clients
          .map((client) => {
            const spec = buildExoMcpIntegrationSpec(client, { exoRoot, workspaceRoot });
            return [
              `# ${client}`,
              `Install command:`,
              spec.installDisplay,
              "",
              `MCP JSON:`,
              formatMcpServerJson(spec.server),
            ].join("\n");
          })
          .join("\n\n"),
      );
      stdout.write("\n");
      return 0;
    }

    if (subcommand === "test") {
      const clients = targets.clients;
      if (clients.length === 0) {
        throw new Error("Usage: exo integrations test <codex|claude|all>");
      }

      const statuses = await Promise.all(
        clients.map((client) => getIntegrationStatus(client, { exoRoot, workspaceRoot }, runCommand, env)),
      );
      stdout.write(formatIntegrationTest(statuses));
      return statuses.every((status) => status.installed && status.configured) ? 0 : 1;
    }

    if (subcommand === "install") {
      const clients = targets.clients;
      if (clients.length === 0) {
        throw new Error("Usage: exo integrations install <codex|claude|all> [--dry-run]");
      }

      const results: string[] = [];
      let ok = true;
      for (const client of clients) {
        const spec = buildExoMcpIntegrationSpec(client, { exoRoot, workspaceRoot });

        if (targets.dryRun) {
          results.push(`[dry-run] ${spec.installDisplay}`);
          continue;
        }

        const status = await getIntegrationStatus(client, { exoRoot, workspaceRoot }, runCommand, env);
        if (!status.installed) {
          ok = false;
          results.push(`${client}: missing CLI. Install ${client} first, then run:\n${spec.installDisplay}`);
          continue;
        }

        if (status.configured) {
          results.push(`${client}: Exo MCP is already configured.`);
          continue;
        }

        const install = await runCommand(spec.installCommand, spec.installArgs, { env });
        if (install.code === 0) {
          results.push(`${client}: installed Exo MCP. Restart existing ${client} sessions or refresh MCP tools where supported.`);
        } else {
          ok = false;
          results.push(`${client}: install failed.\n${install.stderr || install.stdout || `exit code ${install.code}`}`);
        }
      }

      stdout.write(`${results.join("\n\n")}\n`);
      return ok ? 0 : 1;
    }

    stderr.write(
      "Usage: exo integrations [doctor | config <codex|claude|all> | install <codex|claude|all> [--dry-run] | test <codex|claude|all>]\n",
    );
    return 1;
  }

  // ─── App commands (require running desktop app) ──────────────────────

  if (command === "open") {
    const filePath = subcommand ? path.resolve(cwd, [subcommand, ...args].join(" ")) : null;
    if (!filePath) {
      throw new Error("Expected a file path.");
    }

    const client = await connectOrFail(env, stderr);
    if (!client) return 1;
    await client.openFile(filePath);
    stdout.write(`Opened: ${filePath}\n`);
    return 0;
  }

  if (command === "status") {
    const client = await connectOrFail(env, stderr);
    if (!client) return 1;
    const status = await client.getStatus();
    stdout.write(`${JSON.stringify(status, null, 2)}\n`);
    return 0;
  }

  if (command === "show") {
    const client = await connectOrFail(env, stderr);
    if (!client) return 1;
    await client.showWindow();
    stdout.write("Showed Exo window.\n");
    return 0;
  }

  if (command === "config") {
    const client = await connectOrFail(env, stderr);
    if (!client) return 1;

    if (subcommand === "get") {
      const config = await client.getConfig();
      const key = args[0];
      if (key && key in config) {
        stdout.write(`${JSON.stringify((config as Record<string, unknown>)[key], null, 2)}\n`);
      } else {
        stdout.write(`${JSON.stringify(config, null, 2)}\n`);
      }
      return 0;
    }

    stderr.write("Usage: exo config get [key]\n");
    return 1;
  }

  if (command === "terminals") {
    const client = await connectOrFail(env, stderr);
    if (!client) return 1;

    if (subcommand === "list" || !subcommand) {
      const terminals = await client.listTerminals();
      stdout.write(`${JSON.stringify(terminals, null, 2)}\n`);
      return 0;
    }

    if (subcommand === "create") {
      const kind = args[0];
      if (!kind || !["shell", "claude", "codex"].includes(kind)) {
        throw new Error("Expected one of: shell, claude, codex.");
      }
      const terminal = await client.createTerminal(kind, args[1]);
      stdout.write(`${JSON.stringify(terminal, null, 2)}\n`);
      return 0;
    }

    if (subcommand === "read") {
      const id = args[0];
      if (!id) {
        throw new Error("Expected a terminal id.");
      }
      const buffer = await client.readTerminal(id);
      stdout.write(buffer);
      if (buffer && !buffer.endsWith("\n")) {
        stdout.write("\n");
      }
      return 0;
    }

    if (subcommand === "transcript") {
      const id = args[0];
      if (!id) {
        throw new Error("Usage: exo terminals transcript <terminal-id> [--tail chars] [--full]");
      }
      const transcript = await client.readTerminalTranscript(id, parseTailChars(args));
      stdout.write(transcript);
      if (transcript && !transcript.endsWith("\n")) {
        stdout.write("\n");
      }
      return 0;
    }

    if (subcommand === "write" || subcommand === "send") {
      const id = args[0];
      const data = args.slice(1).join(" ");
      if (!id || !data) {
        throw new Error(`Usage: exo terminals ${subcommand} <terminal-id> <text>`);
      }
      await client.writeTerminal(id, subcommand === "send" ? `${data}\n` : data);
      return 0;
    }

    if (subcommand === "kill") {
      const id = args[0];
      if (!id) {
        throw new Error("Usage: exo terminals kill <terminal-id>");
      }
      await client.killTerminal(id);
      return 0;
    }

    stderr.write("Usage: exo terminals [list | create <shell|claude|codex> [cwd] | read <id> | transcript <id> [--tail chars] [--full] | write <id> <text> | send <id> <text> | kill <id>]\n");
    return 1;
  }

  if (command === "agents") {
    const client = await connectOrFail(env, stderr);
    if (!client) return 1;

    if (subcommand === "list" || !subcommand) {
      const agents = await client.listTerminals();
      stdout.write(`${formatAgents(agents)}\n`);
      return 0;
    }

    if (subcommand === "create") {
      const kind = args[0];
      if (!kind || !["shell", "claude", "codex"].includes(kind)) {
        throw new Error("Usage: exo agents create <shell|claude|codex> [cwd]");
      }
      const agent = await client.createTerminal(kind, args[1]);
      stdout.write(`${JSON.stringify(agent, null, 2)}\n`);
      return 0;
    }

    if (subcommand === "read") {
      const id = args[0];
      if (!id) {
        throw new Error("Usage: exo agents read <agent-id> [--tail chars] [--raw]");
      }

      const tailChars = parseTailChars(args);
      const raw = args.includes("--raw");
      const transcript = await client.readTerminalTranscript(id, tailChars);
      const output = raw ? transcript : stripAnsi(transcript);
      const tailed = tailChars > 0 ? output.slice(-tailChars) : output;
      stdout.write(tailed || "(no buffered output)");
      if (!tailed.endsWith("\n")) {
        stdout.write("\n");
      }
      return 0;
    }

    if (subcommand === "send" || subcommand === "message" || subcommand === "tell") {
      const id = args[0];
      const raw = args.includes("--raw") || args.includes("--no-submit");
      const message = args.slice(1).filter((arg) => !["--submit", "--raw", "--no-submit"].includes(arg)).join(" ");
      if (!id || !message) {
        throw new Error(`Usage: exo agents ${subcommand} <agent-id> <message> [--raw|--no-submit]`);
      }
      await client.writeTerminal(id, raw ? message : `${message}\r`);
      stdout.write(`Sent ${raw ? "raw input" : "message plus Enter"} to ${id}.\n`);
      return 0;
    }

    if (subcommand === "interrupt") {
      const id = args[0];
      const signal = args[1] ?? "escape";
      if (!id || !["escape", "ctrl-c"].includes(signal)) {
        throw new Error("Usage: exo agents interrupt <agent-id> [escape|ctrl-c]");
      }
      await client.writeTerminal(id, signal === "ctrl-c" ? "\u0003" : "\u001b");
      stdout.write(`Sent ${signal} to ${id}.\n`);
      return 0;
    }

    if (subcommand === "terminate" || subcommand === "kill") {
      const id = args[0];
      if (!id) {
        throw new Error(`Usage: exo agents ${subcommand} <agent-id>`);
      }
      await client.killTerminal(id);
      stdout.write(`Terminated ${id}.\n`);
      return 0;
    }

    stderr.write("Usage: exo agents [list | create <shell|claude|codex> [cwd] | read <id> [--tail chars] [--raw] | send <id> <text> [--raw|--no-submit] | message <id> <text> | tell <id> <text> | interrupt <id> [escape|ctrl-c] | terminate <id>]\n");
    return 1;
  }

  // ─── Workspace commands ──────────────────────────────────────────────

  if (command === "workspace" && subcommand === "status") {
    const model = resolveWorkspaceModel(env);
    stdout.write(`${JSON.stringify(model, null, 2)}\n`);
    return 0;
  }

  if (command === "workspace" && subcommand === "fixture") {
    const fixtureRoot = path.resolve(cwd, "fixtures/workspace/lab");
    stdout.write(`${fixtureRoot}\n`);
    return 0;
  }

  if (command === "workspace" && subcommand === "search") {
    const query = args.join(" ");
    const model = resolveWorkspaceModel(env);
    const results = await searchWorkspace(model, query);
    stdout.write(`${JSON.stringify(results, null, 2)}\n`);
    return 0;
  }

  // ─── Notes commands ──────────────────────────────────────────────────

  if (command === "notes" && subcommand === "search") {
    const query = args.join(" ");
    const model = resolveWorkspaceModel(env);
    const results = await searchNotes(model, query);
    stdout.write(`${JSON.stringify(results, null, 2)}\n`);
    return 0;
  }

  if (command === "notes" && subcommand === "read") {
    const targetPath = args[0];
    if (!targetPath) {
      throw new Error("Expected a note path.");
    }

    const document = await readWorkspaceDocument(targetPath);
    stdout.write(`${JSON.stringify(document, null, 2)}\n`);
    return 0;
  }

  if (command === "notes" && subcommand === "branch-create") {
    const targetPath = args[0];
    if (!targetPath) {
      throw new Error("Expected a markdown note path.");
    }

    const document = await readWorkspaceDocument(targetPath);
    const model = resolveWorkspaceModel(env);
    const result = await createBranchFile(targetPath, document, model.noteRoots.map((root) => root.path));
    stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    return 0;
  }

  if (command === "notes" && subcommand === "branch-view") {
    const targetPath = args[0];
    if (!targetPath) {
      throw new Error("Expected a markdown note path.");
    }

    const model = resolveWorkspaceModel(env);
    const family = await getBranchFamily(targetPath, model.noteRoots.map((root) => root.path));
    stdout.write(`${JSON.stringify(family, null, 2)}\n`);
    return 0;
  }

  // ─── Runtime commands ────────────────────────────────────────────────

  if (command === "runtime" && subcommand === "status") {
    const config = resolveRuntimeConfig(env);
    stdout.write(`${JSON.stringify(config, null, 2)}\n`);
    return 0;
  }

  if (command === "runtime" && subcommand === "context") {
    const kind = normalizeAgentKind(args[0]);
    if (!kind) {
      throw new Error("Expected one of: shell, claude, codex.");
    }

    const config = resolveRuntimeConfig(env);
    const content = kind === "claude" ? renderClaudeOverlay(config) : renderPrimaryAgentInstructions(config);
    stdout.write(`${content}\n`);
    return 0;
  }

  if (command === "runtime" && subcommand === "launch-plan") {
    const kind = normalizeAgentKind(args[0]);
    if (!kind) {
      throw new Error("Expected one of: shell, claude, codex.");
    }

    const config = resolveRuntimeConfig(env);
    const launchPlan = resolveAgentLaunchPlan(config, kind, args[1]);
    stdout.write(`${JSON.stringify(launchPlan, null, 2)}\n`);
    return 0;
  }

  if (command === "runtime" && subcommand === "sync") {
    const config = resolveRuntimeConfig(env);
    const paths = await syncRuntimeContextFiles(config);
    stdout.write(`${JSON.stringify(paths, null, 2)}\n`);
    return 0;
  }

  // ─── Launch commands ─────────────────────────────────────────────────

  if (command === "dev") {
    const projectRoot = env.EXO_PROJECT_ROOT ?? path.resolve(fileURLToPath(import.meta.url), "../../../..");
    const child = spawn("pnpm", ["dev"], {
      cwd: projectRoot,
      env: { ...process.env, ...env },
      stdio: "inherit",
    });

    return new Promise<number>((resolve, reject) => {
      child.on("error", reject);
      child.on("exit", (code, signal) => {
        if (signal) {
          resolve(1);
          return;
        }
        resolve(code ?? 0);
      });
    });
  }

  if (command === "launch") {
    const kind = normalizeAgentKind(subcommand);
    if (!kind) {
      throw new Error("Expected one of: shell, claude, codex.");
    }

    const config = resolveRuntimeConfig(env);
    await syncRuntimeContextFiles(config);
    const launchPlan = resolveAgentLaunchPlan(config, kind, args[0]);
    return launchAgent(launchPlan, { env, stdin, stdout, stderr });
  }

  // ─── Usage ───────────────────────────────────────────────────────────

  stderr.write(
    [
      "Usage:",
      "  exo dev                                    Launch the desktop app",
      "  exo search <query>                         Search attached notes by filename/path",
      "  exo open <path>                            Open file in editor (app)",
      "  exo status                                 Workspace status (app)",
      "  exo config get [key]                       Read settings (app)",
      "  exo terminals [list]                       List terminals (app)",
      "  exo terminals create <shell|claude|codex>  Create terminal (app)",
      "  exo terminals read <id>                    Read buffered terminal output (app)",
      "  exo terminals transcript <id> [--tail n]   Read disk-backed terminal transcript (app)",
      "  exo terminals write <id> <text>            Write raw input to terminal (app)",
      "  exo terminals send <id> <text>             Send input plus Enter to terminal (app)",
      "  exo agents [list]                          List live Exo agents (app)",
      "  exo agents create <shell|claude|codex>     Create Exo agent (app)",
      "  exo agents read <id> [--tail n] [--raw]    Read agent transcript (app)",
      "  exo agents send <id> <text> [--raw]        Send message plus Enter to agent (app)",
      "  exo agents message <id> <text>             Alias for agents send (app)",
      "  exo agents tell <id> <text>                Alias for agents send (app)",
      "  exo agents interrupt <id> [escape|ctrl-c]  Interrupt agent (app)",
      "  exo agents terminate <id>                  Terminate agent (app)",
      "  exo launch <shell|claude|codex> [cwd]",
      "  exo workspace status",
      "  exo workspace search <query>",
      "  exo notes search <query>",
      "  exo notes read <path>",
      "  exo notes branch-create <path>",
      "  exo notes branch-view <path>",
      "  exo integrations doctor",
      "  exo integrations config <codex|claude|all>",
      "  exo integrations install <codex|claude|all> [--dry-run]",
      "  exo integrations test <codex|claude|all>",
      "  exo runtime status",
      "  exo runtime context <shell|claude|codex>",
      "  exo runtime launch-plan <shell|claude|codex> [cwd]",
      "  exo runtime sync",
    ].join("\n"),
  );
  return 1;
}

async function connectOrFail(
  env: NodeJS.ProcessEnv,
  stderr: { write: (text: string) => void },
): Promise<AppClient | null> {
  const config = resolveRuntimeConfig(env);
  const client = await AppClient.connect(config.runtimeRoot);
  if (!client) {
    stderr.write("Exo app is not running. Start it with: exo dev\n");
    return null;
  }
  return client;
}

async function launchAgent(
  plan: ReturnType<typeof resolveAgentLaunchPlan>,
  options: {
    env: NodeJS.ProcessEnv;
    stdin: NodeJS.ReadStream;
    stdout: { write: (text: string) => void };
    stderr: { write: (text: string) => void };
  },
): Promise<number> {
  const interactive =
    options.stdin === process.stdin && options.stdout === process.stdout && options.stderr === process.stderr;
  const child = spawn(plan.command, plan.args, {
    cwd: plan.cwd,
    env: {
      ...process.env,
      ...options.env,
      ...plan.env,
    },
    stdio: interactive ? "inherit" : ["ignore", "pipe", "pipe"],
  });

  if (!interactive) {
    child.stdout?.on("data", (chunk) => {
      options.stdout.write(String(chunk));
    });
    child.stderr?.on("data", (chunk) => {
      options.stderr.write(String(chunk));
    });
  }

  return new Promise<number>((resolve, reject) => {
    child.on("error", reject);
    child.on("exit", (code, signal) => {
      if (signal) {
        options.stderr.write(`Process terminated by signal ${signal}\n`);
        resolve(1);
        return;
      }

      resolve(code ?? 0);
    });
  });
}

function normalizeAgentKind(value?: string): ManagedAgentKind | null {
  if (value === "shell" || value === "claude" || value === "codex") {
    return value;
  }

  return null;
}

function formatAgents(agents: unknown[]): string {
  if (agents.length === 0) {
    return "No Exo agents are registered.";
  }

  return agents.map((agent) => {
    const entry = agent as Record<string, unknown>;
    return [
      String(entry.id ?? ""),
      String(entry.kind ?? ""),
      String(entry.status ?? ""),
      String(entry.cwd ?? ""),
      String(entry.title ?? ""),
    ].join("\t");
  }).join("\n");
}

function parseTailChars(args: string[]): number {
  if (args.includes("--full")) {
    return 0;
  }
  const tailIndex = args.indexOf("--tail");
  if (tailIndex === -1) {
    return 20_000;
  }

  const raw = args[tailIndex + 1];
  const parsed = raw ? Number.parseInt(raw, 10) : Number.NaN;
  if (!Number.isFinite(parsed) || parsed < 0 || parsed > 200_000) {
    throw new Error("Expected --tail to be a number from 0 to 200000.");
  }
  return parsed;
}

function stripAnsi(input: string): string {
  return input
    .replace(/\x1b\][^\x07]*(?:\x07|\x1b\\)/g, "")
    .replace(/\x1b[\[\]()#;?]*(?:[0-9]{1,4}(?:;[0-9]{0,4})*)?[0-9A-ORZcf-nqry=><~]/g, "")
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n");
}

interface IntegrationStatus {
  client: ExoMcpIntegrationClient;
  installed: boolean;
  executable?: string;
  configured: boolean;
  matchedLine?: string;
  error?: string;
}

function parseIntegrationTargets(args: string[]): { clients: ExoMcpIntegrationClient[]; dryRun: boolean } {
  const dryRun = args.includes("--dry-run");
  const target = args.find((arg) => arg !== "--dry-run");
  if (!target) {
    return { clients: [], dryRun };
  }
  if (target === "all") {
    return { clients: EXO_MCP_INTEGRATION_CLIENTS, dryRun };
  }
  if (target === "codex" || target === "claude") {
    return { clients: [target], dryRun };
  }

  throw new Error("Expected one of: codex, claude, all.");
}

async function getIntegrationStatus(
  client: ExoMcpIntegrationClient,
  config: { exoRoot: string; workspaceRoot: string },
  runCommand: CommandRunner,
  env: NodeJS.ProcessEnv,
): Promise<IntegrationStatus> {
  const executable = await detectExecutable(client, runCommand, env);
  if (!executable.found) {
    return {
      client,
      installed: false,
      configured: false,
      error: executable.error,
    };
  }

  const list = await runCommand(client, ["mcp", "list"], { env });
  if (list.code !== 0) {
    return {
      client,
      installed: true,
      executable: executable.path,
      configured: false,
      error: list.stderr || list.stdout || `mcp list exited with ${list.code}`,
    };
  }

  const spec = buildExoMcpIntegrationSpec(client, config);
  const parsed = parseMcpListOutput(list.stdout, spec.server.serverName);
  return {
    client,
    installed: true,
    executable: executable.path,
    configured: parsed.configured,
    matchedLine: parsed.matchedLine,
  };
}

async function detectExecutable(
  command: string,
  runCommand: CommandRunner,
  env: NodeJS.ProcessEnv,
): Promise<{ found: boolean; path?: string; error?: string }> {
  const result = await runCommand("/bin/sh", ["-lc", `command -v ${formatShellCommand([command])}`], { env });
  if (result.code !== 0) {
    return {
      found: false,
      error: result.stderr || result.stdout || `${command} not found on PATH`,
    };
  }

  return {
    found: true,
    path: result.stdout.trim(),
  };
}

function formatIntegrationDoctor(input: {
  exoRoot: string;
  workspaceRoot: string;
  pnpmFound: boolean;
  statuses: IntegrationStatus[];
}): string {
  return [
    "Exo integrations doctor",
    `- exo root: ${input.exoRoot}`,
    `- workspace root: ${input.workspaceRoot}`,
    `- pnpm: ${input.pnpmFound ? "found" : "missing"}`,
    ...input.statuses.map((status) => {
      const installState = status.installed ? `found${status.executable ? ` (${status.executable})` : ""}` : "missing";
      const configState = status.configured ? "configured" : "not configured";
      const detail = status.error && !status.configured ? `; ${status.error.trim()}` : "";
      return `- ${status.client}: ${installState}; Exo MCP ${configState}${detail}`;
    }),
    "",
  ].join("\n");
}

function formatIntegrationTest(statuses: IntegrationStatus[]): string {
  return [
    ...statuses.map((status) => {
      if (!status.installed) {
        return `${status.client}: missing CLI`;
      }
      if (!status.configured) {
        return `${status.client}: Exo MCP not configured${status.error ? ` (${status.error.trim()})` : ""}`;
      }
      return `${status.client}: Exo MCP configured${status.matchedLine ? ` (${status.matchedLine})` : ""}`;
    }),
    "",
  ].join("\n");
}

function resolveExoRoot(env: NodeJS.ProcessEnv): string {
  return env.EXO_PROJECT_ROOT ?? path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
}

function runProcess(
  command: string,
  args: string[],
  options: { cwd?: string; env?: NodeJS.ProcessEnv } = {},
): Promise<CommandRunResult> {
  const child = spawn(command, args, {
    cwd: options.cwd,
    env: { ...process.env, ...options.env },
    stdio: ["ignore", "pipe", "pipe"],
  });

  let stdout = "";
  let stderr = "";
  child.stdout?.on("data", (chunk) => {
    stdout += String(chunk);
  });
  child.stderr?.on("data", (chunk) => {
    stderr += String(chunk);
  });

  return new Promise((resolve) => {
    child.on("error", (error) => {
      resolve({ code: 127, stdout, stderr: stderr || error.message });
    });
    child.on("exit", (code, signal) => {
      resolve({ code: signal ? 1 : (code ?? 0), stdout, stderr });
    });
  });
}

async function main() {
  try {
    process.exitCode = await runCli(process.argv);
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  }
}

const invokedPath = process.argv[1];
if (invokedPath && path.resolve(invokedPath) === fileURLToPath(import.meta.url)) {
  void main();
}
