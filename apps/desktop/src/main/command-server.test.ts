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

describe("CommandServer preview routes", () => {
  it("opens a preview target over HTTP", async () => {
    const runtimeRoot = await mkdtemp(path.join(os.tmpdir(), "exo-command-server-"));
    tempPaths.push(runtimeRoot);
    let receivedTarget = "";
    const server = new CommandServer({
      ...commandServerOptions(runtimeRoot),
      onOpenPreview: async (target) => {
        receivedTarget = target;
        return { ok: true, url: target, source: "url" };
      },
    });

    try {
      const port = await server.start();
      const response = await fetch(`http://127.0.0.1:${port}/preview/open`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ target: "http://localhost:4321/report.html" }),
      });

      expect(response.ok).toBe(true);
      await expect(response.json()).resolves.toEqual({
        ok: true,
        url: "http://localhost:4321/report.html",
        source: "url",
      });
      expect(receivedTarget).toBe("http://localhost:4321/report.html");
    } finally {
      server.stop();
    }
  });

  it("focuses and closes preview panes over HTTP", async () => {
    const runtimeRoot = await mkdtemp(path.join(os.tmpdir(), "exo-command-server-"));
    tempPaths.push(runtimeRoot);
    let focused = false;
    let closed = false;
    const server = new CommandServer({
      ...commandServerOptions(runtimeRoot),
      onFocusPreview: () => {
        focused = true;
        return { ok: true };
      },
      onClosePreview: () => {
        closed = true;
        return { ok: true };
      },
    });

    try {
      const port = await server.start();
      const focusResponse = await fetch(`http://127.0.0.1:${port}/preview/focus`, { method: "POST" });
      const closeResponse = await fetch(`http://127.0.0.1:${port}/preview/close`, { method: "POST" });

      expect(focusResponse.ok).toBe(true);
      await expect(focusResponse.json()).resolves.toEqual({ ok: true });
      expect(closeResponse.ok).toBe(true);
      await expect(closeResponse.json()).resolves.toEqual({ ok: true });
      expect(focused).toBe(true);
      expect(closed).toBe(true);
    } finally {
      server.stop();
    }
  });
});

