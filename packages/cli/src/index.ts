import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";

import {
  filesystemSearchProvider,
  loadActiveWorkspaceSettings,
  loadWorkspaceRegistry,
  listWorkspaceRegistryEntries,
  resolveWorkspaceModel,
  workspaceEnvOverrides,
  workspaceModelFromSettings,
  type WorkspaceModel,
  type IndexSearchResponse,
  type StemCommandIndexStatusResponse,
  type StemCommandIndexSyncResponse,
  type StemCommandSearchResponse,
  type StemCommandStatusWithControlPlane,
  type StemSpawnAgentCommandResponse,
  type WorkspaceRegistryEntry,
} from "@stem/core";
import { STEM_CLI_USAGE } from "@stem/core/operator-help";
import {
  AppClient,
  formatAppClientDiscoveryFailure,
  type AppClientDiscoveryFailure,
} from "./app-client";
import { runStemMcpServer } from "./mcp-server";
import {
  MAX_AGENT_SEARCH_LIMIT,
  agentSearchResponse,
  parseSearchCursor,
} from "./search-response";
import { workspaceMatches } from "./workspace-match";

interface AppClientLike {
  getStatus(): Promise<StemCommandStatusWithControlPlane>;
  showWindow(): Promise<void>;
  search(query: string, options?: { limit?: number; offset?: number }): Promise<StemCommandSearchResponse>;
  getIndexStatus(): Promise<StemCommandIndexStatusResponse>;
  syncIndex(): Promise<StemCommandIndexSyncResponse>;
  openFile(filePath: string): Promise<void>;
  spawnAgentCommand(handle: string, task: string): Promise<StemSpawnAgentCommandResponse>;
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

interface WorkspaceMismatchDiagnostic {
  code: "workspace-mismatch";
  message: string;
  selectedWorkspaceRoot: string;
  appWorkspaceRoot: string;
}

type CliRuntimeDiagnostic = AppClientDiscoveryFailure | WorkspaceMismatchDiagnostic;

interface CliConnection {
  client: AppClientLike | null;
  status?: StemCommandStatusWithControlPlane;
  diagnostic?: CliRuntimeDiagnostic;
}

const CLI_COMMANDS = new Set([
  "start",
  "show",
  "workspaces",
  "status",
  "search",
  "index",
  "open",
  "invoke",
  "mcp",
]);

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
    return startStemApp(env, stderr, launchApp);
  }

  if (command === "--help" || command === "-h" || command === "help") {
    stderr.write(help());
    return 0;
  }

  if (!CLI_COMMANDS.has(command)) {
    throw new Error(help());
  }

  if (subcommandHelpRequested([subcommand, ...args])) {
    stderr.write(commandHelp(command));
    return 0;
  }

  if (command === "start") {
    assertNoUnexpectedArguments([subcommand, ...args]);
    return startStemApp(env, stderr, launchApp);
  }

  if (command === "mcp" && subcommand === "serve") {
    assertNoUnexpectedArguments(args);
    await runStemMcpServer({ env, input: process.stdin, output: process.stdout, error: process.stderr });
    return 0;
  }

  if (command === "mcp") {
    throw new Error(commandHelp("mcp"));
  }

  if (command === "workspaces") {
    assertNoUnexpectedArguments([subcommand, ...args]);
    return print(listCliWorkspaces(env), stdout);
  }
  if (command === "status") {
    const { positionals, values } = parseOptions(
      [subcommand, ...args].filter((value): value is string => Boolean(value)),
      new Set(["workspace"]),
    );
    assertNoUnexpectedArguments(positionals);
    const workspace = await resolveCliWorkspace(env, values.workspace);
    if (values.workspace) return print(appOffStatus(workspace, env), stdout);
    const connection = await connectIfAvailable(env, connect, workspace);
    return print(
      connection.client
        ? connection.status
        : appOffStatus(workspace, env, connection.diagnostic),
      stdout,
    );
  }
  if (command === "search") {
    const { positionals, values } = parseOptions(
      [subcommand, ...args].filter((value): value is string => Boolean(value)),
      new Set(["limit", "cursor", "workspace"]),
    );
    const query = positionals.join(" ").trim();
    if (!query) throw new Error(commandHelp("search").trimEnd());
    const limit = parseSearchLimit(values.limit);
    const offset = parseSearchCursor(values.cursor, query);
    const workspace = await resolveCliWorkspace(env, values.workspace);
    const connection = values.workspace
      ? { client: null }
      : await connectIfAvailable(env, connect, workspace);
    const response = connection.client
      ? await connection.client.search(query, { limit, offset })
      : await appOffSearch(workspace, query, { limit, offset });
    const shaped = agentSearchResponse(workspace.model, response, { limit, offset });
    return print(
      connection.diagnostic ? { ...shaped, runtime: connection.diagnostic } : shaped,
      stdout,
    );
  }

  if (command === "show") {
    assertNoUnexpectedArguments([subcommand, ...args]);
  } else if (command === "index") {
    assertIndexArguments(subcommand, args);
  } else if (command === "open") {
    if (!subcommand || args.length > 0) throw new Error(commandHelp("open").trimEnd());
  } else if (command === "invoke") {
    if (!subcommand?.startsWith("@") || args.length === 0) throw new Error(commandHelp("invoke").trimEnd());
  } else {
    throw new Error(help());
  }

  const workspace = await resolveCliWorkspace(env);
  const connection = await connectIfAvailable(env, connect, workspace);
  const client = connection.client;
  if (!client) {
    if (connection.diagnostic) stderr.write(formatCliRuntimeDiagnostic(connection.diagnostic));
    else stderr.write(`Exograph is not reachable. Start it with: exo start\nRuntime root: ${await resolveCliRuntimeRoot(env)}\n`);
    return 1;
  }

  if (command === "show") { await client.showWindow(); return 0; }
  if (command === "index") return runIndex(client, subcommand, stdout);
  if (command === "open") {
    await client.openFile(subcommand); return 0;
  }
  if (command === "invoke") {
    return print(client.spawnAgentCommand(subcommand, args.join(" ")), stdout);
  }
  throw new Error("Unreachable CLI command.");
}

