import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  saveWorkspaceSettings,
  type WorkspaceSettings,
  type ExoCommandIndexStatusResponse,
  type ExoCommandIndexSyncResponse,
  type ExoCommandSearchResponse,
  type ExoCommandStatusWithControlPlane,
  type ExoSpawnAgentCommandResponse,
} from "@exo/core";
import { EXO_CLI_COMMANDS } from "@exo/core/operator-help";
import { AppClient } from "./app-client";
import { runCli } from "./index";

const client = {
  getStatus: async (): Promise<ExoCommandStatusWithControlPlane> => statusResponse(),
  showWindow: async () => {},
  search: async (query: string): Promise<ExoCommandSearchResponse> => ({ query, mode: "lexical", source: "filesystem", warnings: [], results: [] }),
  getIndexStatus: async (): Promise<ExoCommandIndexStatusResponse> => indexStatusResponse(),
  syncIndex: async (): Promise<ExoCommandIndexSyncResponse> => ({ status: indexStatusResponse(), phases: [], warnings: [] }),
  openFile: async () => {},
  spawnAgentCommand: async (): Promise<ExoSpawnAgentCommandResponse> => spawnResponse(),
} satisfies Pick<AppClient, "getStatus" | "showWindow" | "search" | "getIndexStatus" | "syncIndex" | "openFile" | "spawnAgentCommand">;
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

  it("advances through page six and offset 100 with the CLI-owned cursor", async () => {
    const workspaceRoot = await mkdtemp(path.join(os.tmpdir(), "exo-cli-cursor-"));
    const resultPaths = Array.from({ length: 120 }, (_, index) =>
      path.join(workspaceRoot, `result-${String(index).padStart(3, "0")}.md`));
    const offsets: number[] = [];
    const pagingClient = {
      ...client,
      search: async (query: string, options: { limit?: number; offset?: number } = {}): Promise<ExoCommandSearchResponse> => {
        const limit = options.limit ?? 20;
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
    } satisfies typeof client;
    const env = {
      ...process.env,
      EXO_WORKSPACE_ROOT: workspaceRoot,
      EXO_NOTE_ROOTS: workspaceRoot,
    };

    try {
      let cursor: string | null = null;
      const seenPaths: string[] = [];
      for (let pageIndex = 0; pageIndex < 6; pageIndex += 1) {
        let output = "";
        await runCli([
          "node",
          "exo",
          "search",
          "result",
          "--limit",
          "20",
          ...(cursor ? ["--cursor", cursor] : []),
        ], {
          env,
          stdout: { write: (text) => { output += text; } },
          stderr: { write: () => {} },
          connectAppClient: async () => pagingClient,
        });
        const page = JSON.parse(output) as {
          page: { returned: number; next_cursor: string | null };
          results: Array<{ path: string }>;
        };
        seenPaths.push(...page.results.map((result) => result.path));
        cursor = page.page.next_cursor;
        expect(page.page.returned).toBe(20);
        expect(page.page.next_cursor).toEqual(pageIndex === 5 ? null : expect.any(String));
      }

      expect(offsets).toEqual([0, 20, 40, 60, 80, 100]);
      expect(seenPaths).toEqual(resultPaths);
      expect(new Set(seenPaths).size).toBe(120);
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
      expect(output).toContain("orientation.md");
      expect(output).toContain('"path"');
      expect(discoveredRuntimeRoot).toBe(path.join(workspaceRoot, ".exo"));
    } finally {
      await rm(workspaceRoot, { recursive: true, force: true });
    }
  });

  it("lists saved Workspaces and searches a selected inactive Workspace without changing the active one", async () => {
    const userDataPath = await mkdtemp(path.join(os.tmpdir(), "exo-cli-workspaces-"));
    const alpha = path.join(userDataPath, "alpha");
    const beta = path.join(userDataPath, "beta");
    await mkdir(alpha);
    await mkdir(beta);
    await writeFile(path.join(alpha, "alpha.md"), "# Alpha\n\nIndependent repository context.\n", "utf8");
    await writeFile(path.join(beta, "beta.md"), "# Beta\n\nActive personal context.\n", "utf8");
    const env = { ...process.env, EXO_USER_DATA_PATH: userDataPath };
    await saveWorkspaceSettings(workspaceSettings(alpha), env);
    await saveWorkspaceSettings(workspaceSettings(beta), env);
    const run = async (argv: string[]) => {
      let output = "";
      await runCli(["node", "exo", ...argv], {
        env,
        stdout: { write: (text) => { output += text; } },
        stderr: { write: () => {} },
        connectAppClient: async () => {
          throw new Error("An explicitly selected Workspace must not use the active app client.");
        },
      });
      return JSON.parse(output);
    };

    try {
      const listed = await run(["workspaces"]);
      expect(listed).toMatchObject({
        schema_version: "exo.workspaces.v1",
        workspaces: [
          { label: "beta", active: true },
          { label: "alpha", active: false },
        ],
      });

      const status = await run(["status", "--workspace", "alpha"]);
      expect(status).toMatchObject({
        app: { available: false },
        workspace: { label: "alpha", root: alpha, active: false },
      });

      const search = await run(["search", "repository context", "--workspace", "alpha"]);
      expect(search).toMatchObject({
        schema_version: "exo.search.v1",
        scope: { workspace_root: alpha, note_roots: [alpha] },
        retrieval: { provider: "filesystem" },
        results: [{ path: path.join(alpha, "alpha.md") }],
      });
    } finally {
      await rm(userDataPath, { recursive: true, force: true });
    }
  });
});

function statusResponse(): ExoCommandStatusWithControlPlane {
  return {
    workspace: {
      workspaceRoot: "/workspace",
      defaultTerminalCwd: "/workspace",
      noteRoots: [],
      indexedRoots: [],
      indexing: { enabled: true, mode: "hybrid", backend: "qmd" },
      searchEngine: "qmd",
    },
    terminals: [],
    controlPlane: {
      runtimeRoot: "/workspace/.exo",
      serverJsonPath: "/workspace/.exo/server.json",
      pid: 123,
      port: 456,
      baseUrl: "http://127.0.0.1:456",
    },
  };
}

function indexStatusResponse(): ExoCommandIndexStatusResponse {
  return {
    enabled: true,
    mode: "hybrid",
    backend: "qmd",
    dbPath: "/workspace/.exo/index.sqlite",
    runtimePath: "/workspace/.exo",
    indexedRoots: [],
    documentCount: 0,
    pendingEmbeddings: 0,
    hasVectorIndex: false,
    lastUpdated: null,
    warnings: [],
    errors: [],
  };
}

function spawnResponse(): ExoSpawnAgentCommandResponse {
  return {
    ok: true,
    invocation: { id: "inv-1", status: "running", handle: "review", createdAt: "2026-07-24T00:00:00.000Z" },
    terminal: { id: "term-1", title: "Review", cwd: "/workspace", kind: "shell", status: "running" },
  };
}

function workspaceSettings(root: string): WorkspaceSettings {
  return {
    workspaceRoot: root,
    defaultTerminalCwd: root,
    noteRoots: [root],
    indexedRoots: [],
    indexing: { enabled: false, mode: "off", backend: "qmd" },
    appearanceMode: "system",
    colorThemeId: "exo-neutral",
    editorFontSize: 15,
    terminalFontSize: 13,
    explorerScale: 1,
    exploreIndexSearchOnEnter: false,
    indexUpdateStrategy: "on-save",
  };
}
