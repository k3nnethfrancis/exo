import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import { AppClient } from "./app-client";

const tempPaths: string[] = [];

afterEach(async () => {
  vi.unstubAllGlobals();
  await Promise.all(tempPaths.splice(0).map((target) => rm(target, { recursive: true, force: true })));
});

describe("AppClient", () => {
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

    const client = await AppClient.connect(runtimeRoot, {
      EXO_APP_CLIENT_REQUEST_TIMEOUT_MS: "1",
      EXO_APP_CLIENT_SEARCH_TIMEOUT_MS: "100",
    });

    await expect(client?.search("roleplay", { limit: 7 })).resolves.toMatchObject({ query: "roleplay", limit: "7" });
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

    const client = await AppClient.connect(runtimeRoot, {
      EXO_APP_CLIENT_REQUEST_TIMEOUT_MS: "50",
      EXO_APP_CLIENT_SEARCH_TIMEOUT_MS: "5",
    });

    await expect(client?.search("roleplay")).rejects.toThrow("GET /search?q=roleplay timed out after 5ms");
  });
});

async function runtimeFixture(): Promise<string> {
  const runtimeRoot = await mkdtemp(path.join(os.tmpdir(), "exo-cli-client-"));
  tempPaths.push(runtimeRoot);
  await writeFile(path.join(runtimeRoot, "server.json"), JSON.stringify({ port: 12345, pid: process.pid }), "utf8");
  return runtimeRoot;
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