async function runIndex(client: AppClientLike, subcommand: string | undefined, stdout: { write(text: string): void }): Promise<number> {
  if (!subcommand || subcommand === "status") return print(client.getIndexStatus(), stdout);
  if (subcommand === "sync") return print(client.syncIndex(), stdout);
  throw new Error(commandHelp("index").trimEnd());
}

async function connectIfAvailable(
  env: NodeJS.ProcessEnv,
  connect: AppClientConnector,
  workspace: CliWorkspace,
): Promise<CliConnection> {
  const runtimeRoot = await resolveCliRuntimeRoot(env);
  let client: AppClientLike | null;
  let status: StemCommandStatusWithControlPlane | undefined;
  if (connect === defaultAppClientConnector) {
    const result = await AppClient.connectDetailed(runtimeRoot, env);
    if (!result.ok) return { client: null, diagnostic: result.failure };
    client = result.client;
    status = result.status;
  } else {
    client = await connect(runtimeRoot, env);
  }
  if (!client) return { client: null };
  status ??= await client.getStatus();
  if (!workspaceMatches(workspace.model, status.workspace)) {
    return {
      client: null,
      diagnostic: {
        code: "workspace-mismatch",
        message: `The running Stem app serves ${status.workspace.workspaceRoot}, not the selected Workspace ${workspace.model.workspaceRoot}. Filesystem retrieval was used for the selected Workspace; switch the app or pass --workspace explicitly.`,
        selectedWorkspaceRoot: workspace.model.workspaceRoot,
        appWorkspaceRoot: status.workspace.workspaceRoot,
      },
    };
  }
  return { client, status };
}

async function resolveCliWorkspaceModel(env: NodeJS.ProcessEnv): Promise<WorkspaceModel> {
  if (workspaceEnvOverrides(env)) {
    return resolveWorkspaceModel(env);
  }
  const settings = await loadActiveWorkspaceSettings(env);
  return settings ? workspaceModelFromSettings(settings) : resolveWorkspaceModel(env);
}

async function resolveCliRuntimeRoot(env: NodeJS.ProcessEnv, model?: WorkspaceModel): Promise<string> {
  if (env.EXO_RUNTIME_ROOT ?? env.STEM_RUNTIME_ROOT) {
    return env.EXO_RUNTIME_ROOT ?? env.STEM_RUNTIME_ROOT!;
  }
  return path.join((model ?? await resolveCliWorkspaceModel(env)).workspaceRoot, ".stem");
}

interface CliWorkspace {
  model: WorkspaceModel;
  id: string | null;
  label: string | null;
  active: boolean;
}