describe("CommandServer terminal routes", () => {
  it("passes terminal tail line limits from query params", async () => {
    const runtimeRoot = await mkdtemp(path.join(os.tmpdir(), "exo-command-server-"));
    tempPaths.push(runtimeRoot);
    let receivedOptions: { maxLines?: number } | undefined;
    const server = new CommandServer({
      ...commandServerOptions(runtimeRoot),
      onReadTerminalTail: (_id, options) => {
        receivedOptions = options;
        return "line-2\nline-3";
      },
    });

    try {
      const port = await server.start();
      const response = await fetch(`http://127.0.0.1:${port}/terminals/term-1/tail?lines=2`);

      expect(response.ok).toBe(true);
      await expect(response.json()).resolves.toEqual({ tail: "line-2\nline-3" });
      expect(receivedOptions).toEqual({ maxLines: 2 });
    } finally {
      server.stop();
    }
  });

  it("rejects registered but unavailable agent harnesses before creating terminals", async () => {
    const runtimeRoot = await mkdtemp(path.join(os.tmpdir(), "exo-command-server-"));
    tempPaths.push(runtimeRoot);
    const previousHermesCommand = process.env.EXO_HERMES_COMMAND;
    process.env.EXO_HERMES_COMMAND = "/definitely/missing/hermes";
    let created = false;
    const server = new CommandServer({
      ...commandServerOptions(runtimeRoot),
      onCreateTerminal: async () => {
        created = true;
        return {
          id: "terminal-1",
          kind: "hermes",
          title: "Hermes",
          cwd: runtimeRoot,
          command: "hermes",
          status: "running",
        };
      },
    });

    try {
      const port = await server.start();
      const response = await fetch(`http://127.0.0.1:${port}/terminals`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ kind: "hermes" }),
      });

      expect(response.status).toBe(400);
      await expect(response.json()).resolves.toMatchObject({
        error: expect.stringContaining("Agent harness is not launchable: hermes"),
      });
      expect(created).toBe(false);
    } finally {
      if (previousHermesCommand === undefined) {
        delete process.env.EXO_HERMES_COMMAND;
      } else {
        process.env.EXO_HERMES_COMMAND = previousHermesCommand;
      }
      server.stop();
    }
  });

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
          terminalKind: "agent",
          harnessId: "codex",
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
          terminalKind: "agent",
          harnessId: "codex",
          kind: "codex",
          title: "Codex",
          cwd: runtimeRoot,
          command: "codex",
          status: "running",
          health: "healthy",
          healthDetail: "Recent terminal input/output observed.",
          runtime: "tmux",
          tmuxSessionName: "exo-test-term-1",
          tmuxPaneId: "%1",
          safeAttachCommand: "tmux attach-session -t 'exo-test-term-1'",
          debugAttach: {
            tmuxSessionName: "exo-test-term-1",
            tmuxPaneId: "%1",
            safeAttachCommand: "tmux attach-session -t 'exo-test-term-1'",
          },
          bridgeStatus: "attached",
          paneStatus: "alive",
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
      expect(terminals[0]).toMatchObject({
        kind: "codex",
        terminalKind: "agent",
        harnessId: "codex",
      });
      expect(diagnostics[0]).not.toHaveProperty("transport");
      expect(diagnostics[0]).toMatchObject({
        kind: "codex",
        terminalKind: "agent",
        harnessId: "codex",
        runtime: "tmux",
        tmuxSessionName: "exo-test-term-1",
        tmuxPaneId: "%1",
        safeAttachCommand: "tmux attach-session -t 'exo-test-term-1'",
        debugAttach: {
          tmuxSessionName: "exo-test-term-1",
          tmuxPaneId: "%1",
          safeAttachCommand: "tmux attach-session -t 'exo-test-term-1'",
        },
        bridgeStatus: "attached",
        paneStatus: "alive",
      });
    } finally {
      server.stop();
    }
  });

  it("reconnects terminal bridges over HTTP", async () => {
    const runtimeRoot = await mkdtemp(path.join(os.tmpdir(), "exo-command-server-"));
    tempPaths.push(runtimeRoot);
    let receivedId = "";
    const server = new CommandServer({
      ...commandServerOptions(runtimeRoot),
      onReconnectTerminal: async (id) => {
        receivedId = id;
        return {
          id,
          kind: "shell",
          title: "Terminal",
          cwd: runtimeRoot,
          command: "zsh",
          status: "running",
        };
      },
    });

    try {
      const port = await server.start();
      const response = await fetch(`http://127.0.0.1:${port}/terminals/term-1/reconnect`, {
        method: "POST",
      });

      await expect(response.json()).resolves.toMatchObject({
        ok: true,
        terminal: { id: "term-1", status: "running" },
      });
      expect(receivedId).toBe("term-1");
    } finally {
      server.stop();
    }
  });

  it("reconnects recoverable terminal bridges over HTTP", async () => {
    const runtimeRoot = await mkdtemp(path.join(os.tmpdir(), "exo-command-server-"));
    tempPaths.push(runtimeRoot);
    let reconnected = false;
    const server = new CommandServer({
      ...commandServerOptions(runtimeRoot),
      onReconnectRecoverableTerminals: () => {
        reconnected = true;
      },
    });

    try {
      const port = await server.start();
      const response = await fetch(`http://127.0.0.1:${port}/terminals/reconnect-recoverable`, {
        method: "POST",
      });

      expect(response.ok).toBe(true);
      await expect(response.json()).resolves.toEqual({ ok: true });
      expect(reconnected).toBe(true);
    } finally {
      server.stop();
    }
  });

  it("resyncs a terminal over the reconnect recovery path", async () => {
    const runtimeRoot = await mkdtemp(path.join(os.tmpdir(), "exo-command-server-"));
    tempPaths.push(runtimeRoot);
    let receivedId = "";
    const server = new CommandServer({
      ...commandServerOptions(runtimeRoot),
      onReconnectTerminal: async (id) => {
        receivedId = id;
        return {
          id,
          kind: "shell",
          title: "Terminal",
          cwd: runtimeRoot,
          command: "zsh",
          status: "running",
        };
      },
    });

    try {
      const port = await server.start();
      const response = await fetch(`http://127.0.0.1:${port}/terminals/term-1/resync`, {
        method: "POST",
      });

      await expect(response.json()).resolves.toMatchObject({
        ok: true,
        terminal: { id: "term-1", status: "running" },
      });
      expect(receivedId).toBe("term-1");
    } finally {
      server.stop();
    }
  });

  it("creates, reads, lists, and decides proposals over HTTP", async () => {
    const runtimeRoot = await mkdtemp(path.join(os.tmpdir(), "exo-command-server-"));
    tempPaths.push(runtimeRoot);
    const proposals = new Map<string, any>();
    const server = new CommandServer({
      ...commandServerOptions(runtimeRoot),
      onCreateProposal: async (proposal) => {
        proposals.set(proposal.id, proposal);
        return proposal;
      },
      onListProposals: async () => [...proposals.values()],
      onReadProposal: async (id) => proposals.get(id) ?? null,
      onDecideProposal: async (id, input) => {
        const proposal = {
          ...proposals.get(id),
          status: input.decision === "accept" ? "accepted" : "rejected",
          items: proposals.get(id).items.map((item: any) => ({
            ...item,
            itemStatus: input.decision === "accept" ? "accepted" : "rejected",
          })),
        };
        proposals.set(id, proposal);
        return {
          proposal,
          appliedItems: input.decision === "accept"
            ? [{ id: "create-1", kind: "fileCreate", path: "notes/new.md", action: "created" }]
            : [],
        };
      },
    });
    const proposal = {
      id: "proposal-1",
      status: "pending",
      provenance: { activityId: "activity-1" },
      items: [{ id: "create-1", kind: "fileCreate", path: "notes/new.md", contents: "# New\n", itemStatus: "pending" }],
    };

    try {
      const port = await server.start();
      const createResponse = await fetch(`http://127.0.0.1:${port}/proposals`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ proposal }),
      });
      const listResponse = await fetchJson(`http://127.0.0.1:${port}/proposals`);
      const readResponse = await fetchJson(`http://127.0.0.1:${port}/proposals/proposal-1`);
      const decideResponse = await fetch(`http://127.0.0.1:${port}/proposals/proposal-1/decision`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ decision: "accept" }),
      });

      await expect(createResponse.json()).resolves.toMatchObject({ ok: true, proposal: { id: "proposal-1" } });
      expect(listResponse.proposals).toHaveLength(1);
      expect(readResponse.proposal.id).toBe("proposal-1");
      await expect(decideResponse.json()).resolves.toMatchObject({
        ok: true,
        proposal: { status: "accepted" },
        appliedItems: [{ id: "create-1", action: "created" }],
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
    onOpenPreview: async (target) => ({ ok: true, url: target, source: "url" }),
    onFocusPreview: () => ({ ok: true }),
    onClosePreview: () => ({ ok: true }),
    onCreateProposal: async (proposal) => proposal,
    onListProposals: async () => [],
    onReadProposal: async () => null,
    onDecideProposal: async () => {
      throw new Error("Unexpected proposal decision");
    },
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
      terminalKind: "shell",
      harnessId: null,
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
    onReconnectTerminal: async () => null,
    onReconnectRecoverableTerminals: () => {},
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
    colorThemeId: "exo-neutral",
    editorFontSize: 15,
    terminalFontSize: 13,
    terminalHistoryLines: 1_000_000,
    terminalTranscriptRetention: "forever",
    terminalTranscriptRetentionDays: 14,
    explorerScale: 1,
    exploreIndexSearchOnEnter: false,
    indexUpdateStrategy: "on-save",
  };
}
