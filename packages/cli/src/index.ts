import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";

import {
  filesystemSearchProvider,
  loadActiveWorkspaceSettings,
  resolveWorkspaceModel,
  workspaceEnvOverrides,
  workspaceModelFromSettings,
  type WorkspaceModel,
} from "@exo/core";
import { AppClient, formatAppClientDiscoveryFailure } from "./app-client";
import { runExoMcpServer } from "./mcp-server";

interface AppClientLike {
  getStatus(): Promise<Record<string, unknown>>;
  showWindow(): Promise<void>;
  search(query: string, options?: { limit?: number }): Promise<Record<string, unknown>>;
  readDocument(target: string, options?: { fromLine?: number; maxLines?: number }): Promise<Record<string, unknown>>;
  getIndexStatus(): Promise<Record<string, unknown>>;
  syncIndex(): Promise<Record<string, unknown>>;
  addIndexRoot(input: { path: string; name?: string; kind?: string; pattern?: string; force?: boolean }): Promise<Record<string, unknown>>;
  removeIndexRoot(target: string): Promise<Record<string, unknown>>;
  openFile(filePath: string): Promise<void>;
  openPreview(target: string): Promise<Record<string, unknown>>;
  focusPreview(): Promise<Record<string, unknown>>;
  closePreview(): Promise<Record<string, unknown>>;
  getConfig(): Promise<Record<string, unknown>>;
  spawnAgentCommand(handle: string, task: string): Promise<Record<string, unknown>>;
  listTerminals(): Promise<unknown[]>;
  createTerminal(cwd?: string): Promise<Record<string, unknown>>;
  readTerminal(id: string, options?: { maxLines?: number }): Promise<string>;
  writeTerminal(id: string, data: string): Promise<unknown>;
  sendTerminalMessage(id: string, message: string, submit?: boolean): Promise<unknown>;
  killTerminal(id: string): Promise<void>;
}

type AppClientConnector = (runtimeRoot: string, env: NodeJS.ProcessEnv) => Promise<AppClientLike | null>;
const defaultAppClientConnector: AppClientConnector = (runtimeRoot, env) => AppClient.connect(runtimeRoot, env);
type AppLauncher = (appPath: string, env: NodeJS.ProcessEnv) => Promise<void>;
const defaultAppLauncher: AppLauncher = (appPath, env) =>
  new Promise((resolve, reject) => {
    const child = spawn("open", [appPath], {
      env: { ...process.env, ...env },
      stdio: "ignore",
      detached: true,
    });
    child.unref();
    child.once("error", reject);
    child.once("exit", (code) => code ? reject(new Error(`open exited with ${code}`)) : resolve());
  });

export async function runCli(argv: string[], options: {
  env?: NodeJS.ProcessEnv;
  stdout?: { write(text: string): void };
  stderr?: { write(text: string): void };
  connectAppClient?: AppClientConnector;
  launchApp?: AppLauncher;
} = {}): Promise<number> {
  const env = options.env ?? process.env;
  const stdout = options.stdout ?? process.stdout;
  const stderr = options.stderr ?? process.stderr;
  const connect = options.connectAppClient ?? defaultAppClientConnector;
  const launchApp = options.launchApp ?? defaultAppLauncher;
  const [command, subcommand, ...args] = argv.slice(2);

  if (!command) {
    return startExoApp(env, stderr, launchApp);
  }

  if (command === "start") {
    return startExoApp(env, stderr, launchApp);
  }

  if (command === "mcp" && subcommand === "serve") {
    await runExoMcpServer({ env, input: process.stdin, output: process.stdout, error: process.stderr });
    return 0;
  }

  if (command === "--help" || command === "-h" || command === "help") {
    stderr.write(help());
    return 0;
  }

  let client = await connectIfAvailable(env, connect);
  if (command === "status") return print(client ? client.getStatus() : appOffStatus(env), stdout);
  if (command === "search") {
    if (!subcommand) throw new Error("Usage: exo search <query> [--limit n]");
    const { positionals, values } = parseOptions([subcommand, ...args]);
    const query = positionals.join(" ");
    return print(client ? client.search(query, { limit: positive(values.limit) }) : appOffSearch(env, query, positive(values.limit)), stdout);
  }
  if (command === "read") {
    if (!subcommand) throw new Error("Usage: exo read <path-or-docid> [--from n] [--lines n]");
    const { values } = parseOptions(args);
    const options = { fromLine: positive(values.from), maxLines: positive(values.lines) };
    return print(client ? client.readDocument(subcommand, options) : appOffRead(env, subcommand, options), stdout);
  }
  if (!client) {
    client = await connectOrFail(env, stderr, connect);
    if (!client) return 1;
  }
  if (command === "show") { await client.showWindow(); return 0; }
  if (command === "index") return runIndex(client, subcommand, args, stdout);
  if (command === "open") {
    if (!subcommand) throw new Error("Usage: exo open <path>");
    await client.openFile(subcommand); return 0;
  }
  if (command === "preview") return runPreview(client, subcommand, args, stdout);
  if (command === "config" && subcommand === "get") return print(client.getConfig(), stdout);
  if (command === "spawn") {
    if (!subcommand?.startsWith("@") || args.length === 0) throw new Error("Usage: exo spawn @handle <task>");
    return print(client.spawnAgentCommand(subcommand, args.join(" ")), stdout);
  }
  if (command === "terminals") return runTerminals(client, subcommand, args, stdout);
  throw new Error(help());
}