async function resolveCliWorkspace(env: NodeJS.ProcessEnv, selector?: string): Promise<CliWorkspace> {
  if (workspaceEnvOverrides(env)) {
    if (selector) {
      throw new Error("`--workspace` cannot be combined with STEM workspace environment overrides.");
    }
    return { model: resolveWorkspaceModel(env), id: null, label: null, active: true };
  }

  const registry = await loadWorkspaceRegistry(env);
  const entries = await listWorkspaceRegistryEntries(env);
  if (!selector) {
    const active = entries.find((entry) => entry.id === registry.activeWorkspaceId) ?? entries[0];
    if (active) return cliWorkspaceFromEntry(active, true);
    return { model: await resolveCliWorkspaceModel(env), id: null, label: null, active: true };
  }

  const normalizedSelector = selector.trim();
  const selectorPath = path.resolve(normalizedSelector);
  const matches = entries.filter((entry) =>
    entry.id === normalizedSelector
    || entry.label.toLocaleLowerCase() === normalizedSelector.toLocaleLowerCase()
    || path.resolve(entry.notesFolder) === selectorPath
    || path.resolve(entry.settings.workspaceRoot) === selectorPath,
  );
  if (matches.length === 0) {
    const available = entries.map((entry) => `${entry.label} (${entry.id})`).join(", ") || "none";
    throw new Error(`Unknown Stem Workspace: ${selector}. Available Workspaces: ${available}.`);
  }
  if (matches.length > 1) {
    throw new Error(`Workspace selector is ambiguous: ${selector}. Use the Workspace id from \`exo workspaces\`.`);
  }
  const entry = matches[0]!;
  return cliWorkspaceFromEntry(entry, entry.id === registry.activeWorkspaceId);
}

function cliWorkspaceFromEntry(entry: WorkspaceRegistryEntry, active: boolean): CliWorkspace {
  return {
    model: workspaceModelFromSettings(entry.settings),
    id: entry.id,
    label: entry.label,
    active,
  };
}

async function listCliWorkspaces(env: NodeJS.ProcessEnv): Promise<Record<string, unknown>> {
  if (workspaceEnvOverrides(env)) {
    const model = resolveWorkspaceModel(env);
    return {
      schema_version: "exograph.workspaces.v1",
      active_workspace_id: null,
      workspaces: [{
        id: null,
        label: path.basename(model.workspaceRoot),
        root: model.workspaceRoot,
        note_roots: model.noteRoots.map((root) => root.path),
        active: true,
        source: "environment",
      }],
    };
  }
  const registry = await loadWorkspaceRegistry(env);
  const entries = await listWorkspaceRegistryEntries(env);
  return {
    schema_version: "exograph.workspaces.v1",
    active_workspace_id: registry.activeWorkspaceId,
    workspaces: entries.map((entry) => ({
      id: entry.id,
      label: entry.label,
      root: entry.settings.workspaceRoot,
      note_roots: entry.settings.noteRoots,
      active: entry.id === registry.activeWorkspaceId,
    })),
  };
}

async function appOffStatus(
  workspace: CliWorkspace,
  env: NodeJS.ProcessEnv,
  diagnostic?: CliRuntimeDiagnostic,
): Promise<Record<string, unknown>> {
  const { model } = workspace;
  const runtimeRoot = await resolveCliRuntimeRoot(env, model);
  return {
    ok: true,
    app: {
      available: diagnostic?.code === "workspace-mismatch",
      usableForWorkspace: false,
      ...(diagnostic ? { diagnostic } : {}),
    },
    workspace: {
      id: workspace.id,
      label: workspace.label,
      active: workspace.active,
      root: model.workspaceRoot,
      noteRoots: model.noteRoots.map((root) => root.path),
    },
    search: await filesystemSearchProvider.getStatus(model, runtimeRoot),
  };
}

async function appOffSearch(workspace: CliWorkspace, query: string, options: { limit: number; offset: number }): Promise<IndexSearchResponse> {
  return filesystemSearchProvider.search(
    workspace.model,
    path.join(workspace.model.workspaceRoot, ".stem"),
    query,
    options,
  );
}

