import path from "node:path";

import { AppClient, formatAppClientDiscoveryFailure } from "./app-client";

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

export async function runCli(argv: string[], options: {
  env?: NodeJS.ProcessEnv;
  stdout?: { write(text: string): void };
  stderr?: { write(text: string): void };
  connectAppClient?: AppClientConnector;
} = {}): Promise<number> {
  const env = options.env ?? process.env;
  const stdout = options.stdout ?? process.stdout;
  const stderr = options.stderr ?? process.stderr;
  const connect = options.connectAppClient ?? defaultAppClientConnector;
  const [command, subcommand, ...args] = argv.slice(2);

  if (!command || command === "--help" || command === "-h" || command === "help") {
    stderr.write(help());
    return command ? 0 : 1;
  }

  const client = await connectOrFail(env, stderr, connect);
  if (!client) return 1;

  if (command === "status") return print(client.getStatus(), stdout);
  if (command === "show") { await client.showWindow(); return 0; }
  if (command === "search") {
    if (!subcommand) throw new Error("Usage: exo search <query> [--limit n]");
    const { positionals, values } = parseOptions([subcommand, ...args]);
    return print(client.search(positionals.join(" "), { limit: positive(values.limit) }), stdout);
  }
  if (command === "read") {
    if (!subcommand) throw new Error("Usage: exo read <path-or-docid> [--from n] [--lines n]");
    const { values } = parseOptions(args);
    return print(client.readDocument(subcommand, { fromLine: positive(values.from), maxLines: positive(values.lines) }), stdout);
  }
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
  const runtimeRoot = env.EXO_RUNTIME_ROOT ?? path.join(env.EXO_WORKSPACE_ROOT ?? process.cwd(), ".exo");
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
function help(): string { return "Usage: exo status | show | search | read | index | open | preview | config get | spawn | terminals\n"; }

if (import.meta.url === `file://${process.argv[1]}`) {
  runCli(process.argv).then((code) => { process.exitCode = code; }).catch((error) => { console.error(error instanceof Error ? error.message : error); process.exitCode = 1; });
}
