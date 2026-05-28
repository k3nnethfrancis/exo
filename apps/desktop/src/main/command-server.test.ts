import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { CommandServer, type CommandServerOptions } from "./command-server";

const tempPaths: string[] = [];

afterEach(async () => {
  await Promise.all(tempPaths.splice(0).map((target) => rm(target, { recursive: true, force: true })));
});

describe("CommandServer discovery", () => {
  it("rewrites server.json when discovery is missing while the server is still live", async () => {
    const runtimeRoot = await mkdtemp(path.join(os.tmpdir(), "exo-command-server-"));
    tempPaths.push(runtimeRoot);
    const server = new CommandServer(commandServerOptions(runtimeRoot));

    try {
      const port = await server.start();
      await rm(path.join(runtimeRoot, "server.json"), { force: true });

      await expect(server.ensureDiscoveryFile()).resolves.toMatchObject({
        port,
        pid: process.pid,
        path: path.join(runtimeRoot, "server.json"),
      });
      await expect(readServerInfo(runtimeRoot)).resolves.toMatchObject({ port, pid: process.pid });

      const response = await fetch(`http://127.0.0.1:${port}/status`);
      await expect(response.json()).resolves.toEqual({ ok: true });
    } finally {
      server.stop();
    }
  });
});

async function readServerInfo(runtimeRoot: string): Promise<{ port: number; pid: number }> {
  return JSON.parse(await readFile(path.join(runtimeRoot, "server.json"), "utf8")) as { port: number; pid: number };
}

function commandServerOptions(runtimeRoot: string): CommandServerOptions {
  return {
    runtimeRoot,
    onShowWindow: () => {},
    onOpenFile: () => {},
    onSearch: async () => ({ notes: [], projectFiles: [], tags: [] }),
    onIndexSearch: async () => ({ mode: "lexical", source: "filesystem", query: "", results: [], warnings: [] }),
    onReadDocument: async () => ({ target: "", filePath: "", title: "", body: "", source: "filesystem" }),
    onIndexStatus: async () => indexStatus(),
    onIndexAddRoot: async () => workspaceSettings(),
    onIndexRemoveRoot: async () => workspaceSettings(),
    onIndexSync: async () => ({
      status: indexStatus(),
      phases: [],
      warnings: [],
    }),
    onIndexUpdate: async () => indexStatus(),
    onIndexEmbed: async () => indexStatus(),
    onListProjectRoots: () => [],
    onAddProjectRoot: async () => workspaceSettings(),
    onRemoveProjectRoot: async () => workspaceSettings(),
    onListTerminals: () => [],
    onTerminalDiagnostics: () => [],
    onCreateTerminal: async () => ({
      id: "terminal-1",
      kind: "shell",
      title: "Terminal",
      cwd: runtimeRoot,
      command: "zsh",
      transport: "direct",
      status: "running",
    }),
    onReadTerminal: () => "",
    onReadTerminalTranscript: () => "",
    onWriteTerminal: async () => ({ ok: true, delivery: "sent" }),
    onKillTerminal: async () => {},
    onGetSettings: () => workspaceSettings(),
    onGetStatus: () => ({ ok: true }),
  };
}

function indexStatus(): Awaited<ReturnType<CommandServerOptions["onIndexStatus"]>> {
  return {
    enabled: false,
    mode: "off",
    backend: "qmd",
    dbPath: "",
    runtimePath: "",
    indexedRoots: [],
    documentCount: 0,
    pendingEmbeddings: 0,
    hasVectorIndex: false,
    lastUpdated: null,
    warnings: [],
    errors: [],
  };
}

function workspaceSettings(): CommandServerOptions["onGetSettings"] extends () => infer Settings ? Settings : never {
  return {
    workspaceRoot: "/tmp/exo-test-workspace",
    defaultTerminalCwd: "/tmp/exo-test-workspace",
    noteRoots: ["/tmp/exo-test-workspace/notes"],
    projectRoots: [],
    indexedRoots: [],
    indexing: { enabled: false, mode: "off", backend: "qmd" },
    appearanceMode: "system",
    editorFontSize: 15,
    terminalFontSize: 13,
    terminalHistoryMode: "full",
    terminalHistoryLines: 1_000_000,
    terminalTranscriptRetention: "forever",
    terminalTranscriptRetentionDays: 14,
    terminalStreamingMode: "visible",
    terminalAgentTransport: "direct",
    explorerScale: 1,
    exploreIndexSearchOnEnter: false,
    indexUpdateStrategy: "on-save",
  };
}
