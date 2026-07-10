#!/usr/bin/env node

import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  formatManagedAgentKindUsage,
  createBranchFile,
  getBranchFamily,
  normalizeManagedAgentKind,
  readWorkspaceDocument,
  getIndexStatus,
  readIndexDocument,
  renderPrimaryAgentInstructions,
  resolveAgentLaunchPlan,
  resolveRuntimeConfig,
  validateRegisteredAgentHarnessLaunch,
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
  SemanticTraceStore,
  semanticTraceEventsToAgentAnswerText,
  cleanTerminalOutput,
  type ManagedAgentKind,
  type SemanticTraceEvent,
  type SemanticTraceCleanupResult,
  type SemanticTraceSessionListEntry,
} from "@exo/core";

const TERMINAL_KIND_USAGE = formatManagedAgentKindUsage();
const TERMINAL_KIND_EXPECTED = `Expected one of: ${TERMINAL_KIND_USAGE.replaceAll("|", ", ")}.`;
const defaultStartWaitTimeoutMs = 20_000;
const startWaitPollIntervalMs = 250;

import { AppClient, formatAppClientDiscoveryFailure, type AppClientDiscoveryFailure, type AppClientWriteResult } from "./app-client";

interface AppClientLike {
  getStatus(): Promise<Record<string, unknown>>;
  openFile(filePath: string): Promise<void>;
  openPreview(target: string): Promise<Record<string, unknown>>;
  focusPreview(): Promise<Record<string, unknown>>;
  closePreview(): Promise<Record<string, unknown>>;
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
  terminalDiagnostics(): Promise<unknown[]>;
  createTerminal(kind: string, cwd?: string): Promise<Record<string, unknown>>;
  spawnAgentCommand(handle: string, task: string): Promise<Record<string, unknown>>;
  readTerminal(id: string, options?: { maxLines?: number }): Promise<string>;
  readTerminalTranscript(id: string, tailChars?: number): Promise<string>;
  writeTerminal(id: string, data: string): Promise<AppClientWriteResult>;
  sendTerminalMessage(id: string, message: string, submit?: boolean): Promise<AppClientWriteResult>;
  killTerminal(id: string): Promise<void>;
}

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
    connectAppClient?: AppClientConnector;
  } = {},
): Promise<number> {
  const env = options.env ?? process.env;
  const stdin = options.stdin ?? process.stdin;
  const stdout = options.stdout ?? process.stdout;
  const stderr = options.stderr ?? process.stderr;
  const cwd = options.cwd ?? process.cwd();
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
    if (subcommand === "status" || !subcommand) {
      const config = await resolveCliRuntimeConfig(env);
      const client = await connectAppClient(config.runtimeRoot, env);
      const status = client
        ? await client.getIndexStatus()
        : await getIndexStatus(config.workspace, config.runtimeRoot);
      stdout.write(`${JSON.stringify(status, null, 2)}\n`);
      return 0;
    }

    const client = await connectOrFail(env, stderr, connectAppClient);
    if (!client) return 1;

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
    const config = await resolveCliRuntimeConfig(env);
    const client = await connectAppClient(config.runtimeRoot, env);
    const status = client
      ? await client.getStatus()
      : {
        ok: true,
        app: { available: false },
        workspace: config.workspace,
        search: await getIndexStatus(config.workspace, config.runtimeRoot),
      };
    stdout.write(`${JSON.stringify(status, null, 2)}\n`);
    return 0;
  }

  if (command === "spawn") {
    const handle = subcommand;
    const task = args.join(" ");
    if (!handle || !handle.startsWith("@") || !task) {
      throw new Error("Usage: exo spawn @handle <task>");
    }
    const client = await connectOrFail(env, stderr, connectAppClient);
    if (!client) return 1;
    try {
      const result = await client.spawnAgentCommand(handle, task);
      stdout.write(`${JSON.stringify(result, null, 2)}\n`);
      return 0;
    } catch (error) {
      stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
      return 1;
    }
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

    if (subcommand === "diagnostics") {
      const diagnostics = await client.terminalDiagnostics();
      stdout.write(`${JSON.stringify(diagnostics, null, 2)}\n`);
      return 0;
    }

    if (subcommand === "create") {
      const [firstArg, secondArg] = args;
      if (firstArg?.startsWith("-") || secondArg?.startsWith("-")) {
        throw new Error("Usage: exo terminals create [shell] [cwd]");
      }
      const kind = firstArg === "shell" || !firstArg ? "shell" : "shell";
      const cwdArg = firstArg === "shell" ? secondArg : firstArg;
      if (firstArg && firstArg !== "shell" && !path.isAbsolute(firstArg) && !firstArg.startsWith(".")) {
        throw new Error("Terminal creation only supports shell. Usage: exo terminals create [shell] [cwd]");
      }
      const terminal = await client.createTerminal(kind, cwdArg);
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

    stderr.write("Usage: exo terminals [list | diagnostics | create [shell] [cwd] | read <id> [--lines n] | transcript <id> [--tail chars] [--full] | write <id> <text> | send <id> <text> | kill <id>]\n");
    return 1;
  }

  if (command === "agents") {
    if (isHelpFlag(subcommand)) {
      stdout.write(formatAgentsHelp(env));
      return 0;
    }

    if (subcommand === "create" && args.some(isHelpFlag)) {
      stdout.write(formatAgentsCreateHelp(env));
      return 0;
    }

    if (subcommand === "read" && args.some((arg) => arg === "--semantic" || arg === "--trace")) {
      const id = args[0];
      if (!id) {
        throw new Error("Usage: exo agents read <agent-id> [--tail chars] [--full] [--raw] [--semantic]");
      }
      const { values } = parseInlineOptions(args);
      const config = await resolveCliRuntimeConfig(env);
      const events = await new SemanticTraceStore(config.runtimeRoot).readEvents(id, {
        limit: parsePositiveInt(values.limit) ?? 100,
      });
      if (values.json === "1") {
        stdout.write(`${JSON.stringify(events, null, 2)}\n`);
        return 0;
      }
      const answer = semanticTraceEventsToAgentAnswerText(events);
      stdout.write(answer || "(no trace-backed semantic answer output)");
      if (!answer.endsWith("\n")) {
        stdout.write("\n");
      }
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
      throw new Error("exo agents create was removed. Use `exo spawn @handle <task>` for configured AgentCommands or `exo terminals create [cwd]` for a shell.");
    }

    if (subcommand === "read") {
      const id = args[0];
      if (!id) {
        throw new Error("Usage: exo agents read <agent-id> [--tail chars] [--full] [--raw] [--semantic]");
      }

      const tailChars = parseAgentReadTailChars(args);
      const raw = args.includes("--raw");
      const transcript = await client.readTerminalTranscript(id, tailChars);
      const output = raw ? transcript : cleanTerminalOutput(transcript);
      const tailed = tailChars > 0 ? output.slice(-tailChars) : output;
      stderr.write(agentTranscriptReadNote({ tailChars, full: args.includes("--full"), raw }));
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

    stderr.write("Usage: exo agents [list | read <id> [--tail chars] [--full] [--raw] | send <id> <text> [--raw|--no-submit] | interrupt <id> [escape|ctrl-c] | terminate <id>]\n");
    return 1;
  }

  // ─── Workspace commands ──────────────────────────────────────────────

  if (command === "workspace" && subcommand === "status") {
    const model = resolveWorkspaceModel(await resolveCliWorkspaceEnv(env));
    stdout.write(`${JSON.stringify(model, null, 2)}\n`);
    return 0;
  }

  if (command === "workspace" && subcommand === "current") {
    const settings = await loadActiveWorkspaceSettings(env);
    const model = resolveWorkspaceModel(settings ? { ...workspaceSettingsToEnv(settings, { includeWorkspace: !workspaceEnvOverrides(env) }), ...env } : env);
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
      throw new Error(TERMINAL_KIND_EXPECTED);
    }

    const config = await resolveCliRuntimeConfig(env);
    const content = renderPrimaryAgentInstructions(config);
    stdout.write(`${content}\n`);
    return 0;
  }

  if (command === "runtime" && subcommand === "launch-plan") {
    const kind = normalizeAgentKind(args[0]);
    if (!kind) {
      throw new Error(TERMINAL_KIND_EXPECTED);
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

  if (command === "traces") {
    const { values, positionals } = parseInlineOptions(args);
    const config = await resolveCliRuntimeConfig(env);
    const store = new SemanticTraceStore(config.runtimeRoot);

    if (!subcommand || subcommand === "list") {
      const sessions = await store.listSessions();
      stdout.write(values.json === "1" ? `${JSON.stringify(sessions, null, 2)}\n` : renderSemanticTraceSessions(sessions));
      return 0;
    }

    if (subcommand === "read") {
      const sessionId = positionals[0];
      if (!sessionId) {
        throw new Error("Usage: exo traces read <session-id> [--limit n] [--json]");
      }
      const events = await store.readEvents(sessionId, { limit: parsePositiveInt(values.limit) ?? 100 });
      if (values.json === "1") {
        stdout.write(`${JSON.stringify(events, null, 2)}\n`);
        return 0;
      }
      stdout.write(renderSemanticTraceEvents(sessionId, events));
      return 0;
    }

    if (subcommand === "cleanup") {
      const result = await store.cleanupSessions({
        sessionId: values.session ?? positionals[0],
        before: values.before,
        dryRun: values["dry-run"] === "1",
      });
      stdout.write(values.json === "1" ? `${JSON.stringify(result, null, 2)}\n` : renderSemanticTraceCleanup(result));
      return 0;
    }

    throw new Error("Usage: exo traces [list [--json] | read <session-id> [--limit n] [--json] | cleanup (--session <id> | --before <iso-date>) [--dry-run] [--json]]");
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
      throw new Error(TERMINAL_KIND_EXPECTED);
    }

    const config = await resolveCliRuntimeConfig(env);
    if (kind !== "shell") {
      validateRegisteredAgentHarnessLaunch(kind, env);
    }
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
      "  exo search <query> [--limit n]              Search QMD advanced provider or core workspace fallback",
      "  exo read <path-or-docid> [--from n] [--lines n]",
      "  exo traces list                            List semantic trace sessions",
      "  exo traces read <session-id> [--limit n]   Read persisted semantic trace events",
      "  exo traces cleanup --session <id>          Delete one semantic trace session",
      "  exo traces cleanup --before <iso-date>     Delete semantic trace sessions older than a date; add --dry-run to preview",
      "  exo index status                           Show QMD advanced search provider status (app)",
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
      "  exo spawn @handle <task>                   Spawn a trusted configured AgentCommand (app)",
      "  exo config get [key]                       Read settings (app)",
      "  exo terminals [list]                       List terminals (app)",
      "  exo terminals create [shell] [cwd]         Create shell terminal (app)",
      "  exo terminals read <id> [--lines n]        Read bounded live terminal tail (app)",
      "  exo terminals transcript <id> [--tail n]   Read live terminal output tail (app)",
      "  exo terminals write <id> <text>            Write raw input to terminal (app)",
      "  exo terminals send <id> <text>             Send input plus Enter to terminal (app)",
      "  exo spawn @handle <task>                   Start configured AgentCommand in the app",
      "  exo agents [list]                          List live terminal-launched agents (app)",
      "  exo agents read <id> [--tail n] [--full] [--raw] [--semantic] Read live output; --semantic reads trace-backed answer text",
      "  exo agents send <id> <text> [--raw|--no-submit] Send message to agent (app)",
      "  exo agents interrupt <id> [escape|ctrl-c]  Interrupt agent (app)",
      "  exo agents terminate <id>                  Terminate agent (app)",
      `  exo launch <${TERMINAL_KIND_USAGE}> [cwd]`,
      "  exo workspace status",
      "  exo workspace current",
      "  exo workspace list",
      "  exo workspace use <workspace-id-or-notes-path>",
      "  exo workspace search <query>",
      "  exo notes search <query>",
      "  exo notes read <path>",
      "  exo notes branch-create <path>",
      "  exo notes branch-view <path>",
      "  exo runtime status",
      `  exo runtime context <${TERMINAL_KIND_USAGE}>`,
      `  exo runtime launch-plan <${TERMINAL_KIND_USAGE}> [cwd]`,
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
        resolve(code ?? 1);
        return;
      }
      waitForStartedApp(options.env, options.stderr).then(resolve, reject);
    });
  });
}

