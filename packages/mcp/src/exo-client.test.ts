import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import { ExoCommandClient, formatAgents, stripAnsi } from "./exo-client";

const tempPaths: string[] = [];

afterEach(async () => {
  vi.unstubAllGlobals();
  await Promise.all(tempPaths.splice(0).map((target) => rm(target, { recursive: true, force: true })));
});

describe("ExoCommandClient", () => {
  it("lists and reads agents through Exo command server discovery", async () => {
    const runtimeRoot = await runtimeFixture();
    stubCommandServer(async (targetUrl, init) => {
      if (targetUrl.pathname === "/status") {
        return json({ ok: true });
      }
      if (targetUrl.pathname === "/terminals") {
        if (init?.method === "POST") {
          return json({ id: "term-2", kind: "codex", status: "running", cwd: "/tmp", title: "Codex", command: "codex" });
        }
        return json([{ id: "term-1", kind: "claude", status: "running", cwd: "/tmp", title: "Claude", command: "claude" }]);
      }
      if (targetUrl.pathname === "/terminals/term-1/transcript" && targetUrl.searchParams.get("tailChars") === "5") {
        return json({ transcript: "laude" });
      }
      if (targetUrl.pathname === "/terminals/term-2" && init?.method === "DELETE") {
        return json({ ok: true });
      }
      return json({ error: "not found" }, 404);
    });

    const client = await ExoCommandClient.connect(testRuntimeEnv(runtimeRoot));

    expect(formatAgents(await client.listAgents())).toContain("term-1\tclaude\trunning");
    expect(await client.readAgent("term-1", 5)).toBe("laude");
    expect(await client.createAgent("codex", "/tmp")).toMatchObject({ id: "term-2", kind: "codex" });
    await expect(client.killAgent("term-2")).resolves.toBeUndefined();
  });

  it("sends agent input through the terminal write endpoint", async () => {
    const runtimeRoot = await runtimeFixture();
    let receivedBody = "";
    stubCommandServer(async (targetUrl, init) => {
      if (targetUrl.pathname === "/status") {
        return json({ ok: true });
      }
      if (targetUrl.pathname === "/terminals/term-1/write" && init?.method === "POST") {
        receivedBody = String(init.body ?? "");
        return json({ ok: true });
      }
      return json({ error: "not found" }, 404);
    });

    const client = await ExoCommandClient.connect(testRuntimeEnv(runtimeRoot));

    await client.sendAgentInput("term-1", "hello\r");
    expect(JSON.parse(receivedBody)).toEqual({ data: "hello\r" });
  });

  it("calls index search and read endpoints", async () => {
    const runtimeRoot = await runtimeFixture();
    let readBody = "";
    stubCommandServer(async (targetUrl, init) => {
      if (targetUrl.pathname === "/status") {
        return json({ ok: true });
      }
      if (targetUrl.pathname === "/index/status") {
        return json({ mode: "hybrid", backend: "qmd" });
      }
      if (targetUrl.pathname === "/index/sync" && init?.method === "POST") {
        return json({ status: { mode: "hybrid", backend: "qmd" }, phases: [] });
      }
      if (targetUrl.pathname === "/search") {
        return json({ query: targetUrl.searchParams.get("q"), results: [{ title: "Focus" }] });
      }
      if (targetUrl.pathname === "/read" && init?.method === "POST") {
        readBody = String(init.body ?? "");
        return json({ title: "Focus", body: "hello" });
      }
      return json({ error: "not found" }, 404);
    });

    const client = await ExoCommandClient.connect(testRuntimeEnv(runtimeRoot));

    expect(await client.getIndexStatus()).toMatchObject({ mode: "hybrid" });
    expect(await client.syncIndex()).toMatchObject({ status: { mode: "hybrid" } });
    expect(await client.search("focus", { limit: 3, includeContent: true })).toMatchObject({ query: "focus" });
    expect(await client.readDocument("#abc123", { fromLine: 2, maxLines: 4 })).toMatchObject({ title: "Focus" });
    expect(JSON.parse(readBody)).toEqual({ target: "#abc123", fromLine: 2, maxLines: 4 });
  });

  it("strips terminal escape codes for readable MCP output", () => {
    expect(stripAnsi("\u001b[31mred\u001b[0m\r\nnext")).toBe("red\nnext");
  });
});

async function runtimeFixture(): Promise<string> {
  const runtimeRoot = await mkdtemp(path.join(os.tmpdir(), "exo-mcp-"));
  tempPaths.push(runtimeRoot);
  await writeFile(path.join(runtimeRoot, "server.json"), JSON.stringify({ port: 12345, pid: process.pid }), "utf8");
  return runtimeRoot;
}

function testRuntimeEnv(runtimeRoot: string): NodeJS.ProcessEnv {
  return {
    EXO_WORKSPACE_ROOT: path.join(runtimeRoot, "workspace"),
    EXO_NOTE_ROOTS: path.join(runtimeRoot, "workspace", "notes"),
    EXO_PROJECT_ROOTS: path.join(runtimeRoot, "workspace", "projects"),
    EXO_RUNTIME_ROOT: runtimeRoot,
    EXO_SETTINGS_PATH: path.join(runtimeRoot, "settings.json"),
    EXO_MCP_REQUEST_TIMEOUT_MS: "500",
  };
}

function stubCommandServer(handler: (targetUrl: URL, init?: RequestInit) => Promise<Response> | Response) {
  vi.stubGlobal("fetch", vi.fn((input: string | URL | Request, init?: RequestInit) => {
    const rawUrl = typeof input === "string" || input instanceof URL ? String(input) : input.url;
    return Promise.resolve(handler(new URL(rawUrl), init));
  }));
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}
