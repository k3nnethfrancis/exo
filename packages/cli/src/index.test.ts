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
    let receivedMessage = "";
    let receivedSubmit: boolean | undefined;
    const exitCode = await runCli(["node", "exo-cli", "agents", "send", "term-1", "hello"], {
      env: testRuntimeEnv(),
      stdout: { write: () => {} },
      stderr: { write: () => {} },
      connectAppClient: async () => fakeAppClient({
        sendTerminalMessage: async (_id, message, submit) => {
          receivedMessage = message;
          receivedSubmit = submit;
          return { ok: true as const, delivery: "sent" as const };
        },
      }),
    });

    expect(exitCode).toBe(0);
    expect(receivedMessage).toBe("hello");
    expect(receivedSubmit).toBe(true);
  });

  it("preserves whitespace in submitted agent messages", async () => {
    let receivedMessage = "";
    const message = "Please review this carefully.\nKeep spaces   and punctuation.";
    const exitCode = await runCli(["node", "exo-cli", "agents", "send", "term-1", message], {
      env: testRuntimeEnv(),
      stdout: { write: () => {} },
      stderr: { write: () => {} },
      connectAppClient: async () => fakeAppClient({
        sendTerminalMessage: async (_id, nextMessage) => {
          receivedMessage = nextMessage;
          return { ok: true as const, delivery: "sent" as const };
        },
      }),
    });

    expect(exitCode).toBe(0);
    expect(receivedMessage).toBe(message);
  });

  it("sends semantic messages without submitting when requested", async () => {
    let receivedMessage = "";
    let receivedSubmit: boolean | undefined;
    const exitCode = await runCli(["node", "exo-cli", "agents", "send", "term-1", "draft   text", "--no-submit"], {
      env: testRuntimeEnv(),
      stdout: { write: () => {} },
      stderr: { write: () => {} },
      connectAppClient: async () => fakeAppClient({
        sendTerminalMessage: async (_id, message, submit) => {
          receivedMessage = message;
          receivedSubmit = submit;
          return { ok: true as const, delivery: "sent" as const };
        },
      }),
    });

    expect(exitCode).toBe(0);
    expect(receivedMessage).toBe("draft   text");
    expect(receivedSubmit).toBe(false);
  });

  it("keeps raw terminal writes separate from semantic agent messages", async () => {
    let rawInput = "";
    let semanticCalled = false;
    const exitCode = await runCli(["node", "exo-cli", "agents", "send", "term-1", "y", "--raw"], {
      env: testRuntimeEnv(),
      stdout: { write: () => {} },
      stderr: { write: () => {} },
      connectAppClient: async () => fakeAppClient({
        writeTerminal: async (_id, data) => {
          rawInput = data;
          return { ok: true as const, delivery: "sent" as const };
        },
        sendTerminalMessage: async () => {
          semanticCalled = true;
          return { ok: true as const, delivery: "sent" as const };
        },
      }),
    });

    expect(exitCode).toBe(0);
    expect(rawInput).toBe("y");
    expect(semanticCalled).toBe(false);
  });

  it("reports when agent messages are queued behind startup readiness", async () => {
    let stdout = "";
    const exitCode = await runCli(["node", "exo-cli", "agents", "send", "term-1", "hello"], {
      env: testRuntimeEnv(),
      stdout: { write: (text) => { stdout += text; } },
      stderr: { write: () => {} },
      connectAppClient: async () => fakeAppClient({
        sendTerminalMessage: async () => ({ ok: true as const, delivery: "queued" as const, queuedInputCount: 1 }),
      }),
    });

    expect(exitCode).toBe(0);
    expect(stdout).toContain("Queued message for term-1");
  });

  it("keeps deprecated agent message aliases working with warnings", async () => {
    const calls: string[] = [];
    let stderr = "";
    const client = fakeAppClient({
      sendTerminalMessage: async (_id, message) => {
        calls.push(message);
        return { ok: true as const, delivery: "sent" as const };
      },
    });

    const messageExitCode = await runCli(["node", "exo-cli", "agents", "message", "term-1", "hello"], {
      env: testRuntimeEnv(),
      stdout: { write: () => {} },
      stderr: { write: (text) => { stderr += text; } },
      connectAppClient: async () => client,
    });
    const tellExitCode = await runCli(["node", "exo-cli", "agents", "tell", "term-1", "again"], {
      env: testRuntimeEnv(),
      stdout: { write: () => {} },
      stderr: { write: (text) => { stderr += text; } },
      connectAppClient: async () => client,
    });

    expect(messageExitCode).toBe(0);
    expect(tellExitCode).toBe(0);
    expect(calls).toEqual(["hello", "again"]);
    expect(stderr.match(/Deprecated: use exo agents send <id> <message> instead\./g)).toHaveLength(2);
  });

  it("prints agents create help without connecting to the app", async () => {
    let stdout = "";
    let connected = false;

    const exitCode = await runCli(["node", "exo-cli", "agents", "create", "--help"], {
      env: testRuntimeEnv(),
      stdout: { write: (text) => { stdout += text; } },
      stderr: { write: () => {} },
      connectAppClient: async () => {
        connected = true;
        return fakeAppClient();
      },
    });

    expect(exitCode).toBe(0);
    expect(connected).toBe(false);
    expect(stdout).toContain("Usage: exo agents create <shell|claude|codex> [cwd]");
  });

  it("prints provider-specific agents create help without creating a terminal", async () => {
    let stdout = "";
    let created = false;

    const exitCode = await runCli(["node", "exo-cli", "agents", "create", "codex", "--help"], {
      env: testRuntimeEnv(),
      stdout: { write: (text) => { stdout += text; } },
      stderr: { write: () => {} },
      connectAppClient: async () => fakeAppClient({
        createTerminal: async () => {
          created = true;
          return { id: "term-1" };
        },
      }),
    });

    expect(exitCode).toBe(0);
    expect(created).toBe(false);
    expect(stdout).toContain("Usage: exo agents create <shell|claude|codex> [cwd]");
  });

  it("rejects option-shaped agent create cwd values without creating a terminal", async () => {
    let created = false;

    await expect(runCli(["node", "exo-cli", "agents", "create", "codex", "--unexpected"], {
      env: testRuntimeEnv(),
      stdout: { write: () => {} },
      stderr: { write: () => {} },
      connectAppClient: async () => fakeAppClient({
        createTerminal: async () => {
          created = true;
          return { id: "term-1" };
        },
      }),
    })).rejects.toThrow("Invalid cwd for exo agents create: --unexpected");

    expect(created).toBe(false);
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

  it("manages project roots through the app settings route", async () => {
    const calls: Array<[string, string?]> = [];
    let stdout = "";
    const client = fakeAppClient({
      listProjectRoots: async () => ["/tmp/exo-test-workspace/projects/sample"],
      addProjectRoot: async (targetPath) => {
        calls.push(["add", targetPath]);
        return { projectRoots: [targetPath] };
      },
      removeProjectRoot: async (target) => {
        calls.push(["remove", target]);
        return { projectRoots: [] };
      },
    });

    const listExitCode = await runCli(["node", "exo-cli", "project-roots", "list"], {
      env: testRuntimeEnv(),
      stdout: { write: (text) => { stdout += text; } },
      stderr: { write: () => {} },
      connectAppClient: async () => client,
    });
    expect(listExitCode).toBe(0);
    expect(stdout).toContain("/tmp/exo-test-workspace/projects/sample");

    const addExitCode = await runCli(["node", "exo-cli", "project-roots", "add", "projects/new-root"], {
      env: testRuntimeEnv(),
      cwd: "/tmp/exo-test-workspace",
      stdout: { write: () => {} },
      stderr: { write: () => {} },
      connectAppClient: async () => client,
    });
    expect(addExitCode).toBe(0);

    const removeExitCode = await runCli(["node", "exo-cli", "project-roots", "remove", "projects/new-root"], {
      env: testRuntimeEnv(),
      cwd: "/tmp/exo-test-workspace",
      stdout: { write: () => {} },
      stderr: { write: () => {} },
      connectAppClient: async () => client,
    });
    expect(removeExitCode).toBe(0);
    expect(calls).toEqual([
      ["add", "/tmp/exo-test-workspace/projects/new-root"],
      ["remove", "/tmp/exo-test-workspace/projects/new-root"],
    ]);
  });

  it("keeps terminals commands available for operator debugging", async () => {
    const calls: string[] = [];
    let stdout = "";
    const client = fakeAppClient({
      terminalDiagnostics: async () => [{ id: "term-1", health: "healthy" }],
      writeTerminal: async (_id, data) => {
        calls.push(data);
        return { ok: true as const, delivery: "sent" as const };
      },
    });

    const diagnosticsExitCode = await runCli(["node", "exo-cli", "terminals", "diagnostics"], {
      env: testRuntimeEnv(),
      stdout: { write: (text) => { stdout += text; } },
      stderr: { write: () => {} },
      connectAppClient: async () => client,
    });
    const sendExitCode = await runCli(["node", "exo-cli", "terminals", "send", "term-1", "raw command"], {
      env: testRuntimeEnv(),
      stdout: { write: () => {} },
      stderr: { write: () => {} },
      connectAppClient: async () => client,
    });

    expect(diagnosticsExitCode).toBe(0);
    expect(sendExitCode).toBe(0);
    expect(stdout).toContain('"health": "healthy"');
    expect(calls).toEqual(["raw command\n"]);
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
  listProjectRoots: () => Promise<string[]>;
  addProjectRoot: (projectRootPath: string) => Promise<Record<string, unknown>>;
  removeProjectRoot: (target: string) => Promise<Record<string, unknown>>;
  search: (query: string, options?: { limit?: number }) => Promise<Record<string, unknown>>;
  readDocument: (target: string, options?: { fromLine?: number; maxLines?: number }) => Promise<Record<string, unknown>>;
  getIndexStatus: () => Promise<Record<string, unknown>>;
  syncIndex: () => Promise<Record<string, unknown>>;
  addIndexRoot: (input: { path: string; name?: string; kind?: string; pattern?: string; force?: boolean }) => Promise<Record<string, unknown>>;
  removeIndexRoot: (target: string) => Promise<Record<string, unknown>>;
  updateIndex: () => Promise<Record<string, unknown>>;
  embedIndex: () => Promise<Record<string, unknown>>;
  listTerminals: () => Promise<unknown[]>;
  terminalDiagnostics: () => Promise<unknown[]>;
  createTerminal: (kind: string, cwd?: string) => Promise<Record<string, unknown>>;
  readTerminal: (id: string) => Promise<string>;
  readTerminalTranscript: (id: string, tailChars?: number) => Promise<string>;
  writeTerminal: (id: string, data: string) => Promise<{ ok: true; delivery: "sent" | "queued" | "not-found"; queuedInputCount?: number }>;
  sendTerminalMessage: (id: string, message: string, submit?: boolean) => Promise<{ ok: true; delivery: "sent" | "queued" | "not-found"; queuedInputCount?: number }>;
  killTerminal: (id: string) => Promise<void>;
}> = {}) {
  const missing = async (..._args: unknown[]) => {
    throw new Error("Unexpected app client call");
  };
  return {
    getStatus: missing,
    openFile: missing,
    showWindow: missing,
    getConfig: missing,
    listProjectRoots: missing,
    addProjectRoot: missing,
    removeProjectRoot: missing,
    search: missing,
    readDocument: missing,
    getIndexStatus: missing,
    syncIndex: missing,
    addIndexRoot: missing,
    removeIndexRoot: missing,
    updateIndex: missing,
    embedIndex: missing,
    listTerminals: missing,
    terminalDiagnostics: missing,
    createTerminal: missing,
    readTerminal: missing,
    readTerminalTranscript: missing,
    writeTerminal: async (...args: [string, string]) => {
      await missing(...args);
      return { ok: true as const, delivery: "not-found" as const };
    },
    sendTerminalMessage: async (...args: [string, string, boolean?]) => {
      await missing(...args);
      return { ok: true as const, delivery: "not-found" as const };
    },
    killTerminal: missing,
    ...overrides,
  };
}
