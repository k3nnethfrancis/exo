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
  readIndexDocument,
  renderPrimaryAgentInstructions,
  resolveAgentLaunchPlan,
  resolveRuntimeConfig,
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
} from "@exo/core";

import { AppClient } from "./app-client";

interface CommandRunResult {
  code: number;
  stdout: string;
  stderr: string;
}

interface AppClientLike {
  getStatus(): Promise<Record<string, unknown>>;
  openFile(filePath: string): Promise<void>;
  showWindow(): Promise<void>;
  getConfig(): Promise<Record<string, unknown>>;
  search(query: string, options?: { limit?: number }): Promise<Record<string, unknown>>;
  readDocument(target: string, options?: { fromLine?: number; maxLines?: number }): Promise<Record<string, unknown>>;
  getIndexStatus(): Promise<Record<string, unknown>>;
  syncIndex(): Promise<Record<string, unknown>>;
  addIndexRoot(input: { path: string; name?: string; kind?: string; pattern?: string; force?: boolean }): Promise<Record<string, unknown>>;
  removeIndexRoot(target: string): Promise<Record<string, unknown>>;
  updateIndex(): Promise<Record<string, unknown>>;
  embedIndex(): Promise<Record<string, unknown>>;
  listTerminals(): Promise<unknown[]>;
  createTerminal(kind: string, cwd?: string): Promise<Record<string, unknown>>;
  readTerminal(id: string): Promise<string>;
  readTerminalTranscript(id: string, tailChars?: number): Promise<string>;
  writeTerminal(id: string, data: string): Promise<void>;
  killTerminal(id: string): Promise<void>;
}

type CommandRunner = (
  command: string,
  args: string[],
  options?: { cwd?: string; env?: NodeJS.ProcessEnv },
) => Promise<CommandRunResult>;

type AppClientConnector = (runtimeRoot: string, env: NodeJS.ProcessEnv) => Promise<AppClientLike | null>;

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
  const connectAppClient = options.connectAppClient ?? ((runtimeRoot, connectEnv) => AppClient.connect(runtimeRoot, connectEnv));

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

  if (command === "terminals") {
    const client = await connectOrFail(env, stderr, connectAppClient);
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
    const client = await connectOrFail(env, stderr, connectAppClient);
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
      throw new Error("Expected one of: shell, claude, codex.");
    }

    const config = await resolveCliRuntimeConfig(env);
    const content = renderPrimaryAgentInstructions(config);
    stdout.write(`${content}\n`);
    return 0;
  }

  if (command === "runtime" && subcommand === "launch-plan") {
    const kind = normalizeAgentKind(args[0]);
    if (!kind) {
      throw new Error("Expected one of: shell, claude, codex.");
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

  // ─── Launch commands ─────────────────────────────────────────────────

  if (command === "dev") {
    const projectRoot = env.EXO_PROJECT_ROOT ?? path.resolve(fileURLToPath(import.meta.url), "../../../..");
    const child = spawn("pnpm", ["dev"], {
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
      throw new Error("Expected one of: shell, claude, codex.");
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
      "  exo dev                                    Launch the desktop app",
      "  exo search <query> [--limit n]              Search Exo knowledge index or workspace fallback",
      "  exo read <path-or-docid> [--from n] [--lines n]",
      "  exo index status                           Show QMD-backed index status (app)",
      "  exo index sync                             Sync documents and embeddings for configured mode (app)",
      "  exo index add <path> [--name n] [--kind k] [--force]",
      "  exo index remove <name-or-path>            Remove an indexed root (app)",
      "  exo index update                           Advanced: refresh indexed documents only (app)",
      "  exo index embed                            Advanced: generate pending embeddings only (app)",
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
  connectAppClient: AppClientConnector,
): Promise<AppClientLike | null> {
  const config = await resolveCliRuntimeConfig(env);
  const client = await connectAppClient(config.runtimeRoot, env);
  if (!client) {
    stderr.write("Exo app is not running. Start it with: exo dev\n");
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
    return 0;
  }

  const raw = args[tailIndex + 1];
  const parsed = raw ? Number.parseInt(raw, 10) : Number.NaN;
  if (!Number.isFinite(parsed) || parsed < 0) {
    throw new Error("Expected --tail to be a non-negative number.");
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
