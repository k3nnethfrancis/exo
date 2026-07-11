import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";
import { EXO_COMMAND_TOKEN_HEADER, type IndexStatus, type WorkspaceSettings } from "@exo/core";

import { CommandServer, type CommandServerOptions } from "./command-server";

const tempPaths: string[] = [];

afterEach(async () => {
  await Promise.all(tempPaths.splice(0).map((target) => rm(target, { recursive: true, force: true })));
});

describe("CommandServer operator contract", () => {
  it("requires its runtime token", async () => {
    const { server, port, token } = await startServer();
    try {
      const response = await fetch(`http://127.0.0.1:${port}/status`);
      expect(response.status).toBe(401);
      await expect(response.json()).resolves.toMatchObject({ error: "Missing or invalid Exo command token." });
    } finally {
      server.stop();
    }
  });

  it("supports the direct-pty list/create/read/write/send/kill contract", async () => {
    const { server, port, token } = await startServer({
      onListTerminals: () => [{ id: "term-1", title: "Shell", cwd: "/workspace", kind: "shell", command: "zsh", status: "running" }],
      onReadTerminalTail: () => "one\ntwo\n",
    });
    try {
      await expect(fetchJson(token, port, "/terminals")).resolves.toEqual([
        { id: "term-1", title: "Shell", cwd: "/workspace", kind: "shell", command: "zsh", status: "running" },
      ]);
      await expect(fetchJson(token, port, "/terminals/term-1/tail?lines=1")).resolves.toEqual({ tail: "one\ntwo\n" });
      await expect(fetchJson(token, port, "/terminals", { method: "POST", body: JSON.stringify({ kind: "shell", cwd: "/workspace" }) })).resolves.toMatchObject({ id: "term-1" });
      await expect(fetchJson(token, port, "/terminals/term-1/write", { method: "POST", body: JSON.stringify({ data: "echo hi" }) })).resolves.toEqual({ ok: true, delivery: "sent" });
      await expect(fetchJson(token, port, "/terminals/term-1/message", { method: "POST", body: JSON.stringify({ message: "echo hi", submit: true }) })).resolves.toEqual({ ok: true, delivery: "sent" });
      await expect(fetchJson(token, port, "/terminals/term-1", { method: "DELETE" })).resolves.toEqual({ ok: true });
    } finally {
      server.stop();
    }
  });

  it("does not expose legacy diagnostic, transcript, or semantic-answer routes", async () => {
    const { server, port, token } = await startServer();
    try {
      for (const route of ["/terminals/diagnostics", "/terminals/term-1/transcript", "/terminals/term-1/semantic-answer"]) {
        const response = await commandFetch(token, port, route);
        expect(response.status).toBe(404);
      }
    } finally {
      server.stop();
    }
  });
});

async function startServer(overrides: Partial<CommandServerOptions> = {}) {
  const runtimeRoot = await mkdtemp(path.join(os.tmpdir(), "exo-command-server-"));
  tempPaths.push(runtimeRoot);
  const server = new CommandServer({ ...options(runtimeRoot), ...overrides });
  return { runtimeRoot, server, port: await server.start(), token: server.getServerInfo().token };
}

async function commandFetch(token: string, port: number, route: string, init: RequestInit = {}): Promise<Response> {
  const headers = new Headers(init.headers);
  headers.set(EXO_COMMAND_TOKEN_HEADER, token);
  headers.set("Content-Type", "application/json");
  return fetch(`http://127.0.0.1:${port}${route}`, { ...init, headers });
}

async function fetchJson(token: string, port: number, route: string, init: RequestInit = {}): Promise<unknown> {
  const response = await commandFetch(token, port, route, init);
  expect(response.ok).toBe(true);
  return response.json();
}

function options(runtimeRoot: string): CommandServerOptions {
  const settings = { workspaceRoot: "/workspace", defaultTerminalCwd: "/workspace", noteRoots: ["/workspace"], projectRoots: [], indexedRoots: [], indexing: { enabled: false, mode: "off", backend: "qmd" }, appearanceMode: "system", colorThemeId: "exo-neutral", editorFontSize: 15, terminalFontSize: 13, terminalHistoryLines: 1000, terminalTranscriptRetention: "forever", terminalTranscriptRetentionDays: 14, explorerScale: 1, exploreIndexSearchOnEnter: false, indexUpdateStrategy: "on-save" } satisfies WorkspaceSettings;
  const status = { available: false, backend: "qmd", roots: [], warnings: [] } as unknown as IndexStatus;
  return {
    runtimeRoot, onShowWindow: () => {}, onOpenFile: () => {}, onOpenPreview: async (target) => ({ ok: true, url: target, source: "url" }), onFocusPreview: () => ({ ok: true }), onClosePreview: () => ({ ok: true }), onSearch: async () => ({ notes: [], projectFiles: [], tags: [] }), onIndexSearch: async () => ({ mode: "lexical", source: "filesystem", query: "", results: [], warnings: [] }), onReadDocument: async () => ({ target: "", filePath: "", title: "", body: "", source: "filesystem" }), onIndexStatus: async () => status, onIndexAddRoot: async () => settings, onIndexRemoveRoot: async () => settings, onIndexSync: async () => ({ status, phases: [], warnings: [] }), onListTerminals: () => [], onCreateTerminal: async () => ({ id: "term-1", title: "Shell", cwd: "/workspace", kind: "shell", command: "zsh", status: "running" }), onReadTerminalTail: () => "", onWriteTerminal: async () => ({ ok: true, delivery: "sent" }), onSendTerminalMessage: async () => ({ ok: true, delivery: "sent" }), onKillTerminal: async () => {}, onGetSettings: () => settings, onGetStatus: () => ({ ok: true }), onSpawnAgentCommand: async () => { throw new Error("not used"); },
  };
}
