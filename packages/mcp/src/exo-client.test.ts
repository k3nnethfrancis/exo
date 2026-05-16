import { createServer, type Server, type ServerResponse } from "node:http";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { ExoCommandClient, formatAgents, stripAnsi } from "./exo-client";

const tempPaths: string[] = [];
const servers: Server[] = [];

afterEach(async () => {
  for (const server of servers.splice(0)) {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
  await Promise.all(tempPaths.splice(0).map((target) => rm(target, { recursive: true, force: true })));
});

describe("ExoCommandClient", () => {
  it("lists and reads agents through Exo command server discovery", async () => {
    const runtimeRoot = await mkdtemp(path.join(os.tmpdir(), "exo-mcp-"));
    tempPaths.push(runtimeRoot);

    const server = createServer((req, res) => {
      if (req.url === "/status") {
        json(res, { ok: true });
        return;
      }
      if (req.url === "/terminals") {
        if (req.method === "POST") {
          json(res, { id: "term-2", kind: "codex", status: "running", cwd: "/tmp", title: "Codex", command: "codex" });
          return;
        }
        json(res, [{ id: "term-1", kind: "claude", status: "running", cwd: "/tmp", title: "Claude", command: "claude" }]);
        return;
      }
      if (req.url === "/terminals/term-1/transcript?tailChars=5") {
        json(res, { transcript: "laude" });
        return;
      }
      if (req.url === "/terminals/term-2" && req.method === "DELETE") {
        json(res, { ok: true });
        return;
      }
      res.writeHead(404).end();
    });
    servers.push(server);

    const port = await listen(server);
    await writeFile(path.join(runtimeRoot, "server.json"), JSON.stringify({ port, pid: process.pid }), "utf8");

    const client = await ExoCommandClient.connect({
      EXO_WORKSPACE_ROOT: "/tmp/exo-test-workspace",
      EXO_RUNTIME_ROOT: runtimeRoot,
    });

    expect(formatAgents(await client.listAgents())).toContain("term-1\tclaude\trunning");
    expect(await client.readAgent("term-1", 5)).toBe("laude");
    expect(await client.createAgent("codex", "/tmp")).toMatchObject({ id: "term-2", kind: "codex" });
    await expect(client.killAgent("term-2")).resolves.toBeUndefined();
  });

  it("sends agent input through the terminal write endpoint", async () => {
    const runtimeRoot = await mkdtemp(path.join(os.tmpdir(), "exo-mcp-"));
    tempPaths.push(runtimeRoot);
    let receivedBody = "";

    const server = createServer((req, res) => {
      if (req.url === "/status") {
        json(res, { ok: true });
        return;
      }
      if (req.url === "/terminals/term-1/write" && req.method === "POST") {
        req.on("data", (chunk) => {
          receivedBody += chunk;
        });
        req.on("end", () => {
          json(res, { ok: true });
        });
        return;
      }
      res.writeHead(404).end();
    });
    servers.push(server);

    const port = await listen(server);
    await writeFile(path.join(runtimeRoot, "server.json"), JSON.stringify({ port, pid: process.pid }), "utf8");

    const client = await ExoCommandClient.connect({
      EXO_WORKSPACE_ROOT: "/tmp/exo-test-workspace",
      EXO_RUNTIME_ROOT: runtimeRoot,
    });

    await client.sendAgentInput("term-1", "hello\r");
    expect(JSON.parse(receivedBody)).toEqual({ data: "hello\r" });
  });

  it("calls index search and read endpoints", async () => {
    const runtimeRoot = await mkdtemp(path.join(os.tmpdir(), "exo-mcp-"));
    tempPaths.push(runtimeRoot);
    let readBody = "";

    const server = createServer((req, res) => {
      if (req.url === "/status") {
        json(res, { ok: true });
        return;
      }
      if (req.url === "/index/status") {
        json(res, { mode: "hybrid", backend: "qmd" });
        return;
      }
      if (req.url?.startsWith("/search?")) {
        json(res, { query: "focus", results: [{ title: "Focus" }] });
        return;
      }
      if (req.url === "/read" && req.method === "POST") {
        req.on("data", (chunk) => {
          readBody += chunk;
        });
        req.on("end", () => json(res, { title: "Focus", body: "hello" }));
        return;
      }
      res.writeHead(404).end();
    });
    servers.push(server);

    const port = await listen(server);
    await writeFile(path.join(runtimeRoot, "server.json"), JSON.stringify({ port, pid: process.pid }), "utf8");

    const client = await ExoCommandClient.connect({
      EXO_WORKSPACE_ROOT: "/tmp/exo-test-workspace",
      EXO_RUNTIME_ROOT: runtimeRoot,
    });

    expect(await client.getIndexStatus()).toMatchObject({ mode: "hybrid" });
    expect(await client.search("focus", { limit: 3, includeContent: true })).toMatchObject({ query: "focus" });
    expect(await client.readDocument("#abc123", { fromLine: 2, maxLines: 4 })).toMatchObject({ title: "Focus" });
    expect(JSON.parse(readBody)).toEqual({ target: "#abc123", fromLine: 2, maxLines: 4 });
  });

  it("strips terminal escape codes for readable MCP output", () => {
    expect(stripAnsi("\u001b[31mred\u001b[0m\r\nnext")).toBe("red\nnext");
  });
});

function listen(server: Server): Promise<number> {
  return new Promise((resolve, reject) => {
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (typeof address === "object" && address) {
        resolve(address.port);
      } else {
        reject(new Error("No server address"));
      }
    });
  });
}

function json(res: ServerResponse, body: unknown) {
  res.writeHead(200, { "Content-Type": "application/json" });
  res.end(JSON.stringify(body));
}
