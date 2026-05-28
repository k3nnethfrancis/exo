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
        return json({ ok: true, delivery: "queued", queuedInputCount: 1 });
      }
      return json({ error: "not found" }, 404);
    });

    const client = await ExoCommandClient.connect(testRuntimeEnv(runtimeRoot));

    await expect(client.sendAgentInput("term-1", "hello\r")).resolves.toMatchObject({ delivery: "queued" });
    expect(JSON.parse(receivedBody)).toEqual({ data: "hello\r" });
  });

  it("sends agent messages through the semantic message endpoint", async () => {
    const runtimeRoot = await runtimeFixture();
    let receivedBody = "";
    stubCommandServer(async (targetUrl, init) => {
      if (targetUrl.pathname === "/status") {
        return json({ ok: true });
      }
      if (targetUrl.pathname === "/terminals/term-1/message" && init?.method === "POST") {
        receivedBody = String(init.body ?? "");
        return json({ ok: true, delivery: "sent" });
      }
      return json({ error: "not found" }, 404);
    });

    const client = await ExoCommandClient.connect(testRuntimeEnv(runtimeRoot));
    const message = "hello   agent\npreserve spaces";

    await expect(client.sendAgentMessage("term-1", message, true)).resolves.toMatchObject({ delivery: "sent" });
    expect(JSON.parse(receivedBody)).toEqual({ message, submit: true });
  });

  it("can send semantic agent messages without submitting", async () => {
    const runtimeRoot = await runtimeFixture();
    let receivedBody = "";
    stubCommandServer(async (targetUrl, init) => {
      if (targetUrl.pathname === "/status") {
        return json({ ok: true });
      }
      if (targetUrl.pathname === "/terminals/term-1/message" && init?.method === "POST") {
        receivedBody = String(init.body ?? "");
        return json({ ok: true, delivery: "sent" });
      }
      return json({ error: "not found" }, 404);
    });

    const client = await ExoCommandClient.connect(testRuntimeEnv(runtimeRoot));
    const message = "draft   agent message";

    await expect(client.sendAgentMessage("term-1", message, false)).resolves.toMatchObject({ delivery: "sent" });
    expect(JSON.parse(receivedBody)).toEqual({ message, submit: false });
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

  it("uses the search timeout instead of the general request timeout for search", async () => {
    const runtimeRoot = await runtimeFixture();
    stubCommandServer(async (targetUrl, init) => {
      if (targetUrl.pathname === "/status") {
        return json({ ok: true });
      }
      if (targetUrl.pathname === "/search") {
        await delayWithAbort(10, init?.signal);
        return json({ query: targetUrl.searchParams.get("q"), limit: targetUrl.searchParams.get("limit") });
      }
      return json({ error: "not found" }, 404);
    });

    const client = await ExoCommandClient.connect({
      ...testRuntimeEnv(runtimeRoot),
      EXO_MCP_REQUEST_TIMEOUT_MS: "1",
      EXO_MCP_SEARCH_TIMEOUT_MS: "100",
    });

    await expect(client.search("roleplay", { limit: 7 })).resolves.toMatchObject({ query: "roleplay", limit: "7" });
  });

  it("reports search timeout details", async () => {
    const runtimeRoot = await runtimeFixture();
    stubCommandServer(async (targetUrl, init) => {
      if (targetUrl.pathname === "/status") {
        return json({ ok: true });
      }
      if (targetUrl.pathname === "/search") {
        await delayWithAbort(100, init?.signal);
        return json({ results: [] });
      }
      return json({ error: "not found" }, 404);
    });

    const client = await ExoCommandClient.connect({
      ...testRuntimeEnv(runtimeRoot),
      EXO_MCP_REQUEST_TIMEOUT_MS: "50",
      EXO_MCP_SEARCH_TIMEOUT_MS: "5",
    });

    await expect(client.search("roleplay")).rejects.toThrow("GET /search?q=roleplay timed out after 5ms");
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

function delayWithAbort(ms: number, signal?: AbortSignal | null): Promise<void> {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(resolve, ms);
    signal?.addEventListener("abort", () => {
      clearTimeout(timeout);
      reject(signal.reason ?? new DOMException("The operation was aborted.", "AbortError"));
    }, { once: true });
  });
}
