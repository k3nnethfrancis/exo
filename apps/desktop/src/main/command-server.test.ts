import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, beforeAll, describe, expect, it } from "vitest";
import {
  EXO_COMMAND_TOKEN_HEADER,
  SemanticTraceStore,
  agentHarnessRegistry,
  captureFakeHarnessTraceFixture,
  semanticTraceEventsToAgentAnswerText,
  type AgentHarness,
} from "@exo/core";

import { CommandServer, type CommandServerOptions } from "./command-server";
import { AgentCommandInvocationError } from "./agent-command-invocation-service";

const tempPaths: string[] = [];
const COMMAND_SERVER_ONLY_HARNESS_ID = "test.command-server-only";

beforeAll(() => {
  if (agentHarnessRegistry.get(COMMAND_SERVER_ONLY_HARNESS_ID)) {
    return;
  }
  const harness: AgentHarness = {
    contractVersion: "agent-harness.v1",
    metadata: {
      id: COMMAND_SERVER_ONLY_HARNESS_ID,
      kind: "core:agentHarness",
      label: "Command Server Only",
      description: "Test harness exposed only to command-server launch policy.",
      lifecycle: "built-in",
      owner: "@exo/test",
      surfaces: ["commandServer"],
      permissions: ["agents:launch"],
    },
    kind: "shell",
    title: "Command Server Only",
    skills: [],
    terminalOwnership: "core",
    resolveLauncher: () => ({
      kind: "shell",
      title: "Command Server Only",
      command: "/bin/sh",
      args: [],
    }),
  };
  agentHarnessRegistry.register(harness);
});

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

      const response = await commandFetch(runtimeRoot, port, "/status");
      await expect(response.json()).resolves.toEqual({ ok: true });
    } finally {
      server.stop();
    }
  });

  it("rejects every route without the runtime token", async () => {
    const runtimeRoot = await mkdtemp(path.join(os.tmpdir(), "exo-command-server-"));
    tempPaths.push(runtimeRoot);
    const server = new CommandServer(commandServerOptions(runtimeRoot));

    try {
      const port = await server.start();
      const response = await fetch(`http://127.0.0.1:${port}/status`);

      expect(response.status).toBe(401);
      await expect(response.json()).resolves.toMatchObject({ error: "Missing or invalid Exo command token." });
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
      const response = await commandFetch(runtimeRoot, port, "/preview/open", {
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
      const focusResponse = await commandFetch(runtimeRoot, port, "/preview/focus", { method: "POST" });
      const closeResponse = await commandFetch(runtimeRoot, port, "/preview/close", { method: "POST" });

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
  it("spawns configured AgentCommands through the command server", async () => {
    const runtimeRoot = await mkdtemp(path.join(os.tmpdir(), "exo-command-server-"));
    tempPaths.push(runtimeRoot);
    let received: { handle: string; task: string } | null = null;
    const server = new CommandServer({
      ...commandServerOptions(runtimeRoot),
      onSpawnAgentCommand: async (input) => {
        received = input;
        return commandServerOptions(runtimeRoot).onSpawnAgentCommand(input);
      },
    });

    try {
      const port = await server.start();
      const response = await commandFetch(runtimeRoot, port, "/agent-commands/spawn", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ handle: "@fable", task: "review this plan" }),
      });

      expect(response.ok).toBe(true);
      await expect(response.json()).resolves.toMatchObject({
        ok: true,
        invocation: { id: "invocation-1", context: "cli", message: "review this plan" },
        terminal: { id: "terminal-1" },
      });
      expect(received).toEqual({ handle: "@fable", task: "review this plan" });
    } finally {
      server.stop();
    }
  });

  it("returns structured errors for untrusted AgentCommand spawn", async () => {
    const runtimeRoot = await mkdtemp(path.join(os.tmpdir(), "exo-command-server-"));
    tempPaths.push(runtimeRoot);
    const server = new CommandServer({
      ...commandServerOptions(runtimeRoot),
      onSpawnAgentCommand: async () => {
        throw new AgentCommandInvocationError(
          "agent-command-untrusted",
          "AgentCommand @fable must be trusted in Exo before it can launch.",
          { handle: "fable", executableFingerprint: "1".repeat(64) },
        );
      },
    });

    try {
      const port = await server.start();
      const response = await commandFetch(runtimeRoot, port, "/agent-commands/spawn", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ handle: "@fable", task: "review this plan" }),
      });

      expect(response.status).toBe(403);
      await expect(response.json()).resolves.toMatchObject({
        ok: false,
        code: "agent-command-untrusted",
        handle: "fable",
      });
    } finally {
      server.stop();
    }
  });

  it("creates shell terminals through substrate launch options", async () => {
    const runtimeRoot = await mkdtemp(path.join(os.tmpdir(), "exo-command-server-"));
    tempPaths.push(runtimeRoot);
    let receivedTerminalKind = "";
    let receivedHarnessId = "";
    let receivedCallerSurface = "";
    const server = new CommandServer({
      ...commandServerOptions(runtimeRoot),
      onCreateTerminal: async (options) => {
        receivedTerminalKind = options.terminalKind ?? "";
        receivedHarnessId = options.harnessId ?? "";
        receivedCallerSurface = options.callerSurface ?? "";
        return {
          id: "terminal-1",
          terminalKind: "shell",
          harnessId: null,
          kind: "shell",
          title: "Shell",
          cwd: runtimeRoot,
          command: "zsh",
          status: "running",
        };
      },
    });

    try {
      const port = await server.start();
      const response = await commandFetch(runtimeRoot, port, "/terminals", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ kind: "shell", callerSurface: "cli" }),
      });

      expect(response.ok).toBe(true);
      await expect(response.json()).resolves.toMatchObject({ id: "terminal-1", kind: "shell" });
      expect(receivedTerminalKind).toBe("shell");
      expect(receivedHarnessId).toBe("");
      expect(receivedCallerSurface).toBe("commandServer");
    } finally {
      server.stop();
    }
  });

  it("does not treat metadata-only local plugin ids as launchable harnesses", async () => {
    const runtimeRoot = await mkdtemp(path.join(os.tmpdir(), "exo-command-server-"));
    tempPaths.push(runtimeRoot);
    let created = false;
    const server = new CommandServer({
      ...commandServerOptions(runtimeRoot),
      onCreateTerminal: async () => {
        created = true;
        return {
          id: "terminal-1",
          terminalKind: "shell",
          harnessId: null,
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
      const response = await commandFetch(runtimeRoot, port, "/terminals", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ harnessId: "local.llama-agent", kind: "shell" }),
      });

      expect(response.status).toBe(400);
      await expect(response.json()).resolves.toMatchObject({
        ok: false,
        code: "unsupported-terminal-launch",
        harnessId: "local.llama-agent",
        error: expect.stringContaining("Terminal creation only supports shell"),
      });
      expect(created).toBe(false);
    } finally {
      server.stop();
    }
  });

  it("rejects command-server-only harnesses for CLI callers", async () => {
    const runtimeRoot = await mkdtemp(path.join(os.tmpdir(), "exo-command-server-"));
    tempPaths.push(runtimeRoot);
    let created = false;
    const server = new CommandServer({
      ...commandServerOptions(runtimeRoot),
      onCreateTerminal: async () => {
        created = true;
        throw new Error("Unexpected terminal creation");
      },
    });

    try {
      const port = await server.start();
      const response = await commandFetch(runtimeRoot, port, "/terminals", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          harnessId: COMMAND_SERVER_ONLY_HARNESS_ID,
          kind: "shell",
          callerSurface: "cli",
        }),
      });

      expect(response.status).toBe(400);
      await expect(response.json()).resolves.toMatchObject({
        ok: false,
        code: "unsupported-terminal-launch",
        harnessId: COMMAND_SERVER_ONLY_HARNESS_ID,
        error: expect.stringContaining("Terminal creation only supports shell"),
      });
      expect(created).toBe(false);
    } finally {
      server.stop();
    }
  });

  it("rejects deleted MCP caller surface as an unsupported terminal launch", async () => {
    const runtimeRoot = await mkdtemp(path.join(os.tmpdir(), "exo-command-server-"));
    tempPaths.push(runtimeRoot);
    let created = false;
    const server = new CommandServer({
      ...commandServerOptions(runtimeRoot),
      onCreateTerminal: async () => {
        created = true;
        throw new Error("Unexpected terminal creation");
      },
    });

    try {
      const port = await server.start();
      const response = await commandFetch(runtimeRoot, port, "/terminals", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          harnessId: COMMAND_SERVER_ONLY_HARNESS_ID,
          kind: "shell",
          callerSurface: "mcp",
        }),
      });

      expect(response.status).toBe(400);
      await expect(response.json()).resolves.toMatchObject({
        ok: false,
        code: "unsupported-terminal-launch",
        error: expect.stringContaining("Terminal creation only supports shell"),
      });
      expect(created).toBe(false);
    } finally {
      server.stop();
    }
  });

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
      const response = await commandFetch(runtimeRoot, port, "/terminals/term-1/tail?lines=2");

      expect(response.ok).toBe(true);
      await expect(response.json()).resolves.toEqual({ tail: "line-2\nline-3" });
      expect(receivedOptions).toEqual({ maxLines: 2 });
    } finally {
      server.stop();
    }
  });

  it("returns trace-backed semantic answers separately from terminal tails", async () => {
    const runtimeRoot = await mkdtemp(path.join(os.tmpdir(), "exo-command-server-"));
    tempPaths.push(runtimeRoot);
    await captureFakeHarnessTraceFixture(new SemanticTraceStore(runtimeRoot), {
      sessionId: "term-pi",
      harnessId: "fake-pi",
      rawEvents: [{ type: "assistant-text", text: "PI_FIXTURE_ANSWER OK" }],
      now: () => "2026-07-03T16:00:00.000Z",
    });
    const server = new CommandServer({
      ...commandServerOptions(runtimeRoot),
      onReadTerminalSemanticAnswer: async (id, options) => {
        const events = await new SemanticTraceStore(runtimeRoot).readEvents(id, { limit: options?.limit ?? 100 });
        return events.length === 0 ? null : semanticTraceEventsToAgentAnswerText(events);
      },
    });

    try {
      const port = await server.start();
      const response = await commandFetch(runtimeRoot, port, "/terminals/term-pi/semantic-answer?limit=10");

      expect(response.ok).toBe(true);
      await expect(response.json()).resolves.toEqual({ answer: "PI_FIXTURE_ANSWER OK" });
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
      const response = await commandFetch(runtimeRoot, port, "/terminals", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ harnessId: "hermes", kind: "hermes" }),
      });

      expect(response.status).toBe(400);
      await expect(response.json()).resolves.toMatchObject({
        ok: false,
        code: "unsupported-terminal-launch",
        harnessId: "hermes",
        error: expect.stringContaining("Terminal creation only supports shell"),
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
      const response = await commandFetch(runtimeRoot, port, "/terminals/term-1/message", {
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
      const terminals = await fetchJson(runtimeRoot, port, "/terminals");
      const diagnostics = await fetchJson(runtimeRoot, port, "/terminals/diagnostics");

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

});

async function commandFetch(runtimeRoot: string, port: number, route: string, init: RequestInit = {}): Promise<Response> {
  const { token } = await readServerInfo(runtimeRoot);
  const headers = new Headers(init.headers);
  headers.set(EXO_COMMAND_TOKEN_HEADER, token);
  headers.set("Authorization", `Bearer ${token}`);
  return fetch(`http://127.0.0.1:${port}${route}`, {
    ...init,
    headers,
  });
}

async function fetchJson(runtimeRoot: string, port: number, route: string): Promise<any> {
  const response = await commandFetch(runtimeRoot, port, route);
  expect(response.ok).toBe(true);
  return response.json();
}

async function readServerInfo(runtimeRoot: string): Promise<{ port: number; pid: number; token: string }> {
  return JSON.parse(await readFile(path.join(runtimeRoot, "server.json"), "utf8")) as { port: number; pid: number; token: string };
}

function commandServerOptions(runtimeRoot: string): CommandServerOptions {
  return {
    runtimeRoot,
    onShowWindow: () => {},
    onOpenFile: () => {},
    onOpenPreview: async (target) => ({ ok: true, url: target, source: "url" }),
    onFocusPreview: () => ({ ok: true }),
    onClosePreview: () => ({ ok: true }),
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
    onReadTerminalSemanticAnswer: async () => "",
    onWriteTerminal: async () => ({ ok: true, delivery: "sent" }),
    onSendTerminalMessage: async () => ({ ok: true, delivery: "sent" }),
    onKillTerminal: async () => {},
    onGetSettings: () => workspaceSettings(),
    onGetStatus: () => ({ ok: true }),
    onSpawnAgentCommand: async ({ handle, task }) => ({
      ok: true,
      invocation: {
        id: "invocation-1",
        status: "running",
        context: "cli",
        mentionProvenance: "unknown",
        message: task,
        promptDelivery: "terminalInputAfterLaunch",
        command: {
          id: handle.replace(/^@/, ""),
          label: handle,
          handle: handle.replace(/^@/, ""),
          command: "fake-agent",
          cwdPolicy: "workspace_root",
          promptDelivery: "terminalInputAfterLaunch",
          version: 1,
          enabled: true,
          executableFingerprint: "0".repeat(64),
        },
        cwd: runtimeRoot,
        createdAt: "2026-07-08T00:00:00.000Z",
        changedFileRefs: [],
        diffRefs: [],
        attribution: { status: "pending" },
      },
      terminal: {
        id: "terminal-1",
        terminalKind: "shell",
        harnessId: null,
        kind: "shell",
        title: handle,
        cwd: runtimeRoot,
        command: "fake-agent",
        status: "running",
        attachGeneration: 1,
      },
    }),
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