async function waitForStartedApp(
  env: NodeJS.ProcessEnv,
  stderr: { write: (text: string) => void },
): Promise<number> {
  const timeoutMs = parsePositiveInt(env.EXO_START_TIMEOUT_MS) ?? defaultStartWaitTimeoutMs;
  const deadline = Date.now() + timeoutMs;
  const config = await resolveCliRuntimeConfig(env);
  let lastFailure: AppClientDiscoveryFailure | undefined;

  while (Date.now() < deadline) {
    const result = await AppClient.connectDetailed(config.runtimeRoot, env);
    if (result.ok) {
      return 0;
    }
    lastFailure = result.failure;
    await sleep(startWaitPollIntervalMs);
  }

  stderr.write(`Timed out waiting ${timeoutMs}ms for Exo command server after launching the app.\n`);
  if (lastFailure) {
    stderr.write(formatAppClientDiscoveryFailure(lastFailure));
  } else {
    stderr.write([
      `Runtime root: ${config.runtimeRoot}`,
      `Discovery file: ${path.join(config.runtimeRoot, "server.json")}`,
      "",
    ].join("\n"));
  }
  return 1;
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
  const settings = await loadActiveWorkspaceSettings(env);
  if (!settings) {
    return env;
  }
  return {
    ...workspaceSettingsToEnv(settings, { includeWorkspace: !workspaceEnvOverrides(env) }),
    ...env,
  };
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
  return normalizeManagedAgentKind(value);
}