async function startStemApp(
  env: NodeJS.ProcessEnv,
  stderr: { write(text: string): void },
  launchApp: AppLauncher,
): Promise<number> {
  if (process.platform !== "darwin") {
    stderr.write("`exo start` launches the packaged macOS app. Use `pnpm dev:qa` for source QA.\n");
    return 1;
  }
  const candidates = [env.EXO_APP_PATH, env.STEM_APP_PATH, path.join(env.HOME ?? "", "Applications", "Exograph.app"), "/Applications/Exograph.app"]
    .filter((candidate): candidate is string => Boolean(candidate));
  const appPath = candidates.find((candidate) => existsSync(candidate));
  if (!appPath) {
    stderr.write("Unable to find Exograph.app. Install it with `scripts/install-mac-app --with-cli`, or set EXO_APP_PATH.\n");
    return 1;
  }
  try {
    await launchApp(appPath, env);
    return 0;
  } catch {
    stderr.write(`Unable to start Exograph at ${appPath}.\n`);
    return 1;
  }
}

function parseOptions(
  args: string[],
  allowedOptions: ReadonlySet<string>,
): { values: Record<string, string>; positionals: string[] } {
  const values: Record<string, string> = {};
  const positionals: string[] = [];
  let positionalOnly = false;
  for (let index = 0; index < args.length; index += 1) {
    const value = args[index];
    if (positionalOnly) {
      positionals.push(value);
      continue;
    }
    if (value === "--") {
      positionalOnly = true;
      continue;
    }
    if (!value.startsWith("-")) {
      positionals.push(value);
      continue;
    }
    if (!value.startsWith("--")) {
      throw new Error(`Unknown option: ${value}`);
    }
    const key = value.slice(2);
    if (!allowedOptions.has(key)) {
      throw new Error(`Unknown option: ${value}`);
    }
    if (Object.hasOwn(values, key)) {
      throw new Error(`Option may be provided only once: ${value}`);
    }
    const next = args[index + 1];
    if (!next || next.startsWith("--")) {
      throw new Error(`Missing value for ${value}`);
    }
    values[key] = next;
    index += 1;
  }
  return { values, positionals };
}

function parseSearchLimit(value: string | undefined): number {
  if (value === undefined) return 10;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > MAX_AGENT_SEARCH_LIMIT) {
    throw new Error(`Expected --limit to be an integer from 1 to ${MAX_AGENT_SEARCH_LIMIT}.`);
  }
  return parsed;
}

function subcommandHelpRequested(args: Array<string | undefined>): boolean {
  for (const value of args) {
    if (value === "--") return false;
    if (value === "--help" || value === "-h") return true;
  }
  return false;
}

function assertNoUnexpectedArguments(args: Array<string | undefined>): void {
  const unexpected = args.find((value): value is string => Boolean(value));
  if (unexpected) throw new Error(`Unexpected argument: ${unexpected}`);
}

function assertIndexArguments(subcommand: string | undefined, args: string[]): void {
  assertNoUnexpectedArguments(args);
  if (subcommand && subcommand !== "status" && subcommand !== "sync") {
    throw new Error(commandHelp("index").trimEnd());
  }
}

function formatCliRuntimeDiagnostic(diagnostic: CliRuntimeDiagnostic): string {
  if (diagnostic.code !== "workspace-mismatch") {
    return formatAppClientDiscoveryFailure(diagnostic);
  }
  return `${diagnostic.message}\n`;
}

async function print(value: Promise<unknown> | unknown, stdout: { write(text: string): void }): Promise<number> { stdout.write(`${JSON.stringify(await value, null, 2)}\n`); return 0; }
function commandHelp(command: string): string {
  const usage = {
    start: "exo start",
    show: "exo show",
    workspaces: "exo workspaces",
    status: "exo status [--workspace <id|label|path>]",
    search: "exo search <query> [--limit n] [--cursor cursor] [--workspace <id|label|path>]",
    index: "exo index [status|sync]",
    open: "exo open <path>",
    invoke: "exo invoke @handle <task>",
    mcp: "exo mcp serve",
  }[command];
  return usage ? `Usage: ${usage}\n` : help();
}

function help(): string {
  return [
    STEM_CLI_USAGE,
    "",
    "Workspace selection: exo workspaces; status/search accept --workspace <id|label|path>.",
    "App-off: status and search use the configured workspace's filesystem roots.",
    "App-backed: show, index maintenance, open, and invoke require Exograph to be running.",
    "Developer source QA: pnpm dev:qa",
    "",
  ].join("\n");
}

if (import.meta.url === `file://${process.argv[1]}`) {
  runCli(process.argv).then((code) => { process.exitCode = code; }).catch((error) => { console.error(error instanceof Error ? error.message : error); process.exitCode = 1; });
}