async function runIndex(client: AppClientLike, subcommand: string | undefined, args: string[], stdout: { write(text: string): void }): Promise<number> {
  if (!subcommand || subcommand === "status") return print(client.getIndexStatus(), stdout);
  if (subcommand === "sync") return print(client.syncIndex(), stdout);
  if (subcommand === "add") {
    const [target, ...rest] = args;
    if (!target) throw new Error("Usage: exo index add <path> [--name n] [--kind k] [--force]");
    const { values } = parseOptions(rest);
    return print(client.addIndexRoot({ path: target, name: values.name, kind: values.kind, pattern: values.pattern, force: values.force === "true" }), stdout);
  }
  if (subcommand === "remove") {
    if (!args[0]) throw new Error("Usage: exo index remove <name-or-path>");
    return print(client.removeIndexRoot(args[0]), stdout);
  }
  throw new Error("Usage: exo index [status | sync | add <path> | remove <name-or-path>]");
}

async function runPreview(client: AppClientLike, subcommand: string | undefined, args: string[], stdout: { write(text: string): void }): Promise<number> {
  if (subcommand === "open" && args[0]) return print(client.openPreview(args[0]), stdout);
  if (subcommand === "focus") return print(client.focusPreview(), stdout);
  if (subcommand === "close") return print(client.closePreview(), stdout);
  throw new Error("Usage: exo preview [open <url-or-html-path> | focus | close]");
}

async function runTerminals(client: AppClientLike, subcommand: string | undefined, args: string[], stdout: { write(text: string): void }): Promise<number> {
  if (!subcommand || subcommand === "list") return print(client.listTerminals(), stdout);
  if (subcommand === "create") return print(client.createTerminal(args[0]), stdout);
  if (subcommand === "read") {
    if (!args[0]) throw new Error("Usage: exo terminals read <id> [--lines n]");
    const { values } = parseOptions(args.slice(1));
    stdout.write(await client.readTerminal(args[0], { maxLines: positive(values.lines) }));
    return 0;
  }
  if (subcommand === "write" || subcommand === "send") {
    if (!args[0] || args.length < 2) throw new Error(`Usage: exo terminals ${subcommand} <id> <text>`);
    return print(subcommand === "write" ? client.writeTerminal(args[0], args.slice(1).join(" ")) : client.sendTerminalMessage(args[0], args.slice(1).join(" ")), stdout);
  }
  if (subcommand === "kill") {
    if (!args[0]) throw new Error("Usage: exo terminals kill <id>");
    await client.killTerminal(args[0]); return 0;
  }
  throw new Error("Usage: exo terminals [list | create [cwd] | read <id> [--lines n] | write <id> <text> | send <id> <text> | kill <id>]");
}

async function connectOrFail(env: NodeJS.ProcessEnv, stderr: { write(text: string): void }, connect: AppClientConnector): Promise<AppClientLike | null> {
  const runtimeRoot = await resolveCliRuntimeRoot(env);
  if (connect === defaultAppClientConnector) {
    const result = await AppClient.connectDetailed(runtimeRoot, env);
    if (result.ok) return result.client;
    stderr.write(formatAppClientDiscoveryFailure(result.failure));
    return null;
  }
  const client = await connect(runtimeRoot, env);
  if (!client) stderr.write(`Exo app is not reachable. Start it with: exo start\nRuntime root: ${runtimeRoot}\n`);
  return client;
}

async function connectIfAvailable(env: NodeJS.ProcessEnv, connect: AppClientConnector): Promise<AppClientLike | null> {
  const runtimeRoot = await resolveCliRuntimeRoot(env);
  if (connect === defaultAppClientConnector) {
    const result = await AppClient.connectDetailed(runtimeRoot, env);
    return result.ok ? result.client : null;
  }
  return connect(runtimeRoot, env);
}