function isHelpFlag(value: string | undefined): boolean {
  return value === "--help" || value === "-h";
}

function formatAgentsHelp(_env: NodeJS.ProcessEnv): string {
  return [
    "Usage: exo agents [list | read <id> [--tail chars] [--full] [--raw] [--semantic] | send <id> <text> [--raw|--no-submit] | interrupt <id> [escape|ctrl-c] | terminate <id>]",
    "",
    "Commands:",
    "  list                                      List live terminal-launched agents",
    "  read <id> [--tail chars] [--full] [--raw] Read live terminal output; --semantic reads trace-backed answer text",
    "  send <id> <text> [--raw|--no-submit]     Send a semantic message, or raw terminal input with --raw",
    "  interrupt <id> [escape|ctrl-c]           Interrupt an agent",
    "  terminate <id>                           Terminate an agent",
    "",
    "Use `exo spawn @handle <task>` to start a configured AgentCommand.",
    "",
  ].join("\n");
}

function formatAgentsCreateHelp(_env: NodeJS.ProcessEnv): string {
  return [
    "Usage: exo spawn @handle <task>",
    "",
    "`exo agents create` was removed. Agent launches are configured as AgentCommands and started with `exo spawn`.",
    "",
    "Arguments:",
    "  @handle                                  Configured AgentCommand handle",
    "  task                                     Task text to pass to the command",
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

function agentTranscriptReadNote(input: { tailChars: number; full: boolean; raw: boolean }): string {
  const scope = input.full ? "full live terminal output buffer" : `live terminal output tail (${input.tailChars} chars)`;
  const format = input.raw ? "raw ANSI bytes" : "ANSI-cleaned text";
  const truncation = input.full
    ? ""
    : " If output looks cut off mid-repaint, retry with --full, a larger --tail, or --semantic for trace-backed answer text.";
  return `Source: ${scope}; format: ${format}; not semantic trace data.${truncation}\n`;
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

function renderSemanticTraceSessions(sessions: readonly SemanticTraceSessionListEntry[]): string {
  if (sessions.length === 0) {
    return "Semantic trace sessions: none\n";
  }
  const lines = [`Semantic trace sessions: ${sessions.length}`];
  for (const session of sessions) {
    const eventCount = session.eventCount === undefined ? "unknown events" : `${session.eventCount} event${session.eventCount === 1 ? "" : "s"}`;
    const updatedAt = session.updatedAt ? ` updated=${session.updatedAt}` : "";
    const bytes = session.traceBytes === undefined ? "" : ` traceBytes=${session.traceBytes}`;
    const sidecar = session.sidecarPath ? ` sidecarBytes=${session.sidecarBytes ?? 0}` : "";
    lines.push(`${session.sessionId} harness=${session.harnessId} ${eventCount}${updatedAt}${bytes}${sidecar}`);
  }
  return `${lines.join("\n")}\n`;
}

function renderSemanticTraceCleanup(result: SemanticTraceCleanupResult): string {
  const verb = result.dryRun ? "Would delete" : "Deleted";
  const policy = result.before ? ` before=${result.before}` : "";
  const lines = [`${verb} ${result.files.length} semantic trace file${result.files.length === 1 ? "" : "s"} across ${result.sessions.length} session${result.sessions.length === 1 ? "" : "s"}${policy}`];
  for (const session of result.sessions) {
    lines.push(`session ${session.sessionId} harness=${session.harnessId} updated=${session.updatedAt ?? "unknown"}`);
  }
  for (const file of result.files) {
    lines.push(file);
  }
  return `${lines.join("\n")}\n`;
}

function renderSemanticTraceEvents(sessionId: string, events: readonly SemanticTraceEvent[]): string {
  if (events.length === 0) {
    return `Trace session ${sessionId}: no events\n`;
  }
  const lines = [`Trace session ${sessionId}: ${events.length} event${events.length === 1 ? "" : "s"}`];
  for (const event of events) {
    lines.push(renderSemanticTraceEvent(event));
  }
  return `${lines.join("\n")}\n`;
}

function renderSemanticTraceEvent(event: SemanticTraceEvent): string {
  const prefix = `#${event.sequence ?? "?"} ${event.kind}`;
  const payload = event.payload;
  switch (event.kind) {
    case "session.started":
      return `${prefix} harness=${event.harnessId}${formatPayloadField(payload, "command")}${formatPayloadField(payload, "cwd")}`;
    case "turn.started":
      return `${prefix}${formatPayloadField(payload, "turnId")}`;
    case "message":
      return `${prefix} ${event.actor.kind}:${event.actor.id}${formatPayloadField(payload, "turnId")} text=${formatTraceText(payload.text)}`;
    case "tool.call":
      return `${prefix} name=${formatTraceText(payload.name)}${formatPayloadField(payload, "toolCallId")}${formatPayloadField(payload, "inputDigest")}`;
    case "tool.result":
      return `${prefix} name=${formatTraceText(payload.name)}${formatPayloadField(payload, "toolCallId")}${formatPayloadField(payload, "status")}${formatPayloadField(payload, "outputDigest")}`;
    case "lifecycle":
      return `${prefix}${formatPayloadField(payload, "lifecycle")}${formatPayloadField(payload, "status")}`;
    case "harness.raw":
      return `${prefix} rawKind=${formatTraceText(payload.rawKind)}`;
    default:
      return `${prefix} actor=${event.actor.id}`;
  }
}

function formatPayloadField(payload: Record<string, unknown>, key: string): string {
  const value = payload[key];
  return value === undefined ? "" : ` ${key}=${formatTraceText(value)}`;
}

function formatTraceText(value: unknown): string {
  if (typeof value === "string") {
    return JSON.stringify(value.length > 240 ? `${value.slice(0, 237)}...` : value);
  }
  return JSON.stringify(value);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
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
