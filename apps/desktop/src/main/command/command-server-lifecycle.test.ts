import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";
import type { StemCommandServerInfo } from "@stem/core";

import { CommandServerLifecycle } from "./command-server-lifecycle";
import type { CommandServer } from "./command-server";

const tempRoots: string[] = [];

afterEach(async () => {
  await Promise.all(tempRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("CommandServerLifecycle", () => {
  it("serializes concurrent starts into one server and publishes discovery", async () => {
    const runtimeRoot = await tempRoot();
    const server = fakeServer("token-one", 41001, 20);
    const lifecycle = new CommandServerLifecycle({ runtimeRoot, createServer: () => server });

    const [first, second] = await Promise.all([lifecycle.start(), lifecycle.start()]);

    expect(first).toEqual({ listening: true, port: 41001 });
    expect(second).toEqual(first);
    expect(server.starts).toBe(1);
    await expect(readFile(path.join(runtimeRoot, "server.json"), "utf8")).resolves.toContain("token-one");
  });

  it("does not remove discovery owned by a newer generation", async () => {
    const runtimeRoot = await tempRoot();
    let current = fakeServer("token-one", 41001);
    const lifecycle = new CommandServerLifecycle({ runtimeRoot, createServer: () => current });
    await lifecycle.start();

    await writeFile(path.join(runtimeRoot, "server.json"), JSON.stringify({ token: "token-two", port: 41002 }));
    await lifecycle.stop();

    await expect(readFile(path.join(runtimeRoot, "server.json"), "utf8")).resolves.toContain("token-two");
    current = fakeServer("token-three", 41003);
    await lifecycle.start();
    expect(lifecycle.status()).toEqual({ listening: true, port: 41003 });
  });

  it("removes only the discovery record it owns", async () => {
    const runtimeRoot = await tempRoot();
    const lifecycle = new CommandServerLifecycle({
      runtimeRoot,
      createServer: () => fakeServer("token-owned", 41004),
    });
    await lifecycle.start();
    await lifecycle.stop();
    await expect(readFile(path.join(runtimeRoot, "server.json"), "utf8")).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("stages discovery until one synchronous commit", async () => {
    const runtimeRoot = await tempRoot();
    const lifecycle = new CommandServerLifecycle({
      runtimeRoot,
      createServer: () => fakeServer("token-staged", 41005),
    });

    await lifecycle.start({ publishDiscovery: false });
    await expect(readFile(path.join(runtimeRoot, "server.json"), "utf8")).rejects.toMatchObject({ code: "ENOENT" });

    const staged = await lifecycle.prepareDiscovery();
    staged.commit();

    await expect(readFile(path.join(runtimeRoot, "server.json"), "utf8")).resolves.toContain("token-staged");
    await lifecycle.stop();
  });

  it("keeps B's staged discovery when a concurrent same-root A candidate aborts", async () => {
    const runtimeRoot = await tempRoot();
    const lifecycleA = new CommandServerLifecycle({ runtimeRoot, createServer: () => fakeServer("token-a", 41006) });
    const lifecycleB = new CommandServerLifecycle({ runtimeRoot, createServer: () => fakeServer("token-b", 41007) });
    await Promise.all([
      lifecycleA.start({ publishDiscovery: false }),
      lifecycleB.start({ publishDiscovery: false }),
    ]);
    const [stagedA, stagedB] = await Promise.all([
      lifecycleA.prepareDiscovery(),
      lifecycleB.prepareDiscovery(),
    ]);

    stagedA.abort();
    stagedB.commit();

    await expect(readFile(path.join(runtimeRoot, "server.json"), "utf8")).resolves.toContain("token-b");
    await Promise.all([lifecycleA.stop(), lifecycleB.stop()]);
  });
});

async function tempRoot(): Promise<string> {
  const root = await mkdtemp(path.join(os.tmpdir(), "stem-command-lifecycle-"));
  tempRoots.push(root);
  return root;
}

function fakeServer(token: string, port: number, delay = 0) {
  let listening = false;
  let starts = 0;
  const info: StemCommandServerInfo = { token, port, pid: process.pid };
  return {
    get starts() {
      return starts;
    },
    async start() {
      starts += 1;
      if (delay) await new Promise((resolve) => setTimeout(resolve, delay));
      listening = true;
      return port;
    },
    async stop() {
      listening = false;
    },
    isListening: () => listening,
    getPort: () => (listening ? port : null),
    getServerInfo: () => info,
  } as unknown as CommandServer & { starts: number };
}
