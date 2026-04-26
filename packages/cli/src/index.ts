#!/usr/bin/env node

import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  buildQmdConfig,
  createBranchFile,
  getBranchFamily,
  readWorkspaceDocument,
  renderClaudeOverlay,
  renderPrimaryAgentInstructions,
  resolveAgentLaunchPlan,
  resolveRuntimeConfig,
  resolveWorkspaceModel,
  searchNotes,
  searchQmd,
  searchWorkspace,
  syncRuntimeContextFiles,
  type ManagedAgentKind,
} from "@exo/core";

import { AppClient } from "./app-client";

export async function runCli(
  argv: string[],
  options: {
    env?: NodeJS.ProcessEnv;
    stdin?: NodeJS.ReadStream;
    stdout?: { write: (text: string) => void };
    stderr?: { write: (text: string) => void };
    cwd?: string;
  } = {},
): Promise<number> {
  const env = options.env ?? process.env;
  const stdin = options.stdin ?? process.stdin;
  const stdout = options.stdout ?? process.stdout;
  const stderr = options.stderr ?? process.stderr;
  const cwd = options.cwd ?? process.cwd();

  const [, , command, subcommand, ...args] = argv;

  // ─── Search ──────────────────────────────────────────────────────────
  // Standalone: uses core + QMD directly (no running app needed)

  if (command === "search") {
    const isDeep = subcommand === "--deep";
    const query = isDeep ? args.join(" ") : [subcommand, ...args].filter(Boolean).join(" ");
    if (!query) {
      throw new Error("Expected a search query.");
    }

    const config = resolveRuntimeConfig(env);
    const model = config.workspace;
    const qmdConfig = buildQmdConfig(config.retrieval, model.noteRoots.map((r) => r.path));

    const fast = await searchWorkspace(model, query);
    let semantic: unknown[] = [];
    if (qmdConfig) {
      const { searchQmd: search, queryQmd: query_ } = await import("@exo/core");
      semantic = isDeep ? await query_(query, qmdConfig) : await search(query, qmdConfig);
    }

    stdout.write(`${JSON.stringify({ ...fast, semantic }, null, 2)}\n`);
    return 0;
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

    stderr.write("Usage: exo terminals [list | create <shell|claude|codex> [cwd]]\n");
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
      "  exo search <query>                         Search workspace + semantic",
      "  exo search --deep <query>                  Deep hybrid search (slower)",
      "  exo open <path>                            Open file in editor (app)",
      "  exo status                                 Workspace status (app)",
      "  exo config get [key]                       Read settings (app)",
      "  exo terminals [list]                       List terminals (app)",
      "  exo terminals create <shell|claude|codex>  Create terminal (app)",
      "  exo launch <shell|claude|codex> [cwd]",
      "  exo workspace status",
      "  exo workspace search <query>",
      "  exo notes search <query>",
      "  exo notes read <path>",
      "  exo notes branch-create <path>",
      "  exo notes branch-view <path>",
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
