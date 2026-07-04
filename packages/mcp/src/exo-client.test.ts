import { mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import { ExoCommandClient, formatAgents, stripAnsi } from "./exo-client";

const spawnMock = vi.hoisted(() =>
  vi.fn(() => ({
    unref: vi.fn(),
  })),
);

vi.mock("node:child_process", () => ({
  spawn: spawnMock,
}));

const tempPaths: string[] = [];

afterEach(async () => {
  vi.restoreAllMocks();
  spawnMock.mockClear();
  vi.unstubAllGlobals();
  await Promise.all(tempPaths.splice(0).map((target) => rm(target, { recursive: true, force: true })));
});

describe("ExoCommandClient", () => {
  it("lists and reads agents through Exo command server discovery", async () => {
    const runtimeRoot = await runtimeFixture();
    let createBody = "";
    stubCommandServer(async (targetUrl, init) => {
      if (targetUrl.pathname === "/status") {
        return json({ ok: true });
      }
      if (targetUrl.pathname === "/terminals") {
        if (init?.method === "POST") {
          createBody = String(init.body ?? "");
          return json({ id: "term-2", kind: "codex", status: "running", cwd: "/tmp", title: "Codex", command: "codex" });
        }
        return json([{ id: "term-1", kind: "claude", status: "running", cwd: "/tmp", title: "Claude", command: "claude" }]);
      }
      if (targetUrl.pathname === "/terminals/term-1/transcript" && targetUrl.searchParams.get("tailChars") === "5") {
        return json({ transcript: "laude" });
      }
      if (targetUrl.pathname === "/terminals/term-1/tail" && targetUrl.searchParams.get("lines") === "2") {
        return json({ tail: "line-2\nline-3" });
      }
      if (targetUrl.pathname === "/terminals/term-2" && init?.method === "DELETE") {
        return json({ ok: true });
      }
      return json({ error: "not found" }, 404);
    });

    const client = await ExoCommandClient.connect(testRuntimeEnv(runtimeRoot));

    expect(formatAgents(await client.listAgents())).toContain("term-1\tclaude\trunning");
    expect(await client.readAgent("term-1", 5)).toBe("laude");
    expect(await client.readAgentTail("term-1", 2)).toBe("line-2\nline-3");
    expect(await client.createAgent("codex", "/tmp")).toMatchObject({ id: "term-2", kind: "codex" });
    expect(JSON.parse(createBody)).toEqual({ harnessId: "codex", kind: "codex", cwd: "/tmp", callerSurface: "mcp" });
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

  it("preserves not-found delivery for missing semantic agent targets", async () => {
    const runtimeRoot = await runtimeFixture();
    stubCommandServer(async (targetUrl, init) => {
      if (targetUrl.pathname === "/status") {
        return json({ ok: true });
      }
      if (targetUrl.pathname === "/terminals/missing/message" && init?.method === "POST") {
        return json({ ok: false, delivery: "not-found" });
      }
      return json({ error: "not found" }, 404);
    });

    const client = await ExoCommandClient.connect(testRuntimeEnv(runtimeRoot));

    await expect(client.sendAgentMessage("missing", "hello", true)).resolves.toEqual({
      ok: false,
      delivery: "not-found",
    });
  });

  it("calls preview open, focus, and close endpoints", async () => {
    const runtimeRoot = await runtimeFixture();
    const calls: Array<{ path: string; body: unknown }> = [];
    stubCommandServer(async (targetUrl, init) => {
      if (targetUrl.pathname === "/status") {
        return json({ ok: true });
      }
      if (targetUrl.pathname.startsWith("/preview/") && init?.method === "POST") {
        calls.push({ path: targetUrl.pathname, body: init.body ? JSON.parse(String(init.body)) : null });
        if (targetUrl.pathname === "/preview/open") {
          return json({ ok: true, url: "http://localhost:3000", source: "url" });
        }
        return json({ ok: true });
      }
      return json({ error: "not found" }, 404);
    });

    const client = await ExoCommandClient.connect(testRuntimeEnv(runtimeRoot));

    await expect(client.openPreview("http://localhost:3000")).resolves.toMatchObject({ ok: true, source: "url" });
    await expect(client.focusPreview()).resolves.toEqual({ ok: true });
    await expect(client.closePreview()).resolves.toEqual({ ok: true });
    expect(calls).toEqual([
      { path: "/preview/open", body: { target: "http://localhost:3000" } },
      { path: "/preview/focus", body: {} },
      { path: "/preview/close", body: {} },
    ]);
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

  it("reports stale command-server discovery when the recorded pid is dead", async () => {
    const runtimeRoot = await runtimeFixture({ port: 54321, pid: 999_999 });
    stubCommandServer(() => {
      throw new Error("fetch failed");
    });
    stubProcessKillFailure("ESRCH", "kill ESRCH");

    const message = await connectErrorMessage(testRuntimeEnv(runtimeRoot));

    expect(message).toContain("Exo command server discovery is stale: the recorded pid is not running.");
    expect(message).toContain(`Runtime root: ${runtimeRoot}`);
    expect(message).toContain(`Discovery file: ${path.join(runtimeRoot, "server.json")}`);
    expect(message).toContain("Recorded pid: 999999");
    expect(message).toContain("Recorded port: 54321");
    expect(message).toContain("Recorded baseUrl: http://127.0.0.1:54321");
    expect(message).toContain("Process check: dead (ESRCH: kill ESRCH)");
    expect(message).toContain("Last reachability failure: http://127.0.0.1:54321 - fetch failed");
  });

  it("reports unchanged stale discovery through an autostart wait timeout", async () => {
    const runtimeRoot = await runtimeFixture({ port: 54322, pid: 999_998 });
    stubCommandServer(() => {
      throw new Error("fetch failed");
    });
    stubProcessKillFailure("ESRCH", "kill ESRCH");

    const message = await connectErrorMessage({
      ...testRuntimeEnv(runtimeRoot),
      EXO_MCP_AUTOSTART: "1",
      EXO_MCP_CONNECT_TIMEOUT_MS: "5",
      EXO_MCP_START_COMMAND: "exo start --test",
    });

    expect(message).toContain("Timed out waiting for Exo command server after autostart.");
    expect(message).toContain(`Runtime root: ${runtimeRoot}`);
    expect(message).toContain(`Discovery file: ${path.join(runtimeRoot, "server.json")}`);
    expect(message).toContain("Connect timeout: 5ms");
    expect(message).toContain("Autostart attempted: yes");
    expect(message).toContain("Autostart command: exo start --test");
    expect(message).toContain("Recorded pid: 999998");
    expect(message).toContain("Recorded port: 54322");
    expect(message).toContain("Recorded baseUrl: http://127.0.0.1:54322");
    expect(message).toContain("Process check: dead (ESRCH: kill ESRCH)");
    expect(message).not.toContain("Last reachability failure: http://127.0.0.1:54322 - fetch failed");
    expect(spawnMock).toHaveBeenCalledWith("exo start --test", expect.objectContaining({
      detached: true,
      shell: true,
      stdio: "ignore",
    }));
  });

  it("quarantines a definitely stale discovery file before autostart", async () => {
    const runtimeRoot = await runtimeFixture({ port: 54324, pid: 999_996 });
    stubCommandServer(() => {
      throw new Error("fetch failed");
    });
    stubProcessKillFailure("ESRCH", "kill ESRCH");

    await connectErrorMessage({
      ...testRuntimeEnv(runtimeRoot),
      EXO_MCP_AUTOSTART: "1",
      EXO_MCP_CONNECT_TIMEOUT_MS: "5",
      EXO_MCP_START_COMMAND: "exo start --test",
    });

    const entries = await readdir(runtimeRoot);
    expect(entries).not.toContain("server.json");
    expect(entries.some((entry) => entry.startsWith("server.json.stale-"))).toBe(true);
  });

  it("does not quarantine discovery when process checks are permission-blocked", async () => {
    const runtimeRoot = await runtimeFixture({ port: 54325, pid: 999_995 });
    stubCommandServer(() => {
      throw new Error("fetch failed");
    });
    stubProcessKillFailure("EPERM", "operation not permitted");

    await connectErrorMessage({
      ...testRuntimeEnv(runtimeRoot),
      EXO_MCP_AUTOSTART: "1",
      EXO_MCP_CONNECT_TIMEOUT_MS: "5",
      EXO_MCP_START_COMMAND: "exo start --test",
    });

    const entries = await readdir(runtimeRoot);
    expect(entries).toContain("server.json");
    expect(entries.some((entry) => entry.startsWith("server.json.stale-"))).toBe(false);
  });

  it("autostart waits for a fresh reachable discovery file after quarantining stale discovery", async () => {
    const runtimeRoot = await runtimeFixture({ port: 54326, pid: 999_994 });
    const freshPort = 54327;
    const freshPid = process.pid;
    spawnMock.mockImplementationOnce(() => {
      void writeFile(path.join(runtimeRoot, "server.json"), JSON.stringify({ port: freshPort, pid: freshPid }), "utf8");
      return { unref: vi.fn() };
    });
    vi.spyOn(process, "kill").mockImplementation((pid) => {
      if (pid === 999_994) {
        const error = new Error("kill ESRCH") as NodeJS.ErrnoException;
        error.code = "ESRCH";
        throw error;
      }
      return true;
    });
    stubCommandServer((targetUrl) => {
      if (targetUrl.port === String(freshPort) && targetUrl.pathname === "/status") {
        return json({ ok: true });
      }
      throw new Error(`unexpected stale command-server request: ${targetUrl.toString()}`);
    });

    const client = await ExoCommandClient.connect({
      ...testRuntimeEnv(runtimeRoot),
      EXO_MCP_AUTOSTART: "1",
      EXO_MCP_CONNECT_TIMEOUT_MS: "1000",
      EXO_MCP_START_COMMAND: "exo start --test",
    });

    expect(await client.isReachable()).toBe(true);
  });

  it("reports permission-blocked process checks separately from dead pids", async () => {
    const runtimeRoot = await runtimeFixture({ port: 54323, pid: 999_997 });
    stubCommandServer(() => {
      throw new Error("fetch failed");
    });
    stubProcessKillFailure("EPERM", "operation not permitted");

    const message = await connectErrorMessage(testRuntimeEnv(runtimeRoot));

    expect(message).toContain("Exo command server process check was blocked by permissions or sandbox policy; server reachability could not be confirmed.");
    expect(message).toContain(`Runtime root: ${runtimeRoot}`);
    expect(message).toContain(`Discovery file: ${path.join(runtimeRoot, "server.json")}`);
    expect(message).toContain("Recorded pid: 999997");
    expect(message).toContain("Recorded port: 54323");
    expect(message).toContain("Recorded baseUrl: http://127.0.0.1:54323");
    expect(message).toContain("Process check: blocked (EPERM: operation not permitted)");
    expect(message).toContain("Last reachability failure: http://127.0.0.1:54323 - fetch failed");
  });

  it("strips terminal escape codes for readable MCP output", () => {
    expect(stripAnsi("\u001b[31mred\u001b[0m\r\nnext")).toBe("red\nnext");
    expect(stripAnsi("\u001b(0lqqk\u001b(B\r\u001b[2K\u001b(0x\u001b(B Ready \u001b(0x\u001b(B\n")).toBe("│ Ready │\n");
  });
});

async function runtimeFixture(info: { port: number; pid: number } = { port: 12345, pid: process.pid }): Promise<string> {
  const runtimeRoot = await mkdtemp(path.join(os.tmpdir(), "exo-mcp-"));
  tempPaths.push(runtimeRoot);
  await writeFile(path.join(runtimeRoot, "server.json"), JSON.stringify(info), "utf8");
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

function stubProcessKillFailure(code: string, message: string) {
  vi.spyOn(process, "kill").mockImplementation(() => {
    const error = new Error(message) as NodeJS.ErrnoException;
    error.code = code;
    throw error;
  });
}

async function connectErrorMessage(env: NodeJS.ProcessEnv): Promise<string> {
  try {
    await ExoCommandClient.connect(env);
    throw new Error("connect unexpectedly succeeded");
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }
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
