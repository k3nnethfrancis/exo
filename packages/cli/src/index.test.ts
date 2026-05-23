import { describe, expect, it } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { runCli } from "./index";
import { saveWorkspaceSettings } from "@exo/core";

describe("cli package", () => {
  it("renders runtime status", async () => {
    let stdout = "";
    const exitCode = await runCli(["node", "exo-cli", "runtime", "status"], {
      env: {
        EXO_WORKSPACE_ROOT: "/tmp/exo-test-workspace",
        EXO_NOTE_ROOTS: "/tmp/exo-test-workspace/notes",
        EXO_PROJECT_ROOTS: "/tmp/exo-test-workspace/projects",
      },
      stdout: {
        write: (text) => {
          stdout += text;
        },
      },
      stderr: {
        write: () => {},
      },
    });

    expect(exitCode).toBe(0);
    expect(stdout).toContain('"workspaceRoot": "/tmp/exo-test-workspace"');
    expect(stdout).toContain('"kind": "qmd"');
  });

  it("uses the active workspace registry when env does not override workspace paths", async () => {
    const userDataPath = await mkdtemp(path.join(os.tmpdir(), "exo-cli-workspace-registry-"));
    let stdout = "";

    try {
      await saveWorkspaceSettings({
        workspaceRoot: "/tmp/exo-active/notes",
        defaultTerminalCwd: "/tmp/exo-active/project",
        noteRoots: ["/tmp/exo-active/notes"],
        projectRoots: ["/tmp/exo-active/project"],
        indexedRoots: [],
        indexing: { enabled: false, mode: "off", backend: "qmd" },
        appearanceMode: "system",
        editorFontSize: 15,
        terminalFontSize: 13,
        terminalHistoryMode: "full",
        terminalHistoryLines: 1_000_000,
        terminalTranscriptRetention: "forever",
        terminalTranscriptRetentionDays: 14,
        terminalStreamingMode: "visible",
        explorerScale: 1,
        exploreIndexSearchOnEnter: false,
        indexUpdateStrategy: "on-save",
      }, { EXO_USER_DATA_PATH: userDataPath });

      const exitCode = await runCli(["node", "exo-cli", "runtime", "status"], {
        env: { EXO_USER_DATA_PATH: userDataPath },
        stdout: { write: (text) => { stdout += text; } },
        stderr: { write: () => {} },
      });

      expect(exitCode).toBe(0);
      expect(stdout).toContain('"workspaceRoot": "/tmp/exo-active/notes"');
      expect(stdout).toContain('"defaultTerminalCwd": "/tmp/exo-active/project"');
    } finally {
      await rm(userDataPath, { recursive: true, force: true });
    }
  });

  it("renders a launch plan for Claude", async () => {
    let stdout = "";
    const exitCode = await runCli(["node", "exo-cli", "runtime", "launch-plan", "claude", "/tmp/exo-test-workspace/projects/helm"], {
      env: {
        EXO_WORKSPACE_ROOT: "/tmp/exo-test-workspace",
        EXO_NOTE_ROOTS: "/tmp/exo-test-workspace/notes",
        EXO_PROJECT_ROOTS: "/tmp/exo-test-workspace/projects",
      },
      stdout: {
        write: (text) => {
          stdout += text;
        },
      },
      stderr: {
        write: () => {},
      },
    });

    expect(exitCode).toBe(0);
    expect(stdout).toContain('"kind": "claude"');
    expect(stdout).toContain('"/tmp/exo-test-workspace/projects/helm"');
    expect(stdout).toContain('"EXO_RUNTIME_PRIMARY_INSTRUCTIONS"');
  });

  it("syncs runtime instruction files", async () => {
    let stdout = "";
    const exitCode = await runCli(["node", "exo-cli", "runtime", "sync"], {
      env: {
        EXO_WORKSPACE_ROOT: "/tmp/exo-test-workspace",
        EXO_NOTE_ROOTS: "/tmp/exo-test-workspace/notes",
        EXO_PROJECT_ROOTS: "/tmp/exo-test-workspace/projects",
      },
      stdout: {
        write: (text) => {
          stdout += text;
        },
      },
      stderr: {
        write: () => {},
      },
    });

    expect(exitCode).toBe(0);
    expect(stdout).toContain('"/tmp/exo-test-workspace/.exo/instructions/AGENTS.md"');
    expect(stdout).toContain('"/tmp/exo-test-workspace/.exo/instructions/CLAUDE.md"');
  });

  it("launches a shell with Exo runtime env", async () => {
    let stdout = "";
    const exitCode = await runCli(["node", "exo-cli", "launch", "shell", "/tmp"], {
      env: {
        EXO_WORKSPACE_ROOT: "/tmp/exo-test-workspace",
        EXO_NOTE_ROOTS: "/tmp/exo-test-workspace/notes",
        EXO_PROJECT_ROOTS: "/tmp/exo-test-workspace/projects",
        EXO_SHELL: "/bin/sh",
        EXO_SHELL_ARGS: `-c,printf '%s' "$EXO_AGENT_KIND|$PWD|$EXO_RUNTIME_PRIMARY_INSTRUCTIONS"`,
      },
      stdout: {
        write: (text) => {
          stdout += text;
        },
      },
      stderr: {
        write: () => {},
      },
    });

    expect(exitCode).toBe(0);
    expect(stdout).toContain("shell|");
    expect(stdout).toContain("|/tmp/exo-test-workspace/.exo/instructions/AGENTS.md");
  });

  it("submits agent messages by default", async () => {
    let receivedData = "";
    const exitCode = await runCli(["node", "exo-cli", "agents", "send", "term-1", "hello"], {
      env: testRuntimeEnv(),
      stdout: { write: () => {} },
      stderr: { write: () => {} },
      connectAppClient: async () => fakeAppClient({
        writeTerminal: async (_id, data) => {
          receivedData = data;
        },
      }),
    });

    expect(exitCode).toBe(0);
    expect(receivedData).toBe("hello\r");
  });

  it("passes search limits through the app route", async () => {
    let receivedQuery = "";
    let receivedLimit: number | undefined;
    let stdout = "";

    const exitCode = await runCli(["node", "exo-cli", "search", "roleplay", "--limit", "7"], {
      env: testRuntimeEnv(),
      stdout: { write: (text) => { stdout += text; } },
      stderr: { write: () => {} },
      connectAppClient: async () => fakeAppClient({
        search: async (query, options) => {
          receivedQuery = query;
          receivedLimit = options?.limit;
          return { source: "qmd", results: [] };
        },
      }),
    });

    expect(exitCode).toBe(0);
    expect(receivedQuery).toBe("roleplay");
    expect(receivedLimit).toBe(7);
    expect(stdout).toContain('"source": "qmd"');
  });

  it("calls the app for index status", async () => {
    const client = fakeAppClient({
      getIndexStatus: async () => ({ enabled: true, mode: "hybrid", backend: "qmd" }),
      syncIndex: async () => ({ status: { enabled: true, mode: "hybrid", backend: "qmd" }, phases: [] }),
    });
    let stdout = "";

    const exitCode = await runCli(["node", "exo-cli", "index", "status"], {
      env: testRuntimeEnv(),
      stdout: { write: (text) => { stdout += text; } },
      stderr: { write: () => {} },
      connectAppClient: async () => client,
    });

    expect(exitCode).toBe(0);
    expect(stdout).toContain('"mode": "hybrid"');

    stdout = "";
    const syncExitCode = await runCli(["node", "exo-cli", "index", "sync"], {
      env: testRuntimeEnv(),
      stdout: { write: (text) => { stdout += text; } },
      stderr: { write: () => {} },
      connectAppClient: async () => client,
    });
    expect(syncExitCode).toBe(0);
    expect(stdout).toContain('"phases": []');
  });

  it("adds index roots through the app settings route", async () => {
    let receivedInput: Record<string, unknown> | null = null;
    const exitCode = await runCli(["node", "exo-cli", "index", "add", "notes", "--name", "notes", "--kind", "notes"], {
      env: testRuntimeEnv(),
      cwd: "/tmp/exo-test-workspace",
      stdout: { write: () => {} },
      stderr: { write: () => {} },
      connectAppClient: async () => fakeAppClient({
        addIndexRoot: async (input) => {
          receivedInput = input;
          return { ok: true };
        },
      }),
    });

    expect(exitCode).toBe(0);
    expect(receivedInput).toMatchObject({ path: "/tmp/exo-test-workspace/notes", name: "notes", kind: "notes" });
  });

  it("prints Codex integration config", async () => {
    let stdout = "";
    const exitCode = await runCli(["node", "exo-cli", "integrations", "config", "codex"], {
      env: {
        EXO_PROJECT_ROOT: "/tmp/exo-test-workspace/projects/exo",
        EXO_WORKSPACE_ROOT: "/tmp/exo-test-workspace",
      },
      stdout: {
        write: (text) => {
          stdout += text;
        },
      },
      stderr: {
        write: () => {},
      },
    });

    expect(exitCode).toBe(0);
    expect(stdout).toContain("codex mcp add exo");
    expect(stdout).toContain("EXO_MCP_AUTOSTART");
    expect(stdout).toContain("packages/mcp/bin/exo-mcp.mjs");
  });

  it("prints Claude integration config", async () => {
    let stdout = "";
    const exitCode = await runCli(["node", "exo-cli", "integrations", "config", "claude"], {
      env: {
        EXO_PROJECT_ROOT: "/tmp/exo-test-workspace/projects/exo",
        EXO_WORKSPACE_ROOT: "/tmp/exo-test-workspace",
      },
      stdout: {
        write: (text) => {
          stdout += text;
        },
      },
      stderr: {
        write: () => {},
      },
    });

    expect(exitCode).toBe(0);
    expect(stdout).toContain("claude mcp add-json --scope user");
    expect(stdout).toContain("EXO_MCP_START_COMMAND");
  });

  it("runs integration doctor with mocked command checks", async () => {
    let stdout = "";
    const exitCode = await runCli(["node", "exo-cli", "integrations", "doctor"], {
      env: {
        EXO_PROJECT_ROOT: "/tmp/exo-test-workspace/projects/exo",
        EXO_WORKSPACE_ROOT: "/tmp/exo-test-workspace",
      },
      stdout: {
        write: (text) => {
          stdout += text;
        },
      },
      stderr: {
        write: () => {},
      },
      runCommand: async (command, args) => {
        if (command === "/bin/sh" && args.join(" ").includes("codex")) {
          return { code: 0, stdout: "/opt/bin/codex\n", stderr: "" };
        }
        if (command === "/bin/sh" && args.join(" ").includes("claude")) {
          return { code: 0, stdout: "/opt/bin/claude\n", stderr: "" };
        }
        if (command === "/bin/sh" && args.join(" ").includes("pnpm")) {
          return { code: 0, stdout: "/opt/bin/pnpm\n", stderr: "" };
        }
        if (command === "codex") {
          return { code: 0, stdout: "exo pnpm --dir /tmp/exo-test-workspace/projects/exo\n", stderr: "" };
        }
        if (command === "claude") {
          return { code: 0, stdout: "qmd: qmd mcp\n", stderr: "" };
        }
        return { code: 1, stdout: "", stderr: "unexpected command" };
      },
    });

    expect(exitCode).toBe(0);
    expect(stdout).toContain("- pnpm: found");
    expect(stdout).toContain("- codex: found (/opt/bin/codex); Exo MCP configured");
    expect(stdout).toContain("- claude: found (/opt/bin/claude); Exo MCP not configured");
  });

  it("dry-runs integration install without spawning native installers", async () => {
    let stdout = "";
    const calls: string[] = [];
    const exitCode = await runCli(["node", "exo-cli", "integrations", "install", "--dry-run", "all"], {
      env: {
        EXO_PROJECT_ROOT: "/tmp/exo-test-workspace/projects/exo",
        EXO_WORKSPACE_ROOT: "/tmp/exo-test-workspace",
      },
      stdout: {
        write: (text) => {
          stdout += text;
        },
      },
      stderr: {
        write: () => {},
      },
      runCommand: async (command, args) => {
        calls.push([command, ...args].join(" "));
        return { code: 1, stdout: "", stderr: "should not be called" };
      },
    });

    expect(exitCode).toBe(0);
    expect(calls).toEqual([]);
    expect(stdout).toContain("[dry-run] codex mcp add exo");
    expect(stdout).toContain("[dry-run] claude mcp add-json --scope user");
  });
});

