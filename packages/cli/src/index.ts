#!/usr/bin/env node

import path from "node:path";

import { createBranchFile, getBranchFamily, readWorkspaceDocument, resolveWorkspaceModel, searchNotes, searchWorkspace } from "@exo/core";

async function main() {
  const [, , command, subcommand, ...args] = process.argv;

  if (command === "workspace" && subcommand === "status") {
    const model = resolveWorkspaceModel();
    process.stdout.write(`${JSON.stringify(model, null, 2)}\n`);
    return;
  }

  if (command === "workspace" && subcommand === "fixture") {
    const fixtureRoot = path.resolve(process.cwd(), "fixtures/workspace/lab");
    process.stdout.write(`${fixtureRoot}\n`);
    return;
  }

  if (command === "notes" && subcommand === "search") {
    const query = args.join(" ");
    const model = resolveWorkspaceModel();
    const results = await searchNotes(model, query);
    process.stdout.write(`${JSON.stringify(results, null, 2)}\n`);
    return;
  }

  if (command === "workspace" && subcommand === "search") {
    const query = args.join(" ");
    const model = resolveWorkspaceModel();
    const results = await searchWorkspace(model, query);
    process.stdout.write(`${JSON.stringify(results, null, 2)}\n`);
    return;
  }

  if (command === "notes" && subcommand === "read") {
    const targetPath = args[0];
    if (!targetPath) {
      throw new Error("Expected a note path.");
    }

    const document = await readWorkspaceDocument(targetPath);
    process.stdout.write(`${JSON.stringify(document, null, 2)}\n`);
    return;
  }

  if (command === "notes" && subcommand === "branch-create") {
    const targetPath = args[0];
    if (!targetPath) {
      throw new Error("Expected a markdown note path.");
    }

    const document = await readWorkspaceDocument(targetPath);
    const model = resolveWorkspaceModel();
    const result = await createBranchFile(targetPath, document, model.noteRoots.map((root) => root.path));
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    return;
  }

  if (command === "notes" && subcommand === "branch-view") {
    const targetPath = args[0];
    if (!targetPath) {
      throw new Error("Expected a markdown note path.");
    }

    const model = resolveWorkspaceModel();
    const family = await getBranchFamily(targetPath, model.noteRoots.map((root) => root.path));
    process.stdout.write(`${JSON.stringify(family, null, 2)}\n`);
    return;
  }

  process.stderr.write(
    [
      "Usage:",
      "  exo-cli workspace status",
      "  exo-cli workspace fixture",
      "  exo-cli workspace search <query>",
      "  exo-cli notes search <query>",
      "  exo-cli notes read <path>",
      "  exo-cli notes branch-create <path>",
      "  exo-cli notes branch-view <path>",
    ].join("\n"),
  );
  process.exitCode = 1;
}

main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});
