import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { EXO_CLI_COMMANDS } from "@exo/core/operator-help";
import { runCli } from "./index";

const client = {
  getStatus: async () => ({ ok: true }), showWindow: async () => {}, search: async (query: string) => ({ query, mode: "lexical", source: "filesystem", warnings: [], results: [] }), getIndexStatus: async () => ({ status: "ready" }), syncIndex: async () => ({ ok: true }), openFile: async () => {}, spawnAgentCommand: async (handle: string, task: string) => ({ handle, task }),
};
const connect = async () => client;

describe("minimal Exo operator CLI", () => {
  it("prints every command from the shared operator catalog", async () => {
    let help = "";
    expect(await runCli(["node", "exo", "--help"], { stderr: { write: (text) => { help += text; } } })).toBe(0);
    for (const command of EXO_CLI_COMMANDS) {
      expect(help).toContain(command.usageToken);
    }
  });

  it("routes the compact search/index/open/invoke contract", async () => {
    let output = "";
    const options = { stdout: { write: (text: string) => { output += text; } }, stderr: { write: () => {} }, connectAppClient: connect };
    expect(await runCli(["node", "exo", "search", "hello"], options)).toBe(0);
    expect(await runCli(["node", "exo", "index", "sync"], options)).toBe(0);
    expect(await runCli(["node", "exo", "open", "note.md"], options)).toBe(0);
    expect(await runCli(["node", "exo", "invoke", "@review", "check", "this"], options)).toBe(0);
    expect(output).toContain("exo.search.v1");
  });

  it("advances two search pages by returned rows through the CLI-owned cursor", async () => {
    const workspaceRoot = await mkdtemp(path.join(os.tmpdir(), "exo-cli-cursor-"));
    const resultPaths = ["a.md", "b.md", "c.md", "d.md"].map((name) => path.join(workspaceRoot, name));
    const offsets: number[] = [];
    const pagingClient = {
      ...client,
      search: async (query: string, options: { limit?: number; offset?: number } = {}) => {
        const limit = options.limit ?? 2;
        const offset = options.offset ?? 0;
        offsets.push(offset);
        const results = resultPaths.slice(offset, offset + limit).map((filePath, index) => ({
          filePath,
          title: path.basename(filePath, ".md"),
          snippet: "",
          score: 1 - (offset + index) / 10,
          source: "qmd" as const,
        }));
        return {
          query,
          mode: "lexical" as const,
          source: "qmd" as const,
          warnings: [],
          results,
          hasMore: resultPaths.length > offset + results.length,
        };
      },
    };
    const env = {
      ...process.env,
      EXO_WORKSPACE_ROOT: workspaceRoot,
      EXO_NOTE_ROOTS: workspaceRoot,
      EXO_PROJECT_ROOTS: "",
    };

    try {
      let firstOutput = "";
      await runCli(["node", "exo", "search", "result", "--limit", "2"], {
        env,
        stdout: { write: (text) => { firstOutput += text; } },
        stderr: { write: () => {} },
        connectAppClient: async () => pagingClient,
      });
      const firstPage = JSON.parse(firstOutput) as {
        page: { returned: number; next_cursor: string | null };
        results: Array<{ path: string }>;
      };
      expect(firstPage.page).toMatchObject({ returned: 2, next_cursor: expect.any(String) });

      let secondOutput = "";
      await runCli(["node", "exo", "search", "result", "--limit", "2", "--cursor", firstPage.page.next_cursor!], {
        env,
        stdout: { write: (text) => { secondOutput += text; } },
        stderr: { write: () => {} },
        connectAppClient: async () => pagingClient,
      });
      const secondPage = JSON.parse(secondOutput) as {
        page: { returned: number; next_cursor: string | null };
        results: Array<{ path: string }>;
      };

      expect(offsets).toEqual([0, 2]);
      expect(firstPage.results.map((result) => result.path)).toEqual(resultPaths.slice(0, 2));
      expect(secondPage.results.map((result) => result.path)).toEqual(resultPaths.slice(2));
      expect(secondPage.page).toEqual({ limit: 2, returned: 2, next_cursor: null });
      expect(new Set([...firstPage.results, ...secondPage.results].map((result) => result.path)).size).toBe(4);
    } finally {
      await rm(workspaceRoot, { recursive: true, force: true });
    }
  });

  it("rejects deleted families instead of preserving aliases", async () => {
    for (const command of ["read", "spawn", "preview", "config", "terminals"]) {
      await expect(runCli(["node", "exo", command], { stderr: { write: () => {} }, connectAppClient: connect })).rejects.toThrow("Usage:");
    }
  });

  it("starts the installed macOS app through the explicit bootstrap command", async () => {
    const home = await mkdtemp(path.join(os.tmpdir(), "exo-cli-start-"));
    const appPath = path.join(home, "Exo.app");
    await mkdir(appPath);
    let launchedPath = "";

    try {
      const exitCode = await runCli(["node", "exo", "start"], {
        env: { ...process.env, HOME: home, EXO_APP_PATH: appPath },
        stderr: { write: () => {} },
        launchApp: async (target) => { launchedPath = target; },
      });

      expect(exitCode).toBe(0);
      expect(launchedPath).toBe(appPath);
    } finally {
      await rm(home, { recursive: true, force: true });
    }
  });

  it("keeps status and search useful when the resident app is unavailable", async () => {
    const workspaceRoot = await mkdtemp(path.join(os.tmpdir(), "exo-cli-offline-"));
    const noteRoot = path.join(workspaceRoot, "notes");
    const notePath = path.join(noteRoot, "orientation.md");
    await mkdir(noteRoot);
    await writeFile(notePath, "# Orientation\n\nThe local-first workspace.\n", "utf8");
    const env = {
      ...process.env,
      EXO_WORKSPACE_ROOT: workspaceRoot,
      EXO_NOTE_ROOTS: noteRoot,
      EXO_PROJECT_ROOTS: "",
      EXO_USER_DATA_PATH: path.join(workspaceRoot, "user-data"),
    };
    let discoveredRuntimeRoot = "";
    const unavailable = async (runtimeRoot: string) => {
      discoveredRuntimeRoot = runtimeRoot;
      return null;
    };

    try {
      let output = "";
      const options = {
        env,
        stdout: { write: (text: string) => { output += text; } },
        stderr: { write: () => {} },
        connectAppClient: unavailable,
      };
      expect(await runCli(["node", "exo", "status"], options)).toBe(0);
      expect(await runCli(["node", "exo", "search", "local-first"], options)).toBe(0);

      expect(output).toContain('"available": false');
      expect(output).not.toContain("projectRoots");
      expect(output).toContain("orientation.md");
      expect(output).toContain('"path"');
      expect(discoveredRuntimeRoot).toBe(path.join(workspaceRoot, ".exo"));
    } finally {
      await rm(workspaceRoot, { recursive: true, force: true });
    }
  });
});