function testRuntimeEnv(): NodeJS.ProcessEnv {
  return {
    EXO_WORKSPACE_ROOT: "/tmp/exo-test-workspace",
    EXO_NOTE_ROOTS: "/tmp/exo-test-workspace/notes",
    EXO_PROJECT_ROOTS: "/tmp/exo-test-workspace/projects",
    EXO_RUNTIME_ROOT: "/tmp/exo-test-workspace/.exo-test-runtime",
    EXO_SETTINGS_PATH: "/tmp/exo-test-workspace/settings.json",
    EXO_APP_CLIENT_REQUEST_TIMEOUT_MS: "500",
  };
}

function fakeAppClient(overrides: Partial<{
  getStatus: () => Promise<Record<string, unknown>>;
  openFile: (filePath: string) => Promise<void>;
  showWindow: () => Promise<void>;
  getConfig: () => Promise<Record<string, unknown>>;
  search: (query: string, options?: { limit?: number }) => Promise<Record<string, unknown>>;
  readDocument: (target: string, options?: { fromLine?: number; maxLines?: number }) => Promise<Record<string, unknown>>;
  getIndexStatus: () => Promise<Record<string, unknown>>;
  syncIndex: () => Promise<Record<string, unknown>>;
  addIndexRoot: (input: { path: string; name?: string; kind?: string; pattern?: string; force?: boolean }) => Promise<Record<string, unknown>>;
  removeIndexRoot: (target: string) => Promise<Record<string, unknown>>;
  updateIndex: () => Promise<Record<string, unknown>>;
  embedIndex: () => Promise<Record<string, unknown>>;
  listTerminals: () => Promise<unknown[]>;
  createTerminal: (kind: string, cwd?: string) => Promise<Record<string, unknown>>;
  readTerminal: (id: string) => Promise<string>;
  readTerminalTranscript: (id: string, tailChars?: number) => Promise<string>;
  writeTerminal: (id: string, data: string) => Promise<void>;
  killTerminal: (id: string) => Promise<void>;
}> = {}) {
  const missing = async () => {
    throw new Error("Unexpected app client call");
  };
  return {
    getStatus: missing,
    openFile: missing,
    showWindow: missing,
    getConfig: missing,
    search: missing,
    readDocument: missing,
    getIndexStatus: missing,
    syncIndex: missing,
    addIndexRoot: missing,
    removeIndexRoot: missing,
    updateIndex: missing,
    embedIndex: missing,
    listTerminals: missing,
    createTerminal: missing,
    readTerminal: missing,
    readTerminalTranscript: missing,
    writeTerminal: missing,
    killTerminal: missing,
    ...overrides,
  };
}
