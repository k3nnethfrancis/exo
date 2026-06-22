#!/usr/bin/env node

import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
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
  readIndexDocument,
  renderPrimaryAgentInstructions,
  resolveAgentLaunchPlan,
  resolveRuntimeConfig,
  RoutineService,
  routinePluginDirectoriesFromEnv,
  resolveNotePath,
  resolveWorkspaceModel,
  loadActiveWorkspaceSettings,
  listWorkspaceRegistryEntries,
  getWorkspaceRegistryEntry,
  saveWorkspaceSettings,
  resolveWorkspaceSettingsPath,
  searchIndex,
  searchNotes,
  searchWorkspace,
  syncRuntimeContextFiles,
  workspaceEnvOverrides,
  workspaceSettingsToEnv,
  type ManagedAgentKind,
  type ExoMcpIntegrationClient,
  type RoutineDefinition,
  type RoutineExecutionHost,
  type RoutineTrigger,
  type RunRecord,
} from "@exo/core";

const AGENT_KIND_USAGE = "shell|claude|codex|pi|hermes";

import { AppClient, formatAppClientDiscoveryFailure, type AppClientWriteResult } from "./app-client";

interface CommandRunResult {
  code: number;
  stdout: string;
  stderr: string;
}

interface AppClientLike {
  getStatus(): Promise<Record<string, unknown>>;
  openFile(filePath: string): Promise<void>;
  openPreview(target: string): Promise<Record<string, unknown>>;
  focusPreview(): Promise<Record<string, unknown>>;
  closePreview(): Promise<Record<string, unknown>>;
  showWindow(): Promise<void>;
  getConfig(): Promise<Record<string, unknown>>;
  listProjectRoots(): Promise<string[]>;
  addProjectRoot(projectRootPath: string): Promise<Record<string, unknown>>;
  removeProjectRoot(target: string): Promise<Record<string, unknown>>;
  search(query: string, options?: { limit?: number }): Promise<Record<string, unknown>>;
  readDocument(target: string, options?: { fromLine?: number; maxLines?: number }): Promise<Record<string, unknown>>;
  getIndexStatus(): Promise<Record<string, unknown>>;
  syncIndex(): Promise<Record<string, unknown>>;
  addIndexRoot(input: { path: string; name?: string; kind?: string; pattern?: string; force?: boolean }): Promise<Record<string, unknown>>;
  removeIndexRoot(target: string): Promise<Record<string, unknown>>;
  updateIndex(): Promise<Record<string, unknown>>;
  embedIndex(): Promise<Record<string, unknown>>;
  listTerminals(): Promise<unknown[]>;
  terminalDiagnostics(): Promise<unknown[]>;
  createTerminal(kind: string, cwd?: string): Promise<Record<string, unknown>>;
  readTerminal(id: string, options?: { maxLines?: number }): Promise<string>;
  readTerminalTranscript(id: string, tailChars?: number): Promise<string>;
  writeTerminal(id: string, data: string): Promise<AppClientWriteResult>;
  sendTerminalMessage(id: string, message: string, submit?: boolean): Promise<AppClientWriteResult>;
  reconnectTerminal(id: string): Promise<Record<string, unknown>>;
  killTerminal(id: string): Promise<void>;
}

type CommandRunner = (
  command: string,
  args: string[],
  options?: { cwd?: string; env?: NodeJS.ProcessEnv },
) => Promise<CommandRunResult>;

type AppClientConnector = (runtimeRoot: string, env: NodeJS.ProcessEnv) => Promise<AppClientLike | null>;

const defaultAppClientConnector: AppClientConnector = (runtimeRoot, connectEnv) => AppClient.connect(runtimeRoot, connectEnv);

const DEFAULT_AGENT_READ_TAIL_CHARS = 20_000;

