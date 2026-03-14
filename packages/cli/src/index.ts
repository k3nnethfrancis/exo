#!/usr/bin/env node

import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
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
} from "@exo/core";

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

  if (command === "notes" && subcommand === "search") {
    const query = args.join(" ");
    const model = resolveWorkspaceModel(env);
    const results = await searchNotes(model, query);
    stdout.write(`${JSON.stringify(results, null, 2)}\n`);
    return 0;
  }

  if (command === "workspace" && subcommand === "search") {
    const query = args.join(" ");
    const model = resolveWorkspaceModel(env);
    const results = await searchWorkspace(model, query);
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

  stderr.write(
    [
      "Usage:",
      "  exo-cli launch <shell|claude|codex> [cwd]",
      "  exo-cli workspace status",
      "  exo-cli workspace fixture",
      "  exo-cli workspace search <query>",
      "  exo-cli notes search <query>",
      "  exo-cli notes read <path>",
      "  exo-cli notes branch-create <path>",
      "  exo-cli notes branch-view <path>",
      "  exo-cli runtime status",
      "  exo-cli runtime context <shell|claude|codex>",
      "  exo-cli runtime launch-plan <shell|claude|codex> [cwd]",
      "  exo-cli runtime sync",
    ].join("\n"),
  );
  return 1;
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
