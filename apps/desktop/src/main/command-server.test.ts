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
      expect(server.getPort()).toBe(port);
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

describe("CommandServer terminal routes", () => {
  it("preserves semantic terminal messages and submit=false over HTTP", async () => {
    const runtimeRoot = await mkdtemp(path.join(os.tmpdir(), "exo-command-server-"));
    tempPaths.push(runtimeRoot);
    let receivedId = "";
    let receivedMessage = "";
    let receivedSubmit = true;
    const server = new CommandServer({
      ...commandServerOptions(runtimeRoot),
      onSendTerminalMessage: async (id, message, submit) => {
        receivedId = id;
        receivedMessage = message;
        receivedSubmit = submit;
        return { ok: true, delivery: "sent" };
      },
    });

    try {
      const port = await server.start();
      const message = "Keep   exact spaces.\nAnd punctuation: !?()";
      const response = await fetch(`http://127.0.0.1:${port}/terminals/term-1/message`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message, submit: false }),
      });

      await expect(response.json()).resolves.toEqual({ ok: true, delivery: "sent" });
      expect(receivedId).toBe("term-1");
      expect(receivedMessage).toBe(message);
      expect(receivedSubmit).toBe(false);
    } finally {
      server.stop();
    }
  });

  it("exposes terminal sessions without transport fields and diagnostics with tmux runtime state", async () => {
    const runtimeRoot = await mkdtemp(path.join(os.tmpdir(), "exo-command-server-"));
    tempPaths.push(runtimeRoot);
    const server = new CommandServer({
      ...commandServerOptions(runtimeRoot),
      onListTerminals: () => [
        {
          id: "term-1",
          kind: "codex",
          title: "Codex",
          cwd: runtimeRoot,
          command: "codex",
          status: "running",
        },
      ],
      onTerminalDiagnostics: () => [
        {
          id: "term-1",
          kind: "codex",
          title: "Codex",
          cwd: runtimeRoot,
          command: "codex",
          status: "running",
          health: "healthy",
          healthDetail: "Recent terminal input/output observed.",
          runtime: "tmux",
          tmuxSessionName: "exo-test-term-1",
          bridgeStatus: "attached",
          bufferedLines: 1,
          bufferedChars: 12,
          transcriptPath: path.join(runtimeRoot, "terminal-transcripts", "term-1-codex.ansi.log"),
          lastInputAt: null,
          lastOutputAt: null,
          lastWriteId: 0,
          lastWriteLatencyMs: null,
        },
      ],
    });

    try {
      const port = await server.start();
      const terminals = await fetchJson(`http://127.0.0.1:${port}/terminals`);
      const diagnostics = await fetchJson(`http://127.0.0.1:${port}/terminals/diagnostics`);

      expect(terminals[0]).not.toHaveProperty("transport");
      expect(terminals[0]).not.toHaveProperty("tmuxSession");
      expect(diagnostics[0]).not.toHaveProperty("transport");
      expect(diagnostics[0]).toMatchObject({
        runtime: "tmux",
        tmuxSessionName: "exo-test-term-1",
        bridgeStatus: "attached",
      });
    } finally {
      server.stop();
    }
  });
});

async function fetchJson(url: string): Promise<any> {
  const response = await fetch(url);
  expect(response.ok).toBe(true);
  return response.json();
}

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
      status: "running",
    }),
    onReadTerminalTail: () => "",
    onReadTerminalTranscript: () => "",
    onWriteTerminal: async () => ({ ok: true, delivery: "sent" }),
    onSendTerminalMessage: async () => ({ ok: true, delivery: "sent" }),
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
    explorerScale: 1,
    exploreIndexSearchOnEnter: false,
    indexUpdateStrategy: "on-save",
  };
}