export async function runCli(
  argv: string[],
  options: {
    env?: NodeJS.ProcessEnv;
    stdin?: NodeJS.ReadStream;
    stdout?: { write: (text: string) => void };
    stderr?: { write: (text: string) => void };
    cwd?: string;
    runCommand?: CommandRunner;
    connectAppClient?: AppClientConnector;
  } = {},
): Promise<number> {
  const env = options.env ?? process.env;
  const stdin = options.stdin ?? process.stdin;
  const stdout = options.stdout ?? process.stdout;
  const stderr = options.stderr ?? process.stderr;
  const cwd = options.cwd ?? process.cwd();
  const runCommand = options.runCommand ?? runProcess;
  const connectAppClient = options.connectAppClient ?? defaultAppClientConnector;

  const [, , command, subcommand, ...args] = argv;

  // ─── Search ──────────────────────────────────────────────────────────

  if (command === "search") {
    const { values, positionals } = parseInlineOptions([subcommand, ...args].filter(Boolean));
    const query = positionals.join(" ");
    if (!query) {
      throw new Error("Expected a search query.");
    }

    const config = await resolveCliRuntimeConfig(env);
    const client = await connectAppClient(config.runtimeRoot, env);
    const limit = parsePositiveInt(values.limit);
    const results = client
      ? await client.search(query, { limit })
      : await searchIndex(config.workspace, config.runtimeRoot, query, { limit });
    stdout.write(`${JSON.stringify(results, null, 2)}\n`);
    return 0;
  }

  if (command === "read") {
    const { values, positionals } = parseInlineOptions([subcommand, ...args].filter(Boolean));
    const target = positionals[0];
    if (!target) {
      throw new Error("Expected a document path or docid.");
    }
    const targetPath = target.startsWith("#") ? target : path.resolve(cwd, target);

    const config = await resolveCliRuntimeConfig(env);
    const client = await connectAppClient(config.runtimeRoot, env);
    const result = client
      ? await client.readDocument(targetPath, { fromLine: parsePositiveInt(values.from), maxLines: parsePositiveInt(values.lines) })
      : await readIndexDocument(config.workspace, config.runtimeRoot, targetPath, { fromLine: parsePositiveInt(values.from), maxLines: parsePositiveInt(values.lines) });
    stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    return 0;
  }

  if (command === "index") {
    const client = await connectOrFail(env, stderr, connectAppClient);
    if (!client) return 1;

    if (subcommand === "status" || !subcommand) {
      stdout.write(`${JSON.stringify(await client.getIndexStatus(), null, 2)}\n`);
      return 0;
    }

    if (subcommand === "sync") {
      stdout.write(`${JSON.stringify(await client.syncIndex(), null, 2)}\n`);
      return 0;
    }

    if (subcommand === "add") {
      const { values, positionals } = parseInlineOptions(args);
      const targetPath = positionals[0];
      if (!targetPath) {
        throw new Error("Usage: exo index add <path> [--name <name>] [--kind notes|docs|code|mixed] [--pattern \"**/*.md\"]");
      }
      stdout.write(`${JSON.stringify(await client.addIndexRoot({
        path: path.resolve(cwd, targetPath),
        name: values.name,
        kind: values.kind,
        pattern: values.pattern,
        force: values.force === "1",
      }), null, 2)}\n`);
      return 0;
    }

    if (subcommand === "remove") {
      const target = args[0];
      if (!target) {
        throw new Error("Usage: exo index remove <name-or-path>");
      }
      stdout.write(`${JSON.stringify(await client.removeIndexRoot(target), null, 2)}\n`);
      return 0;
    }

    if (subcommand === "update") {
      stdout.write(`${JSON.stringify(await client.updateIndex(), null, 2)}\n`);
      return 0;
    }

    if (subcommand === "embed") {
      stdout.write(`${JSON.stringify(await client.embedIndex(), null, 2)}\n`);
      return 0;
    }

    throw new Error("Usage: exo index <status|sync|add|remove|update|embed>");
  }

  // ─── Local agent integrations ───────────────────────────────────────

  if (command === "integrations") {
    const exoRoot = resolveExoRoot(env);
    const workspaceRoot = (await resolveCliRuntimeConfig(env)).workspace.workspaceRoot;
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

    const client = await connectOrFail(env, stderr, connectAppClient);
    if (!client) return 1;
    await client.openFile(filePath);
    stdout.write(`Opened: ${filePath}\n`);
    return 0;
  }

  if (command === "preview") {
    const client = await connectOrFail(env, stderr, connectAppClient);
    if (!client) return 1;

    if (subcommand === "open") {
      const target = args.join(" ");
      if (!target) {
        throw new Error("Usage: exo preview open <url-or-html-path>");
      }
      stdout.write(`${JSON.stringify(await client.openPreview(target), null, 2)}\n`);
      return 0;
    }

    if (subcommand === "focus") {
      stdout.write(`${JSON.stringify(await client.focusPreview(), null, 2)}\n`);
      return 0;
    }

    if (subcommand === "close") {
      stdout.write(`${JSON.stringify(await client.closePreview(), null, 2)}\n`);
      return 0;
    }

    stderr.write("Usage: exo preview [open <url-or-html-path> | focus | close]\n");
    return 1;
  }

  if (command === "status") {
    const client = await connectOrFail(env, stderr, connectAppClient);
    if (!client) return 1;
    const status = await client.getStatus();
    stdout.write(`${JSON.stringify(status, null, 2)}\n`);
    return 0;
  }

  if (command === "show") {
    const client = await connectOrFail(env, stderr, connectAppClient);
    if (!client) return 1;
    await client.showWindow();
    stdout.write("Showed Exo window.\n");
    return 0;
  }

  if (command === "config") {
    const client = await connectOrFail(env, stderr, connectAppClient);
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

  if (command === "project-roots") {
    const client = await connectOrFail(env, stderr, connectAppClient);
    if (!client) return 1;

    if (subcommand === "list" || !subcommand) {
      stdout.write(`${JSON.stringify(await client.listProjectRoots(), null, 2)}\n`);
      return 0;
    }

    if (subcommand === "add") {
      const targetPath = args[0];
      if (!targetPath) {
        throw new Error("Usage: exo project-roots add <path>");
      }
      stdout.write(`${JSON.stringify(await client.addProjectRoot(path.resolve(cwd, targetPath)), null, 2)}\n`);
      return 0;
    }

    if (subcommand === "remove") {
      const target = args[0];
      if (!target) {
        throw new Error("Usage: exo project-roots remove <path>");
      }
      stdout.write(`${JSON.stringify(await client.removeProjectRoot(path.resolve(cwd, target)), null, 2)}\n`);
      return 0;
    }

    stderr.write("Usage: exo project-roots [list | add <path> | remove <path>]\n");
    return 1;
  }

  if (command === "terminals") {
    const client = await connectOrFail(env, stderr, connectAppClient);
    if (!client) return 1;

    if (subcommand === "list" || !subcommand) {
      const terminals = await client.listTerminals();
      stdout.write(`${JSON.stringify(terminals, null, 2)}\n`);
      return 0;
    }

    if (subcommand === "diagnostics") {
      const diagnostics = await client.terminalDiagnostics();
      stdout.write(`${JSON.stringify(diagnostics, null, 2)}\n`);
      return 0;
    }

    if (subcommand === "create") {
      const kind = args[0];
      const normalizedKind = normalizeAgentKind(kind);
      if (!normalizedKind) {
        throw new Error("Expected one of: shell, claude, codex, pi, hermes.");
      }
      const terminal = await client.createTerminal(normalizedKind, args[1]);
      stdout.write(`${JSON.stringify(terminal, null, 2)}\n`);
      return 0;
    }

    if (subcommand === "read") {
      const { values, positionals } = parseInlineOptions(args);
      const id = positionals[0];
      if (!id) {
        throw new Error("Usage: exo terminals read <terminal-id> [--lines n]");
      }
      const tail = await client.readTerminal(id, { maxLines: parseBoundedTerminalReadLines(values.lines) });
      stdout.write(tail);
      if (tail && !tail.endsWith("\n")) {
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
      if (subcommand === "send") {
        await client.sendTerminalMessage(id, data, true);
      } else {
        await client.writeTerminal(id, data);
      }
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

    if (subcommand === "reconnect") {
      const id = args[0];
      if (!id) {
        throw new Error("Usage: exo terminals reconnect <terminal-id>");
      }
      stdout.write(`${JSON.stringify(await client.reconnectTerminal(id), null, 2)}\n`);
      return 0;
    }

    stderr.write(`Usage: exo terminals [list | diagnostics | create <${AGENT_KIND_USAGE}> [cwd] | read <id> [--lines n] | transcript <id> [--tail chars] [--full] | write <id> <text> | send <id> <text> | reconnect <id> | kill <id>]\n`);
    return 1;
  }

  if (command === "agents") {
    if (isHelpFlag(subcommand)) {
      stdout.write(formatAgentsHelp());
      return 0;
    }

    if (subcommand === "create" && args.some(isHelpFlag)) {
      stdout.write(formatAgentsCreateHelp());
      return 0;
    }

    const client = await connectOrFail(env, stderr, connectAppClient);
    if (!client) return 1;

    if (subcommand === "list" || !subcommand) {
      const agents = await client.listTerminals();
      stdout.write(`${formatAgents(agents)}\n`);
      return 0;
    }

    if (subcommand === "create") {
      const kind = args[0];
      if (!normalizeAgentKind(kind)) {
        throw new Error(`Usage: exo agents create <${AGENT_KIND_USAGE}> [cwd]`);
      }
      const cwdArg = args[1];
      if (cwdArg?.startsWith("-")) {
        throw new Error(`Invalid cwd for exo agents create: ${cwdArg}`);
      }
      const agent = await client.createTerminal(kind, cwdArg);
      stdout.write(`${JSON.stringify(agent, null, 2)}\n`);
      return 0;
    }

    if (subcommand === "read") {
      const id = args[0];
      if (!id) {
        throw new Error("Usage: exo agents read <agent-id> [--tail chars] [--full] [--raw]");
      }

      const tailChars = parseAgentReadTailChars(args);
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
      const raw = args.includes("--raw");
      const submit = !args.includes("--no-submit");
      const message = args.slice(1).filter((arg) => !["--submit", "--raw", "--no-submit"].includes(arg)).join(" ");
      if (!id || !message) {
        throw new Error(`Usage: exo agents ${subcommand} <agent-id> <message> [--raw|--no-submit]`);
      }
      if (subcommand === "message" || subcommand === "tell") {
        stderr.write("Deprecated: use exo agents send <id> <message> instead.\n");
      }
      const result = raw ? await client.writeTerminal(id, message) : await client.sendTerminalMessage(id, message, submit);
      if (result.delivery === "queued") {
        stdout.write(`Queued message for ${id} until the agent is ready (${result.queuedInputCount ?? 1} pending).\n`);
      } else {
        stdout.write(`Sent ${raw ? "raw input" : submit ? "message plus Enter" : "message without Enter"} to ${id}.\n`);
      }
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

    stderr.write(`Usage: exo agents [list | create <${AGENT_KIND_USAGE}> [cwd] | read <id> [--tail chars] [--full] [--raw] | send <id> <text> [--raw|--no-submit] | interrupt <id> [escape|ctrl-c] | terminate <id>]\n`);
    return 1;
  }

  // ─── Workspace commands ──────────────────────────────────────────────

  if (command === "workspace" && subcommand === "status") {
    const model = resolveWorkspaceModel(await resolveCliWorkspaceEnv(env));
    stdout.write(`${JSON.stringify(model, null, 2)}\n`);
    return 0;
  }

  if (command === "workspace" && subcommand === "current") {
    const settings = workspaceEnvOverrides(env) ? null : await loadActiveWorkspaceSettings(env);
    const model = resolveWorkspaceModel(settings ? { ...env, ...workspaceSettingsToEnv(settings) } : env);
    stdout.write(`${JSON.stringify({ workspace: model, settingsPath: resolveWorkspaceSettingsPath(env), source: settings ? "registry" : "env" }, null, 2)}\n`);
    return 0;
  }

  if (command === "workspace" && subcommand === "list") {
    const workspaces = await listWorkspaceRegistryEntries(env, await loadActiveWorkspaceSettings(env));
    stdout.write(`${JSON.stringify(workspaces, null, 2)}\n`);
    return 0;
  }

  if (command === "workspace" && subcommand === "use") {
    const target = args[0];
    if (!target) {
      throw new Error("Usage: exo workspace use <workspace-id-or-notes-path>");
    }
    const workspaces = await listWorkspaceRegistryEntries(env, await loadActiveWorkspaceSettings(env));
    const selected =
      workspaces.find((workspace) => workspace.id === target || workspace.notesFolder === path.resolve(cwd, target) || workspace.notesFolder === target) ??
      await getWorkspaceRegistryEntry(target, env);
    if (!selected) {
      throw new Error(`Workspace not found: ${target}`);
    }
    await saveWorkspaceSettings(selected.settings, env);
    stdout.write(`${JSON.stringify(selected, null, 2)}\n`);
    return 0;
  }

  if (command === "workspace" && subcommand === "fixture") {
    const fixtureRoot = path.resolve(cwd, "fixtures/test-workspace");
    stdout.write(`${fixtureRoot}\n`);
    return 0;
  }

  if (command === "workspace" && subcommand === "search") {
    const query = args.join(" ");
    const model = resolveWorkspaceModel(await resolveCliWorkspaceEnv(env));
    const results = await searchWorkspace(model, query);
    stdout.write(`${JSON.stringify(results, null, 2)}\n`);
    return 0;
  }

  // ─── Notes commands ──────────────────────────────────────────────────

  if (command === "notes" && subcommand === "search") {
    const query = args.join(" ");
    const model = resolveWorkspaceModel(await resolveCliWorkspaceEnv(env));
    const results = await searchNotes(model, query);
    stdout.write(`${JSON.stringify(results, null, 2)}\n`);
    return 0;
  }

  if (command === "notes" && subcommand === "read") {
    const target = args[0];
    if (!target) {
      throw new Error("Expected a note path.");
    }

    const model = resolveWorkspaceModel(await resolveCliWorkspaceEnv(env));
    const targetPath = resolveNotePath(model, target, cwd);
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
    const model = resolveWorkspaceModel(await resolveCliWorkspaceEnv(env));
    const result = await createBranchFile(targetPath, document, model.noteRoots.map((root) => root.path));
    stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    return 0;
  }

  if (command === "notes" && subcommand === "branch-view") {
    const targetPath = args[0];
    if (!targetPath) {
      throw new Error("Expected a markdown note path.");
    }

    const model = resolveWorkspaceModel(await resolveCliWorkspaceEnv(env));
    const family = await getBranchFamily(targetPath, model.noteRoots.map((root) => root.path));
    stdout.write(`${JSON.stringify(family, null, 2)}\n`);
    return 0;
  }

  // ─── Runtime commands ────────────────────────────────────────────────

  if (command === "runtime" && subcommand === "status") {
    const config = await resolveCliRuntimeConfig(env);
    stdout.write(`${JSON.stringify(config, null, 2)}\n`);
    return 0;
  }

  if (command === "runtime" && subcommand === "context") {
    const kind = normalizeAgentKind(args[0]);
    if (!kind) {
      throw new Error("Expected one of: shell, claude, codex, pi, hermes.");
    }

    const config = await resolveCliRuntimeConfig(env);
    const content = renderPrimaryAgentInstructions(config);
    stdout.write(`${content}\n`);
    return 0;
  }

  if (command === "runtime" && subcommand === "launch-plan") {
    const kind = normalizeAgentKind(args[0]);
    if (!kind) {
      throw new Error("Expected one of: shell, claude, codex, pi, hermes.");
    }

    const config = await resolveCliRuntimeConfig(env);
    const launchPlan = resolveAgentLaunchPlan(config, kind, args[1]);
    stdout.write(`${JSON.stringify(launchPlan, null, 2)}\n`);
    return 0;
  }

  if (command === "runtime" && subcommand === "sync") {
    const config = await resolveCliRuntimeConfig(env);
    const paths = await syncRuntimeContextFiles(config);
    stdout.write(`${JSON.stringify(paths, null, 2)}\n`);
    return 0;
  }

  // ─── Routine commands ────────────────────────────────────────────────

  if (command === "routines") {
    const config = await resolveCliRuntimeConfig(env);
    const service = createRoutineService(config, env);

    if (subcommand === "templates") {
      stdout.write(`${JSON.stringify(await service.listTemplates(), null, 2)}\n`);
      return 0;
    }

    if (subcommand === "list" || !subcommand) {
      stdout.write(`${JSON.stringify(await service.listRoutines(), null, 2)}\n`);
      return 0;
    }

    if (subcommand === "runs") {
      const { values } = parseInlineOptions(args);
      stdout.write(`${JSON.stringify(await service.listRuns({ routineId: values.routine }), null, 2)}\n`);
      return 0;
    }

    if (subcommand === "read") {
      const runId = args[0];
      if (!runId) {
        throw new Error("Usage: exo routines read <run-id>");
      }
      stdout.write(`${JSON.stringify(await service.requireRun(runId), null, 2)}\n`);
      return 0;
    }

    if (subcommand === "artifacts") {
      const runId = args[0];
      if (!runId) {
        throw new Error("Usage: exo routines artifacts <run-id>");
      }
      stdout.write(`${JSON.stringify((await service.requireRun(runId)).artifacts, null, 2)}\n`);
      return 0;
    }

    if (subcommand === "artifact") {
      const runId = args[0];
      const artifactId = args[1];
      if (!runId || !artifactId) {
        throw new Error("Usage: exo routines artifact <run-id> <artifact-id>");
      }
      stdout.write((await service.readArtifact(runId, artifactId)).contents);
      return 0;
    }

    if (subcommand === "create") {
      const { values, positionals } = parseInlineOptions(args);
      const templateId = positionals[0];
      const routineId = positionals[1];
      if (!templateId || !routineId) {
        throw new Error("Usage: exo routines create <template-id> <routine-id> [--title <title>] [--prompt <text>] [--harness <id>] [--schedule <cron>] [--timezone <tz>] [--path <path>]");
      }
      const routine = await service.createRoutineFromTemplate(templateId, {
        id: routineId,
        title: values.title,
        prompt: values.prompt,
        harnessId: values.harness,
        trigger: parseRoutineTrigger(values),
        scope: {
          workspaceRoot: config.workspace.workspaceRoot,
          noteRootIds: config.workspace.noteRoots.map((root) => root.id),
          projectRootIds: config.workspace.projectRoots.map((root) => root.id),
          paths: values.path ? [values.path] : [],
        },
      });
      stdout.write(`${JSON.stringify(routine, null, 2)}\n`);
      return 0;
    }

    if (subcommand === "run") {
      const { values, positionals } = parseInlineOptions(args);
      const routineId = positionals[0];
      if (!routineId || (values["dry-run"] !== "1" && values.agent !== "1")) {
        throw new Error(`Usage: exo routines run <routine-id> (--dry-run | --agent) [--harness ${AGENT_KIND_USAGE}] [--cwd <path>] [--no-submit]`);
      }
      if (values.agent === "1") {
        const routine = await service.readRoutine(routineId);
        if (!routine) {
          throw new Error(`Routine not found: ${routineId}`);
        }
        const harness = normalizeAgentKind(values.harness ?? routine.harnessId);
        if (!harness) {
          throw new Error(`Routine harness must be one of ${AGENT_KIND_USAGE}: ${values.harness ?? routine.harnessId}`);
        }
        const client = await connectOrFail(env, stderr, connectAppClient);
        if (!client) return 1;
        stdout.write(`${JSON.stringify(await service.runManualWithHost(routineId, new AppRoutineExecutionHost(client, {
          harness,
          cwd: values.cwd,
          submit: values["no-submit"] !== "1",
          clock: () => new Date().toISOString(),
        })), null, 2)}\n`);
        return 0;
      }
      stdout.write(`${JSON.stringify(await service.runManualDryRun(routineId), null, 2)}\n`);
      return 0;
    }

    throw new Error("Usage: exo routines [templates | list | runs | read <run-id> | artifacts <run-id> | artifact <run-id> <artifact-id> | create <template-id> <routine-id> | run <routine-id> (--dry-run | --agent)]");
  }

  // ─── Launch commands ─────────────────────────────────────────────────

  if (!command || command === "start") {
    return startExoApp({ env, stderr });
  }

  if (command === "dev") {
    stderr.write("Deprecated: `exo dev` is a developer shortcut. Use `exo start` for the resident app or `pnpm dev:qa` for source QA.\n");
    const projectRoot = env.EXO_PROJECT_ROOT ?? path.resolve(fileURLToPath(import.meta.url), "../../../..");
    const child = spawn("pnpm", ["dev:qa"], {
      cwd: projectRoot,
      env: {
        ...process.env,
        ...env,
        COREPACK_ENABLE_PROJECT_SPEC: env.COREPACK_ENABLE_PROJECT_SPEC ?? process.env.COREPACK_ENABLE_PROJECT_SPEC ?? "0",
        EXO_WORKSPACE_ROOT: env.EXO_WORKSPACE_ROOT ?? projectRoot,
        EXO_DEFAULT_TERMINAL_CWD: env.EXO_DEFAULT_TERMINAL_CWD ?? env.EXO_WORKSPACE_ROOT ?? projectRoot,
      },
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
      throw new Error("Expected one of: shell, claude, codex, pi, hermes.");
    }

    const config = await resolveCliRuntimeConfig(env);
    await syncRuntimeContextFiles(config);
    const launchPlan = resolveAgentLaunchPlan(config, kind, args[0]);
    return launchAgent(launchPlan, { env, stdin, stdout, stderr });
  }

  // ─── Usage ───────────────────────────────────────────────────────────

  stderr.write(
    [
      "Usage:",
      "  exo                                        Start or focus the resident Exo app",
      "  exo start                                  Start or focus the resident Exo app",
      "  exo search <query> [--limit n]              Search Exo knowledge index or workspace fallback",
      "  exo read <path-or-docid> [--from n] [--lines n]",
      "  exo routines templates                    List plugin-declared routine templates",
      "  exo routines list                         List concrete workspace routines",
      "  exo routines runs                         List routine runs",
      "  exo routines read <run-id>                 Read a routine run record",
      "  exo routines artifacts <run-id>            List routine run artifacts",
      "  exo routines artifact <run-id> <artifact>  Print a routine artifact",
      "  exo routines create <template-id> <id>     Create a routine from a template",
      "  exo routines run <id> --dry-run            Record a dry-run routine execution",
      "  exo routines run <id> --agent              Launch an Exo app agent and send the routine prompt",
      "  exo index status                           Show QMD-backed index status (app)",
      "  exo index sync                             Sync documents and embeddings for configured mode (app)",
      "  exo index add <path> [--name n] [--kind k] [--force]",
      "  exo index remove <name-or-path>            Remove an indexed root (app)",
      "  exo index update                           Advanced: refresh indexed documents only (app)",
      "  exo index embed                            Advanced: generate pending embeddings only (app)",
      "  exo open <path>                            Open file in editor (app)",
      "  exo preview open <url-or-html-path>        Open URL or local HTML in preview (app)",
      "  exo preview focus                          Focus the preview pane (app)",
      "  exo preview close                          Close the preview pane (app)",
      "  exo status                                 Workspace status (app)",
      "  exo config get [key]                       Read settings (app)",
      "  exo project-roots [list]                   List attached project roots (app)",
      "  exo project-roots add <path>               Attach a project root (app)",
      "  exo project-roots remove <path>            Detach a project root (app)",
      "  exo terminals [list]                       List terminals (app)",
      `  exo terminals create <${AGENT_KIND_USAGE}>  Create terminal (app)`,
      "  exo terminals read <id> [--lines n]        Read bounded live terminal tail (app)",
      "  exo terminals transcript <id> [--tail n]   Read disk-backed terminal transcript (app)",
      "  exo terminals write <id> <text>            Write raw input to terminal (app)",
      "  exo terminals send <id> <text>             Send input plus Enter to terminal (app)",
      "  exo terminals reconnect <id>               Reattach Exo to a live tmux terminal (app)",
      "  exo agents [list]                          List live Exo agents (app)",
      `  exo agents create <${AGENT_KIND_USAGE}>     Create Exo agent (app)`,
      "  exo agents read <id> [--tail n] [--full] [--raw] Read agent transcript tail (app)",
      "  exo agents send <id> <text> [--raw|--no-submit] Send message to agent (app)",
      "  exo agents interrupt <id> [escape|ctrl-c]  Interrupt agent (app)",
      "  exo agents terminate <id>                  Terminate agent (app)",
      `  exo launch <${AGENT_KIND_USAGE}> [cwd]`,
      "  exo workspace status",
      "  exo workspace current",
      "  exo workspace list",
      "  exo workspace use <workspace-id-or-notes-path>",
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
      `  exo runtime context <${AGENT_KIND_USAGE}>`,
      `  exo runtime launch-plan <${AGENT_KIND_USAGE}> [cwd]`,
      "  exo runtime sync",
      "",
      "Developer source QA:",
      "  pnpm dev:qa",
    ].join("\n"),
  );
  return 1;
}

async function startExoApp(options: {
  env: NodeJS.ProcessEnv;
  stderr: { write: (text: string) => void };
}): Promise<number> {
  if (process.platform !== "darwin") {
    options.stderr.write("`exo start` currently supports macOS packaged app launches. Use `pnpm dev:qa` for source QA.\n");
    return 1;
  }

  const explicitAppPath = options.env.EXO_APP_PATH;
  const candidates = [
    explicitAppPath,
    path.join(options.env.HOME ?? "", "Applications", "Exo.app"),
    "/Applications/Exo.app",
  ].filter((candidate): candidate is string => Boolean(candidate));
  const appPath = candidates.find((candidate) => existsSync(candidate));

  if (!appPath) {
    options.stderr.write("Unable to find Exo.app. Install it with `scripts/install-mac-app --with-cli`, or set EXO_APP_PATH.\n");
    return 1;
  }

  const child = spawn("open", [appPath], {
    env: { ...process.env, ...options.env },
    stdio: "ignore",
    detached: true,
  });
  child.unref();

  return new Promise<number>((resolve, reject) => {
    child.on("error", reject);
    child.on("exit", (code) => {
      if (code) {
        options.stderr.write(`Unable to start Exo app at ${appPath}.\n`);
      }
      resolve(code ?? 0);
    });
  });
}

async function connectOrFail(
  env: NodeJS.ProcessEnv,
  stderr: { write: (text: string) => void },
  connectAppClient: AppClientConnector,
): Promise<AppClientLike | null> {
  const config = await resolveCliRuntimeConfig(env);
  if (connectAppClient === defaultAppClientConnector) {
    const result = await AppClient.connectDetailed(config.runtimeRoot, env);
    if (!result.ok) {
      stderr.write(formatAppClientDiscoveryFailure(result.failure));
      return null;
    }
    return result.client;
  }
  const client = await connectAppClient(config.runtimeRoot, env);
  if (!client) {
    stderr.write([
      "Exo app is not reachable. Start it with: exo start",
      `Runtime root: ${config.runtimeRoot}`,
      `Discovery file: ${path.join(config.runtimeRoot, "server.json")}`,
      "",
    ].join("\n"));
    return null;
  }
  return client;
}

async function resolveCliWorkspaceEnv(env: NodeJS.ProcessEnv): Promise<NodeJS.ProcessEnv> {
  if (workspaceEnvOverrides(env)) {
    return env;
  }
  const settings = await loadActiveWorkspaceSettings(env);
  return settings ? { ...env, ...workspaceSettingsToEnv(settings) } : env;
}

async function resolveCliRuntimeConfig(env: NodeJS.ProcessEnv) {
  return resolveRuntimeConfig(await resolveCliWorkspaceEnv(env));
}

function createRoutineService(config: Awaited<ReturnType<typeof resolveCliRuntimeConfig>>, env: NodeJS.ProcessEnv): RoutineService {
  const exoRoot = resolveExoRoot(env);
  return new RoutineService({
    workspace: config.workspace,
    runtimeRoot: config.runtimeRoot,
    pluginDirectories: routinePluginDirectoriesFromEnv(config.workspace.workspaceRoot, {
      ...env,
      EXO_PROJECT_ROOT: env.EXO_PROJECT_ROOT ?? exoRoot,
    }),
  });
}

function parseRoutineTrigger(values: Record<string, string>): RoutineTrigger | undefined {
  if (!values.schedule) {
    return undefined;
  }
  return {
    kind: "schedule",
    schedule: values.schedule,
    timezone: values.timezone,
  };
}

class AppRoutineExecutionHost implements RoutineExecutionHost {
  constructor(
    private readonly client: AppClientLike,
    private readonly options: {
      harness: ManagedAgentKind;
      cwd?: string;
      submit: boolean;
      clock: () => string;
    },
  ) {}

  async execute(routine: RoutineDefinition, run: RunRecord) {
    const terminal = await this.client.createTerminal(this.options.harness, this.options.cwd);
    const terminalId = String(terminal.id ?? "");
    if (!terminalId) {
      throw new Error("Exo app did not return a terminal id for routine execution.");
    }
    const message = formatRoutineAgentPrompt(routine);
    const delivery = await this.client.sendTerminalMessage(terminalId, message, this.options.submit);
    const now = this.options.clock();
    return {
      artifacts: [
        {
          artifact: {
            id: "agent-session",
            kind: "report" as const,
            title: "Routine Agent Session",
            mimeType: "text/markdown",
            createdAt: now,
            metadata: {
              terminalId,
              harness: this.options.harness,
              delivery,
            },
          },
          fileName: "agent-session.md",
          contents: [
            "# Routine Agent Session",
            "",
            `- Routine: ${routine.id}`,
            `- Run: ${run.id}`,
            `- Harness: ${this.options.harness}`,
            `- Terminal: ${terminalId}`,
            `- Delivery: ${delivery.delivery}`,
            "",
            "## Prompt Sent",
            "",
            message,
            "",
          ].join("\n"),
        },
      ],
      tracePackets: [
        {
          id: "agent-session-created",
          kind: "event" as const,
          timestamp: now,
          actor: "exo.routine-cli",
          private: false,
          evidence: [],
          payload: {
            terminalId,
            harness: this.options.harness,
            delivery,
          },
        },
      ],
      needsReview: true,
    };
  }
}

function formatRoutineAgentPrompt(routine: RoutineDefinition): string {
  const requiredSkills =
    routine.requiredSkills.length > 0
      ? [
          "",
          "Required or suggested harness skills:",
          ...routine.requiredSkills.map((skill) => `- ${skill.id}${skill.required ? " (required)" : " (optional)"}${skill.label ? `: ${skill.label}` : ""}`),
        ]
      : [];
  return [
    `# Exo Routine: ${routine.title}`,
    "",
    routine.prompt,
    ...requiredSkills,
    "",
    "When finished, summarize what you did and call out any files, artifacts, or follow-up review needed.",
  ].join("\n");
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
  if (value === "shell" || value === "claude" || value === "codex" || value === "pi" || value === "hermes") {
    return value;
  }

  return null;
}

function isHelpFlag(value: string | undefined): boolean {
  return value === "--help" || value === "-h";
}

function formatAgentsHelp(): string {
  return [
    `Usage: exo agents [list | create <${AGENT_KIND_USAGE}> [cwd] | read <id> [--tail chars] [--full] [--raw] | send <id> <text> [--raw|--no-submit] | interrupt <id> [escape|ctrl-c] | terminate <id>]`,
    "",
    "Commands:",
    "  list                                      List live Exo agents",
    `  create <${AGENT_KIND_USAGE}> [cwd]        Create an Exo agent`,
    "  read <id> [--tail chars] [--full] [--raw] Read an agent transcript tail",
    "  send <id> <text> [--raw|--no-submit]     Send a semantic message, or raw terminal input with --raw",
    "  interrupt <id> [escape|ctrl-c]           Interrupt an agent",
    "  terminate <id>                           Terminate an agent",
    "",
  ].join("\n");
}

function formatAgentsCreateHelp(): string {
  return [
    `Usage: exo agents create <${AGENT_KIND_USAGE}> [cwd]`,
    "",
    "Create an Exo-managed agent terminal in the running app.",
    "",
    "Arguments:",
    `  ${AGENT_KIND_USAGE}                       Agent provider to launch`,
    "  cwd                                      Optional working directory for the agent",
    "",
  ].join("\n");
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
    return 0;
  }

  const raw = args[tailIndex + 1];
  const parsed = raw ? Number.parseInt(raw, 10) : Number.NaN;
  if (!Number.isFinite(parsed) || parsed < 0) {
    throw new Error("Expected --tail to be a non-negative number.");
  }
  return parsed;
}

function parseAgentReadTailChars(args: string[]): number {
  if (args.includes("--full")) {
    return 0;
  }
  const tailChars = parseTailChars(args);
  return tailChars > 0 ? tailChars : DEFAULT_AGENT_READ_TAIL_CHARS;
}

function parseBoundedTerminalReadLines(value: string | undefined): number | undefined {
  if (!value) {
    return undefined;
  }
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new Error("Expected --lines to be a positive number.");
  }
  return parsed;
}

function parseInlineOptions(args: string[]): { values: Record<string, string>; positionals: string[] } {
  const values: Record<string, string> = {};
  const positionals: string[] = [];
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg.startsWith("--")) {
      const key = arg.slice(2);
      const next = args[index + 1];
      if (next && !next.startsWith("--")) {
        values[key] = next;
        index += 1;
      } else {
        values[key] = "1";
      }
    } else {
      positionals.push(arg);
    }
  }
  return { values, positionals };
}

function parsePositiveInt(value: string | undefined): number | undefined {
  if (!value) {
    return undefined;
  }
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined;
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
