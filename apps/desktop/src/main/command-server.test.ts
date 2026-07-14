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

  it("does not expose terminal remote-control routes", async () => {
    const { server, port, token } = await startServer();
    try {
      for (const route of ["/terminals", "/terminals/term-1/tail", "/terminals/term-1/write", "/terminals/term-1/message"]) {
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
  const status = { available: false, backend: "qmd", roots: [], warnings: [] } as unknown as IndexStatus;
  return {
    runtimeRoot, onShowWindow: () => {}, onOpenFile: () => {}, onIndexSearch: async () => ({ mode: "lexical", source: "filesystem", query: "", results: [], warnings: [] }), onIndexStatus: async () => status, onIndexSync: async () => ({ status, phases: [], warnings: [] }), onGetStatus: () => ({ ok: true }), onSpawnAgentCommand: async () => { throw new Error("not used"); },
  };
}
