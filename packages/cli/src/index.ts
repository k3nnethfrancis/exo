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
  type IndexSearchResponse,
} from "@exo/core";
import { EXO_CLI_USAGE } from "@exo/core/operator-help";
import { AppClient, formatAppClientDiscoveryFailure } from "./app-client";
import { runExoMcpServer } from "./mcp-server";
import { agentSearchResponse, boundedSearchLimit, parseSearchCursor } from "./search-response";

interface AppClientLike {
  getStatus(): Promise<Record<string, unknown>>;
  showWindow(): Promise<void>;
  search(query: string, options?: { limit?: number; offset?: number }): Promise<Record<string, unknown>>;
  getIndexStatus(): Promise<Record<string, unknown>>;
  syncIndex(): Promise<Record<string, unknown>>;
  openFile(filePath: string): Promise<void>;
  spawnAgentCommand(handle: string, task: string): Promise<Record<string, unknown>>;
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
    const limit = boundedSearchLimit(values.limit);
    const offset = parseSearchCursor(values.cursor, query);
    const model = await resolveCliWorkspaceModel(env);
    const response = client
      ? await client.search(query, { limit, offset })
      : await appOffSearch(env, query, { limit, offset });
    return print(agentSearchResponse(model, response as IndexSearchResponse, { limit, offset }), stdout);
  }
  if (!client) {
    client = await connectOrFail(env, stderr, connect);
    if (!client) return 1;
  }
  if (command === "show") { await client.showWindow(); return 0; }
  if (command === "index") return runIndex(client, subcommand, stdout);
  if (command === "open") {
    if (!subcommand) throw new Error("Usage: exo open <path>");
    await client.openFile(subcommand); return 0;
  }
  if (command === "invoke") {
    if (!subcommand?.startsWith("@") || args.length === 0) throw new Error("Usage: exo invoke @handle <task>");
    return print(client.spawnAgentCommand(subcommand, args.join(" ")), stdout);
  }
  throw new Error(help());
}

async function runIndex(client: AppClientLike, subcommand: string | undefined, stdout: { write(text: string): void }): Promise<number> {
  if (!subcommand || subcommand === "status") return print(client.getIndexStatus(), stdout);
  if (subcommand === "sync") return print(client.syncIndex(), stdout);
  throw new Error("Usage: exo index [status | sync]");
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

async function appOffSearch(env: NodeJS.ProcessEnv, query: string, options: { limit: number; offset: number }): Promise<IndexSearchResponse> {
  const { model, runtimeRoot } = await appOffContext(env);
  return filesystemSearchProvider.search(model, runtimeRoot, query, options);
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
async function print(value: Promise<unknown> | unknown, stdout: { write(text: string): void }): Promise<number> { stdout.write(`${JSON.stringify(await value, null, 2)}\n`); return 0; }
function help(): string {
  return [
    EXO_CLI_USAGE,
    "",
    "App-off: status and search use the configured workspace's filesystem roots.",
    "App-backed: show, index maintenance, open, and invoke require Exo to be running.",
    "Developer source QA: pnpm dev:qa",
    "",
  ].join("\n");
}

if (import.meta.url === `file://${process.argv[1]}`) {
  runCli(process.argv).then((code) => { process.exitCode = code; }).catch((error) => { console.error(error instanceof Error ? error.message : error); process.exitCode = 1; });
}