async function appOffContext(env: NodeJS.ProcessEnv): Promise<{ model: WorkspaceModel; runtimeRoot: string }> {
  const model = await resolveCliWorkspaceModel(env);
  return { model, runtimeRoot: await resolveCliRuntimeRoot(env, model) };
}

async function resolveCliWorkspaceModel(env: NodeJS.ProcessEnv): Promise<WorkspaceModel> {
  if (workspaceEnvOverrides(env)) {
    return resolveWorkspaceModel(env);
  }
  const settings = await loadActiveWorkspaceSettings(env);
  return settings ? workspaceModelFromSettings(settings) : resolveWorkspaceModel(env);
}

async function resolveCliRuntimeRoot(env: NodeJS.ProcessEnv, model?: WorkspaceModel): Promise<string> {
  if (env.EXO_RUNTIME_ROOT) {
    return env.EXO_RUNTIME_ROOT;
  }
  return path.join((model ?? await resolveCliWorkspaceModel(env)).workspaceRoot, ".exo");
}

async function appOffStatus(env: NodeJS.ProcessEnv): Promise<Record<string, unknown>> {
  const { model, runtimeRoot } = await appOffContext(env);
  return {
    ok: true,
    app: { available: false },
    workspace: {
      root: model.workspaceRoot,
      noteRoots: model.noteRoots.map((root) => root.path),
    },
    search: await filesystemSearchProvider.getStatus(model, runtimeRoot),
  };
}

async function appOffSearch(env: NodeJS.ProcessEnv, query: string, limit?: number): Promise<Record<string, unknown>> {
  const { model, runtimeRoot } = await appOffContext(env);
  return { ...await filesystemSearchProvider.search(model, runtimeRoot, query, { limit }) };
}

async function appOffRead(
  env: NodeJS.ProcessEnv,
  target: string,
  options: { fromLine?: number; maxLines?: number },
): Promise<Record<string, unknown>> {
  const { model, runtimeRoot } = await appOffContext(env);
  return { ...await filesystemSearchProvider.read(model, runtimeRoot, target, options) };
}

async function startExoApp(
  env: NodeJS.ProcessEnv,
  stderr: { write(text: string): void },
  launchApp: AppLauncher,
): Promise<number> {
  if (process.platform !== "darwin") {
    stderr.write("`exo start` launches the packaged macOS app. Use `pnpm dev:qa` for source QA.\n");
    return 1;
  }
  const candidates = [env.EXO_APP_PATH, path.join(env.HOME ?? "", "Applications", "Exo.app"), "/Applications/Exo.app"]
    .filter((candidate): candidate is string => Boolean(candidate));
  const appPath = candidates.find((candidate) => existsSync(candidate));
  if (!appPath) {
    stderr.write("Unable to find Exo.app. Install it with `scripts/install-mac-app --with-cli`, or set EXO_APP_PATH.\n");
    return 1;
  }
  try {
    await launchApp(appPath, env);
    return 0;
  } catch {
    stderr.write(`Unable to start Exo app at ${appPath}.\n`);
    return 1;
  }
}

function parseOptions(args: string[]): { values: Record<string, string>; positionals: string[] } {
  const values: Record<string, string> = {}; const positionals: string[] = [];
  for (let index = 0; index < args.length; index += 1) {
    const value = args[index];
    if (!value.startsWith("--")) { positionals.push(value); continue; }
    const key = value.slice(2); const next = args[index + 1];
    if (!next || next.startsWith("--")) { values[key] = "true"; continue; }
    values[key] = next; index += 1;
  }
  return { values, positionals };
}
function positive(value: string | undefined): number | undefined { const parsed = Number(value); return Number.isInteger(parsed) && parsed > 0 ? parsed : undefined; }
async function print(value: Promise<unknown> | unknown, stdout: { write(text: string): void }): Promise<number> { stdout.write(`${JSON.stringify(await value, null, 2)}\n`); return 0; }
function help(): string {
  return [
    "Usage: exo [start] | status | show | search | read | index | open | preview | config get | spawn | terminals | mcp serve",
    "",
    "App-off: status, search, and read use the configured workspace's filesystem roots.",
    "App-backed: show, index changes, open, preview, spawn, and terminals require Exo to be running.",
    "Developer source QA: pnpm dev:qa",
    "",
  ].join("\n");
}

if (import.meta.url === `file://${process.argv[1]}`) {
  runCli(process.argv).then((code) => { process.exitCode = code; }).catch((error) => { console.error(error instanceof Error ? error.message : error); process.exitCode = 1; });
}
