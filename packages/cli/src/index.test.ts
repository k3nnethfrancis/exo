import { describe, expect, it } from "vitest";
import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { runCli } from "./index";
import { formatManagedAgentKindUsage, saveWorkspaceSettings } from "@exo/core";

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

  it("prints actionable discovery diagnostics for live app commands", async () => {
    const runtimeRoot = await mkdtemp(path.join(os.tmpdir(), "exo-cli-discovery-"));
    let stderr = "";

    try {
      const exitCode = await runCli(["node", "exo-cli", "status"], {
        env: {
          EXO_WORKSPACE_ROOT: "/tmp/exo-test-workspace",
          EXO_RUNTIME_ROOT: runtimeRoot,
        },
        stdout: { write: () => {} },
        stderr: { write: (text) => { stderr += text; } },
      });

      expect(exitCode).toBe(1);
      expect(stderr).toContain("discovery file is missing");
      expect(stderr).toContain(`Runtime root: ${runtimeRoot}`);
      expect(stderr).toContain(`Discovery file: ${path.join(runtimeRoot, "server.json")}`);
      expect(stderr).toContain("exo start");
    } finally {
      await rm(runtimeRoot, { recursive: true, force: true });
    }
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
        colorThemeId: "exo-neutral",
        editorFontSize: 15,
        terminalFontSize: 13,
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

  it("uses persisted Pi-compatible harness settings for runtime status and launch plans", async () => {
    const userDataPath = await mkdtemp(path.join(os.tmpdir(), "exo-cli-pi-settings-"));
    const workspaceRoot = await mkdtemp(path.join(os.tmpdir(), "exo-cli-pi-workspace-"));
    const piRepo = await mkdtemp(path.join(os.tmpdir(), "exo-cli-pi-repo-"));
    const cliPath = path.join(piRepo, "packages", "coding-agent", "dist", "cli.js");
    let statusStdout = "";
    let planStdout = "";

    try {
      await mkdir(path.dirname(cliPath), { recursive: true });
      await writeFile(cliPath, "#!/usr/bin/env node\n", "utf8");
      await chmod(cliPath, 0o755);
      await saveWorkspaceSettings({
        workspaceRoot,
        defaultTerminalCwd: workspaceRoot,
        noteRoots: [path.join(workspaceRoot, "notes")],
        projectRoots: [],
        indexedRoots: [],
        indexing: { enabled: false, mode: "off", backend: "qmd" },
        appearanceMode: "system",
        colorThemeId: "exo-neutral",
        editorFontSize: 15,
        terminalFontSize: 13,
        terminalHistoryLines: 1_000_000,
        terminalTranscriptRetention: "forever",
        terminalTranscriptRetentionDays: 14,
        explorerScale: 1,
        exploreIndexSearchOnEnter: false,
        indexUpdateStrategy: "on-save",
        piHarness: {
          label: "Persisted Pi",
          repoPath: piRepo,
          backendUrl: "http://127.0.0.1:8080",
          backendLabel: "llama.cpp",
        },
      }, { EXO_USER_DATA_PATH: userDataPath });

      const statusExitCode = await runCli(["node", "exo-cli", "runtime", "status"], {
        env: { EXO_USER_DATA_PATH: userDataPath },
        stdout: { write: (text) => { statusStdout += text; } },
        stderr: { write: () => {} },
      });
      const planExitCode = await runCli(["node", "exo-cli", "runtime", "launch-plan", "pi", workspaceRoot], {
        env: { EXO_USER_DATA_PATH: userDataPath },
        stdout: { write: (text) => { planStdout += text; } },
        stderr: { write: () => {} },
      });

      expect(statusExitCode).toBe(0);
      expect(statusStdout).toContain('"label": "Persisted Pi"');
      expect(statusStdout).toContain('"launchable": true');
      expect(statusStdout).toContain('"label": "llama.cpp"');
      expect(planExitCode).toBe(0);
      expect(planStdout).toContain(`"cwd": "${workspaceRoot}"`);
      expect(planStdout).toMatch(/"command": ".*\/node"/);
      expect(planStdout).toContain(cliPath);
    } finally {
      await rm(userDataPath, { recursive: true, force: true });
      await rm(workspaceRoot, { recursive: true, force: true });
      await rm(piRepo, { recursive: true, force: true });
    }
  });

  it("lets Pi process env override persisted Pi-compatible harness settings", async () => {
    const userDataPath = await mkdtemp(path.join(os.tmpdir(), "exo-cli-pi-env-override-"));
    let stdout = "";

    try {
      await saveWorkspaceSettings({
        workspaceRoot: "/tmp/exo-pi-env/notes",
        defaultTerminalCwd: "/tmp/exo-pi-env",
        noteRoots: ["/tmp/exo-pi-env/notes"],
        projectRoots: [],
        indexedRoots: [],
        indexing: { enabled: false, mode: "off", backend: "qmd" },
        appearanceMode: "system",
        colorThemeId: "exo-neutral",
        editorFontSize: 15,
        terminalFontSize: 13,
        terminalHistoryLines: 1_000_000,
        terminalTranscriptRetention: "forever",
        terminalTranscriptRetentionDays: 14,
        explorerScale: 1,
        exploreIndexSearchOnEnter: false,
        indexUpdateStrategy: "on-save",
        piHarness: {
          label: "Persisted Pi",
          command: "/bin/sh",
          backendUrl: "http://127.0.0.1:8080",
        },
      }, { EXO_USER_DATA_PATH: userDataPath });

      const exitCode = await runCli(["node", "exo-cli", "runtime", "launch-plan", "pi"], {
        env: {
          EXO_USER_DATA_PATH: userDataPath,
          EXO_PI_LABEL: "Env Pi",
          EXO_PI_COMMAND: "/usr/bin/env",
        },
        stdout: { write: (text) => { stdout += text; } },
        stderr: { write: () => {} },
      });

      expect(exitCode).toBe(0);
      expect(stdout).toContain('"title": "Env Pi"');
      expect(stdout).toContain('"command": "/usr/bin/env"');
      expect(stdout).not.toContain('"title": "Persisted Pi"');
    } finally {
      await rm(userDataPath, { recursive: true, force: true });
    }
  });

  it("reads notes by paths relative to configured note roots", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "exo-cli-notes-read-"));
    let stdout = "";
    try {
      const notePath = path.join(root, "notes", "garden", "research", "ashby.md");
      await mkdir(path.dirname(notePath), { recursive: true });
      await writeFile(
        notePath,
        [
          "---",
          "title: Ashby Note",
          "---",
          "",
          "Relative note-root reads should find this body.",
          "",
        ].join("\n"),
        "utf8",
      );

      const exitCode = await runCli(["node", "exo-cli", "notes", "read", "garden/research/ashby.md"], {
        cwd: path.join(root, "project"),
        env: {
          EXO_WORKSPACE_ROOT: root,
          EXO_NOTE_ROOTS: path.join(root, "notes"),
          EXO_PROJECT_ROOTS: "",
        },
        stdout: { write: (text) => { stdout += text; } },
        stderr: { write: () => {} },
      });

      const document = JSON.parse(stdout);
      expect(exitCode).toBe(0);
      expect(document).toMatchObject({
        filePath: notePath,
        title: "Ashby Note",
      });
      expect(document.body).toContain("Relative note-root reads");
    } finally {
      await rm(root, { recursive: true, force: true });
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

  it("rejects direct Pi launch when its inference backend is missing", async () => {
    await expect(runCli(["node", "exo-cli", "launch", "pi", "/tmp"], {
      env: {
        EXO_WORKSPACE_ROOT: "/tmp/exo-test-workspace",
        EXO_NOTE_ROOTS: "/tmp/exo-test-workspace/notes",
        EXO_PROJECT_ROOTS: "/tmp/exo-test-workspace/projects",
        EXO_PI_COMMAND: "/bin/sh",
      },
      stdout: { write: () => {} },
      stderr: { write: () => {} },
    })).rejects.toThrow("Agent harness is not launchable: pi (Missing dependency).");
  });

  it("uses the core managed harness kind usage when rejecting invalid launches", async () => {
    await expect(runCli(["node", "exo-cli", "launch", "unknown"], {
      env: testRuntimeEnv(),
      stdout: { write: () => {} },
      stderr: { write: () => {} },
    })).rejects.toThrow(`Expected one of: ${formatManagedAgentKindUsage().replaceAll("|", ", ")}.`);
  });

  it("routes preview commands through the app client", async () => {
    const calls: string[] = [];
    const client = fakeAppClient({
      openPreview: async (target) => {
        calls.push(`open:${target}`);
        return { ok: true, url: target, source: "url" };
      },
      focusPreview: async () => {
        calls.push("focus");
        return { ok: true };
      },
      closePreview: async () => {
        calls.push("close");
        return { ok: true };
      },
    });

    const openExitCode = await runCli(["node", "exo-cli", "preview", "open", "http://localhost:3000"], {
      env: testRuntimeEnv(),
      stdout: { write: () => {} },
      stderr: { write: () => {} },
      connectAppClient: async () => client,
    });
    const focusExitCode = await runCli(["node", "exo-cli", "preview", "focus"], {
      env: testRuntimeEnv(),
      stdout: { write: () => {} },
      stderr: { write: () => {} },
      connectAppClient: async () => client,
    });
    const closeExitCode = await runCli(["node", "exo-cli", "preview", "close"], {
      env: testRuntimeEnv(),
      stdout: { write: () => {} },
      stderr: { write: () => {} },
      connectAppClient: async () => client,
    });

    expect(openExitCode).toBe(0);
    expect(focusExitCode).toBe(0);
    expect(closeExitCode).toBe(0);
    expect(calls).toEqual(["open:http://localhost:3000", "focus", "close"]);
  });

  it("routes proposal review commands through the app client", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "exo-cli-proposals-"));
    const proposalPath = path.join(root, "proposal.json");
    await writeFile(proposalPath, JSON.stringify({
      id: "proposal-1",
      status: "pending",
      provenance: { activityId: "activity-1" },
      items: [{ id: "create-1", kind: "fileCreate", path: "notes/new.md", contents: "# New\n", itemStatus: "pending" }],
    }), "utf8");
    const calls: string[] = [];
    const client = fakeAppClient({
      listProposals: async () => ({ proposals: [{ id: "proposal-1" }] }),
      readProposal: async (id) => {
        calls.push(`show:${id}`);
        return { proposal: { id } };
      },
      createProposal: async (proposal) => {
        calls.push(`create:${proposal.id}`);
        return { ok: true, proposal };
      },
      decideProposal: async (id, decision, itemId) => {
        calls.push(`${decision}:${id}:${itemId ?? ""}`);
        return { ok: true, proposal: { id, status: decision === "accept" ? "accepted" : "rejected" }, appliedItems: [] };
      },
    });

    try {
      const listExitCode = await runCli(["node", "exo-cli", "proposals", "list"], {
        env: testRuntimeEnv(),
        stdout: { write: () => {} },
        stderr: { write: () => {} },
        connectAppClient: async () => client,
      });
      const showExitCode = await runCli(["node", "exo-cli", "proposals", "show", "proposal-1"], {
        env: testRuntimeEnv(),
        stdout: { write: () => {} },
        stderr: { write: () => {} },
        connectAppClient: async () => client,
      });
      const createExitCode = await runCli(["node", "exo-cli", "proposals", "create", proposalPath], {
        env: testRuntimeEnv(),
        stdout: { write: () => {} },
        stderr: { write: () => {} },
        connectAppClient: async () => client,
      });
      const acceptExitCode = await runCli(["node", "exo-cli", "proposals", "accept", "proposal-1", "create-1"], {
        env: testRuntimeEnv(),
        stdout: { write: () => {} },
        stderr: { write: () => {} },
        connectAppClient: async () => client,
      });

      expect(listExitCode).toBe(0);
      expect(showExitCode).toBe(0);
      expect(createExitCode).toBe(0);
      expect(acceptExitCode).toBe(0);
      expect(calls).toEqual(["show:proposal-1", "create:proposal-1", "accept:proposal-1:create-1"]);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
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

  it("reads a bounded agent transcript tail by default", async () => {
    let receivedTailChars: number | undefined;
    let stdout = "";
    const exitCode = await runCli(["node", "exo-cli", "agents", "read", "term-1"], {
      env: testRuntimeEnv(),
      stdout: { write: (text) => { stdout += text; } },
      stderr: { write: () => {} },
      connectAppClient: async () => fakeAppClient({
        readTerminalTranscript: async (_id, tailChars) => {
          receivedTailChars = tailChars;
          return "old\nfresh\n";
        },
      }),
    });

    expect(exitCode).toBe(0);
    expect(receivedTailChars).toBe(20_000);
    expect(stdout).toBe("old\nfresh\n");
  });

  it("preserves full agent transcript reads behind --full", async () => {
    let receivedTailChars: number | undefined;
    const exitCode = await runCli(["node", "exo-cli", "agents", "read", "term-1", "--full"], {
      env: testRuntimeEnv(),
      stdout: { write: () => {} },
      stderr: { write: () => {} },
      connectAppClient: async () => fakeAppClient({
        readTerminalTranscript: async (_id, tailChars) => {
          receivedTailChars = tailChars;
          return "full transcript\n";
        },
      }),
    });

    expect(exitCode).toBe(0);
    expect(receivedTailChars).toBe(0);
  });

  it("passes terminal read line limits to the app client", async () => {
    let receivedOptions: { maxLines?: number } | undefined;
    let stdout = "";
    const exitCode = await runCli(["node", "exo-cli", "terminals", "read", "term-1", "--lines", "3"], {
      env: testRuntimeEnv(),
      stdout: { write: (text) => { stdout += text; } },
      stderr: { write: () => {} },
      connectAppClient: async () => fakeAppClient({
        readTerminal: async (_id, options) => {
          receivedOptions = options;
          return "line-3\nline-4\nline-5";
        },
      }),
    });

    expect(exitCode).toBe(0);
    expect(receivedOptions).toEqual({ maxLines: 3 });
    expect(stdout).toBe("line-3\nline-4\nline-5\n");
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
    expect(stdout).toContain("Usage: exo agents create <shell|claude|codex|pi> [cwd]");
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
    expect(stdout).toContain("Usage: exo agents create <shell|claude|codex|pi> [cwd]");
  });

  it("includes configured visible harnesses in agents create help", async () => {
    let stdout = "";

    const exitCode = await runCli(["node", "exo-cli", "agents", "create", "--help"], {
      env: {
        ...testRuntimeEnv(),
        EXO_HERMES_COMMAND: "/bin/sh",
      },
      stdout: { write: (text) => { stdout += text; } },
      stderr: { write: () => {} },
      connectAppClient: async () => fakeAppClient(),
    });

    expect(exitCode).toBe(0);
    expect(stdout).toContain("Usage: exo agents create <shell|claude|codex|pi|hermes> [cwd]");
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
      sendTerminalMessage: async (_id, message, submit) => {
        calls.push(`${message}:${submit}`);
        return { ok: true as const, delivery: "sent" as const };
      },
      reconnectTerminal: async (id) => {
        calls.push(`reconnect:${id}`);
        return { ok: true, terminal: { id, status: "running" } };
      },
      resyncTerminal: async (id) => {
        calls.push(`resync:${id}`);
        return { ok: true, terminal: { id, status: "running" } };
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
    const reconnectExitCode = await runCli(["node", "exo-cli", "terminals", "reconnect", "term-1"], {
      env: testRuntimeEnv(),
      stdout: { write: () => {} },
      stderr: { write: () => {} },
      connectAppClient: async () => client,
    });
    const resyncExitCode = await runCli(["node", "exo-cli", "terminals", "resync", "term-1"], {
      env: testRuntimeEnv(),
      stdout: { write: () => {} },
      stderr: { write: () => {} },
      connectAppClient: async () => client,
    });

    expect(diagnosticsExitCode).toBe(0);
    expect(sendExitCode).toBe(0);
    expect(reconnectExitCode).toBe(0);
    expect(resyncExitCode).toBe(0);
    expect(stdout).toContain('"health": "healthy"');
    expect(calls).toEqual(["raw command:true", "reconnect:term-1", "resync:term-1"]);
  });

  it("lists routine templates from plugin manifests and creates routines", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "exo-cli-routines-"));
    try {
      const pluginRoot = await writeRoutinePlugin(root);
      const env = routineTestEnv(root, pluginRoot);
      let stdout = "";

      const templatesExitCode = await runCli(["node", "exo-cli", "routines", "templates"], {
        env,
        stdout: { write: (text) => { stdout += text; } },
        stderr: { write: () => {} },
      });
      expect(templatesExitCode).toBe(0);
      expect(stdout).toContain('"id": "graph-health.template"');

      stdout = "";
      const createExitCode = await runCli([
        "node",
        "exo-cli",
        "routines",
        "create",
        "graph-health.template",
        "graph-health-weekly",
        "--schedule",
        "0 8 * * 1",
        "--timezone",
        "America/Los_Angeles",
        "--path",
        "notes",
      ], {
        env,
        stdout: { write: (text) => { stdout += text; } },
        stderr: { write: () => {} },
      });

      expect(createExitCode).toBe(0);
      expect(stdout).toContain('"id": "graph-health-weekly"');
      expect(stdout).toContain('"schedule": "0 8 * * 1"');
      await expect(readFile(path.join(root, ".exo-runtime", "routines", "graph-health-weekly.json"), "utf8")).resolves.toContain(
        "graph-health-weekly",
      );
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("records routine dry runs through the CLI", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "exo-cli-routines-"));
    try {
      const pluginRoot = await writeRoutinePlugin(root);
      const env = routineTestEnv(root, pluginRoot);
      let stdout = "";

      await runCli(["node", "exo-cli", "routines", "create", "graph-health.template", "graph-health-manual"], {
        env,
        stdout: { write: () => {} },
        stderr: { write: () => {} },
      });
      const runExitCode = await runCli(["node", "exo-cli", "routines", "run", "graph-health-manual", "--dry-run"], {
        env,
        stdout: { write: (text) => { stdout += text; } },
        stderr: { write: () => {} },
      });

      expect(runExitCode).toBe(0);
      expect(stdout).toContain('"status": "succeeded"');
      expect(stdout).toContain('"dry-run-report"');

      const runId = (JSON.parse(stdout) as { run: { id: string } }).run.id;
      stdout = "";
      const runsExitCode = await runCli(["node", "exo-cli", "routines", "runs", "--routine", "graph-health-manual"], {
        env,
        stdout: { write: (text) => { stdout += text; } },
        stderr: { write: () => {} },
      });
      expect(runsExitCode).toBe(0);
      expect(stdout).toContain(runId);

      stdout = "";
      const readExitCode = await runCli(["node", "exo-cli", "routines", "read", runId], {
        env,
        stdout: { write: (text) => { stdout += text; } },
        stderr: { write: () => {} },
      });
      expect(readExitCode).toBe(0);
      expect(stdout).toContain('"routineId": "graph-health-manual"');

      stdout = "";
      const artifactsExitCode = await runCli(["node", "exo-cli", "routines", "artifacts", runId], {
        env,
        stdout: { write: (text) => { stdout += text; } },
        stderr: { write: () => {} },
      });
      expect(artifactsExitCode).toBe(0);
      expect(stdout).toContain('"id": "dry-run-report"');

      stdout = "";
      const artifactExitCode = await runCli(["node", "exo-cli", "routines", "artifact", runId, "dry-run-report"], {
        env,
        stdout: { write: (text) => { stdout += text; } },
        stderr: { write: () => {} },
      });
      expect(artifactExitCode).toBe(0);
      expect(stdout).toContain("# Routine Dry Run");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("launches a Codex routine agent through the running app", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "exo-cli-routines-"));
    try {
      const pluginRoot = await writeRoutinePlugin(root);
      const env = routineTestEnv(root, pluginRoot);
      const calls: Array<Record<string, unknown>> = [];
      let stdout = "";
      await runCli(["node", "exo-cli", "routines", "create", "graph-health.template", "graph-health-agent"], {
        env,
        stdout: { write: () => {} },
        stderr: { write: () => {} },
      });

      const exitCode = await runCli(["node", "exo-cli", "routines", "run", "graph-health-agent", "--agent"], {
        env,
        stdout: { write: (text) => { stdout += text; } },
        stderr: { write: () => {} },
        connectAppClient: async () => fakeAppClient({
          createTerminal: async (kind, cwd) => {
            calls.push({ action: "create", kind, cwd });
            return { id: "term-codex" };
          },
          sendTerminalMessage: async (id, message, submit) => {
            calls.push({ action: "send", id, message, submit });
            return { ok: true as const, delivery: "sent" as const };
          },
        }),
      });

      expect(exitCode).toBe(0);
      expect(stdout).toContain('"status": "needsReview"');
      expect(stdout).toContain('"id": "agent-session"');
      expect(calls[0]).toMatchObject({ action: "create", kind: "codex" });
      expect(calls[1]).toMatchObject({ action: "send", id: "term-codex", submit: true });
      expect(String(calls[1]?.message)).toContain("# Exo Routine: Graph Health");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("checks routine agent policy before connecting to the app", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "exo-cli-routines-"));
    try {
      const pluginRoot = await writeRoutinePlugin(root, {
        templateOverrides: {
          requiredSkills: [{ id: "graph-health", label: "Graph Health", required: true }],
        },
      });
      const env = routineTestEnv(root, pluginRoot);
      let connected = false;
      await runCli(["node", "exo-cli", "routines", "create", "graph-health.template", "graph-health-agent"], {
        env,
        stdout: { write: () => {} },
        stderr: { write: () => {} },
      });

      await expect(runCli(["node", "exo-cli", "routines", "run", "graph-health-agent", "--agent"], {
        env,
        stdout: { write: () => {} },
        stderr: { write: () => {} },
        connectAppClient: async () => {
          connected = true;
          return fakeAppClient({});
        },
      })).rejects.toThrow("missing required harness skills: graph-health");
      expect(connected).toBe(false);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("launches a Claude routine agent with a skill-request prompt", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "exo-cli-routines-"));
    try {
      const pluginRoot = await writeRoutinePlugin(root);
      const env = routineTestEnv(root, pluginRoot);
      const calls: Array<Record<string, unknown>> = [];
      await runCli([
        "node",
        "exo-cli",
        "routines",
        "create",
        "graph-health.template",
        "app-qa-smoke",
        "--prompt",
        "Use the app-qa skill if it is available. Do not modify files; only report the QA checklist you would run.",
        "--harness",
        "claude",
      ], {
        env,
        stdout: { write: () => {} },
        stderr: { write: () => {} },
      });

      const exitCode = await runCli(["node", "exo-cli", "routines", "run", "app-qa-smoke", "--agent", "--no-submit"], {
        env,
        stdout: { write: () => {} },
        stderr: { write: () => {} },
        connectAppClient: async () => fakeAppClient({
          createTerminal: async (kind) => {
            calls.push({ action: "create", kind });
            return { id: "term-claude" };
          },
          sendTerminalMessage: async (id, message, submit) => {
            calls.push({ action: "send", id, message, submit });
            return { ok: true as const, delivery: "queued" as const, queuedInputCount: 1 };
          },
        }),
      });

      expect(exitCode).toBe(0);
      expect(calls[0]).toMatchObject({ action: "create", kind: "claude" });
      expect(calls[1]).toMatchObject({ action: "send", id: "term-claude", submit: false });
      expect(String(calls[1]?.message)).toContain("Use the app-qa skill if it is available");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("uses the broad agent kind set in routine run errors", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "exo-cli-routines-"));
    try {
      const pluginRoot = await writeRoutinePlugin(root);
      const env = routineTestEnv(root, pluginRoot);

      await expect(runCli(["node", "exo-cli", "routines", "run", "graph-health-agent"], {
        env,
        stdout: { write: () => {} },
        stderr: { write: () => {} },
      })).rejects.toThrow(
        "Usage: exo routines run <routine-id> (--dry-run | --agent) [--harness shell|claude|codex|pi|hermes] [--cwd <path>] [--no-submit]",
      );

      await runCli(["node", "exo-cli", "routines", "create", "graph-health.template", "graph-health-agent"], {
        env,
        stdout: { write: () => {} },
        stderr: { write: () => {} },
      });

      await expect(runCli(["node", "exo-cli", "routines", "run", "graph-health-agent", "--agent", "--harness", "aider"], {
        env,
        stdout: { write: () => {} },
        stderr: { write: () => {} },
      })).rejects.toThrow("Routine harness must be one of shell|claude|codex|pi|hermes: aider");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
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

function routineTestEnv(root: string, pluginRoot: string): NodeJS.ProcessEnv {
  return {
    EXO_WORKSPACE_ROOT: root,
    EXO_NOTE_ROOTS: path.join(root, "notes"),
    EXO_PROJECT_ROOTS: "",
    EXO_RUNTIME_ROOT: path.join(root, ".exo-runtime"),
    EXO_PLUGIN_DIRS: pluginRoot,
    EXO_SETTINGS_PATH: path.join(root, "settings.json"),
  };
}

async function writeRoutinePlugin(root: string, options: { templateOverrides?: Record<string, unknown> } = {}): Promise<string> {
  const pluginsRoot = path.join(root, "plugins");
  const pluginDir = path.join(pluginsRoot, "graph-health");
  await mkdir(pluginDir, { recursive: true });
  await writeFile(
    path.join(pluginDir, "exo.plugin.json"),
    JSON.stringify(
      {
        id: "graph-health.plugin",
        name: "Graph Health Plugin",
        version: "0.1.0",
        exoApiVersion: "0.1",
        capabilities: [
          {
            id: "graph-health.template",
            kind: "core:routineTemplate",
            label: "Graph Health",
            description: "Audit graph structure and write a report.",
            lifecycle: "experimental",
            owner: "graph-health.plugin",
            surfaces: ["cli"],
            permissions: ["workspace:read", "notes:read", "artifacts:write"],
            compatibility: {
              routineTemplate: {
                prompt: "Audit the selected exograph and write a graph health report.",
                harnessId: "codex",
                requiredSkills: [],
                trigger: { kind: "manual" },
                permissions: { permissions: ["workspace:read", "notes:read", "artifacts:write"] },
                outputPolicy: {
                  fileChanges: "propose",
                  artifacts: "record",
                  allowedPaths: [".exo/artifacts"],
                },
                ...options.templateOverrides,
              },
            },
          },
        ],
        permissions: ["workspace:read", "notes:read", "artifacts:write"],
        surfaces: ["cli"],
      },
      null,
      2,
    ),
    "utf8",
  );
  return pluginsRoot;
}

function fakeAppClient(overrides: Partial<{
  getStatus: () => Promise<Record<string, unknown>>;
  openFile: (filePath: string) => Promise<void>;
  openPreview: (target: string) => Promise<Record<string, unknown>>;
  focusPreview: () => Promise<Record<string, unknown>>;
  closePreview: () => Promise<Record<string, unknown>>;
  createProposal: (proposal: Record<string, unknown>) => Promise<Record<string, unknown>>;
  listProposals: () => Promise<Record<string, unknown>>;
  readProposal: (id: string) => Promise<Record<string, unknown>>;
  decideProposal: (id: string, decision: "accept" | "reject", itemId?: string) => Promise<Record<string, unknown>>;
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
  readTerminal: (id: string, options?: { maxLines?: number }) => Promise<string>;
  readTerminalTranscript: (id: string, tailChars?: number) => Promise<string>;
  writeTerminal: (id: string, data: string) => Promise<{ ok: boolean; delivery: "sent" | "queued" | "not-found"; queuedInputCount?: number }>;
  sendTerminalMessage: (id: string, message: string, submit?: boolean) => Promise<{ ok: boolean; delivery: "sent" | "queued" | "not-found"; queuedInputCount?: number }>;
  reconnectTerminal: (id: string) => Promise<Record<string, unknown>>;
  resyncTerminal: (id: string) => Promise<Record<string, unknown>>;
  killTerminal: (id: string) => Promise<void>;
}> = {}) {
  const missing = async (..._args: unknown[]) => {
    throw new Error("Unexpected app client call");
  };
  return {
    getStatus: missing,
    openFile: missing,
    openPreview: missing,
    focusPreview: missing,
    closePreview: missing,
    createProposal: missing,
    listProposals: missing,
    readProposal: missing,
    decideProposal: missing,
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
      return { ok: false, delivery: "not-found" as const };
    },
    sendTerminalMessage: async (...args: [string, string, boolean?]) => {
      await missing(...args);
      return { ok: false, delivery: "not-found" as const };
    },
    reconnectTerminal: missing,
    resyncTerminal: missing,
    killTerminal: missing,
    ...overrides,
  };
}
