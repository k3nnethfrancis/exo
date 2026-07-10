import { describe, expect, it } from "vitest";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { runCli } from "./index";
import {
  SemanticTraceStore,
  captureFakeHarnessTraceFixture,
  formatManagedAgentKindUsage,
  mapHarnessRawTraceEvent,
  saveWorkspaceSettings,
  type HarnessRawTraceEvent,
} from "@exo/core";

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

  it("returns local status when the app is unavailable", async () => {
    const runtimeRoot = await mkdtemp(path.join(os.tmpdir(), "exo-cli-discovery-"));
    let stdout = "";

    try {
      const exitCode = await runCli(["node", "exo-cli", "status"], {
        env: {
          EXO_WORKSPACE_ROOT: "/tmp/exo-test-workspace",
          EXO_RUNTIME_ROOT: runtimeRoot,
        },
        stdout: { write: (text) => { stdout += text; } },
        stderr: { write: () => {} },
      });

      expect(exitCode).toBe(0);
      expect(stdout).toContain('"available": false');
      expect(stdout).toContain('"workspaceRoot": "/tmp/exo-test-workspace"');
      expect(stdout).toContain('"backend": "qmd"');
    } finally {
      await rm(runtimeRoot, { recursive: true, force: true });
    }
  });

  it("prints actionable discovery diagnostics for live app commands", async () => {
    const runtimeRoot = await mkdtemp(path.join(os.tmpdir(), "exo-cli-discovery-"));
    let stderr = "";

    try {
      const exitCode = await runCli(["node", "exo-cli", "show"], {
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

  it("reads persisted semantic traces from the runtime root", async () => {
    const runtimeRoot = await mkdtemp(path.join(os.tmpdir(), "exo-cli-traces-"));
    let stdout = "";

    try {
      await captureFakeHarnessTraceFixture(new SemanticTraceStore(runtimeRoot), {
        sessionId: "fake-session",
        harnessId: "fake-claude",
        now: () => "2026-07-03T16:00:00.000Z",
      });

      const exitCode = await runCli(["node", "exo-cli", "traces", "read", "fake-session", "--limit", "4"], {
        env: {
          EXO_WORKSPACE_ROOT: "/tmp/exo-test-workspace",
          EXO_RUNTIME_ROOT: runtimeRoot,
        },
        stdout: { write: (text) => { stdout += text; } },
        stderr: { write: () => {} },
        connectAppClient: async () => {
          throw new Error("traces read should not connect to the app");
        },
      });

      expect(exitCode).toBe(0);
      expect(stdout).toContain("Trace session fake-session: 4 events");
      expect(stdout).toContain("#3 message agent:fake-claude");
      expect(stdout).toContain("#4 tool.call name=\"read_file\"");
      expect(stdout).toContain("#6 lifecycle lifecycle=\"exit\" status=\"succeeded\"");
    } finally {
      await rm(runtimeRoot, { recursive: true, force: true });
    }
  });

  it("reads only the requested semantic trace session", async () => {
    const runtimeRoot = await mkdtemp(path.join(os.tmpdir(), "exo-cli-trace-isolation-"));
    let stdout = "";

    try {
      await captureFakeHarnessTraceFixture(new SemanticTraceStore(runtimeRoot), {
        sessionId: "claude-session",
        harnessId: "fake-claude",
        rawEvents: [{ type: "assistant-text", text: "CLAUDE_ONLY" }],
        now: () => "2026-07-03T16:00:00.000Z",
      });
      await captureFakeHarnessTraceFixture(new SemanticTraceStore(runtimeRoot), {
        sessionId: "pi-session",
        harnessId: "fake-pi",
        rawEvents: [{ type: "assistant-text", text: "PI_ONLY" }],
        now: () => "2026-07-03T16:00:01.000Z",
      });

      const exitCode = await runCli(["node", "exo-cli", "traces", "read", "pi-session", "--limit", "10"], {
        env: {
          EXO_WORKSPACE_ROOT: "/tmp/exo-test-workspace",
          EXO_RUNTIME_ROOT: runtimeRoot,
        },
        stdout: { write: (text) => { stdout += text; } },
        stderr: { write: () => {} },
        connectAppClient: async () => {
          throw new Error("traces read should not connect to the app");
        },
      });

      expect(exitCode).toBe(0);
      expect(stdout).toContain("Trace session pi-session: 1 event");
      expect(stdout).toContain("PI_ONLY");
      expect(stdout).not.toContain("CLAUDE_ONLY");
    } finally {
      await rm(runtimeRoot, { recursive: true, force: true });
    }
  });

  it("lists semantic trace sessions and cleans up only when explicitly requested", async () => {
    const runtimeRoot = await mkdtemp(path.join(os.tmpdir(), "exo-cli-trace-cleanup-"));
    const store = new SemanticTraceStore(runtimeRoot);
    let listStdout = "";
    let dryRunStdout = "";
    let deleteStdout = "";

    try {
      await captureFakeHarnessTraceFixture(store, {
        sessionId: "old-session",
        harnessId: "fake-claude",
        rawEvents: [{ type: "assistant-text", timestamp: "2026-07-01T10:00:00.000Z", text: "OLD_ONLY" }],
      });
      await captureFakeHarnessTraceFixture(store, {
        sessionId: "new-session",
        harnessId: "fake-pi",
        rawEvents: [{ type: "assistant-text", timestamp: "2026-07-05T10:00:00.000Z", text: "NEW_ONLY" }],
      });

      const env = {
        EXO_WORKSPACE_ROOT: "/tmp/exo-test-workspace",
        EXO_RUNTIME_ROOT: runtimeRoot,
      };
      const noAppConnect = async () => {
        throw new Error("traces cleanup should not connect to the app");
      };
      expect(await runCli(["node", "exo-cli", "traces", "list"], {
        env,
        stdout: { write: (text) => { listStdout += text; } },
        stderr: { write: () => {} },
        connectAppClient: noAppConnect,
      })).toBe(0);
      expect(listStdout).toContain("Semantic trace sessions: 2");
      expect(listStdout).toContain("old-session harness=fake-claude 1 event");
      expect(listStdout).toContain("new-session harness=fake-pi 1 event");

      expect(await runCli(["node", "exo-cli", "traces", "cleanup", "--before", "2026-07-04T00:00:00.000Z", "--dry-run"], {
        env,
        stdout: { write: (text) => { dryRunStdout += text; } },
        stderr: { write: () => {} },
        connectAppClient: noAppConnect,
      })).toBe(0);
      expect(dryRunStdout).toContain("Would delete 2 semantic trace files across 1 session");
      expect((await store.readEvents("old-session")).map((event) => event.payload.text)).toEqual(["OLD_ONLY"]);
      expect((await store.readEvents("new-session")).map((event) => event.payload.text)).toEqual(["NEW_ONLY"]);

      expect(await runCli(["node", "exo-cli", "traces", "cleanup", "--session", "old-session"], {
        env,
        stdout: { write: (text) => { deleteStdout += text; } },
        stderr: { write: () => {} },
        connectAppClient: noAppConnect,
      })).toBe(0);
      expect(deleteStdout).toContain("Deleted 2 semantic trace files across 1 session");
      expect(await store.readEvents("old-session")).toEqual([]);
      expect((await store.readEvents("new-session")).map((event) => event.payload.text)).toEqual(["NEW_ONLY"]);
    } finally {
      await rm(runtimeRoot, { recursive: true, force: true });
    }
  });

  it("reads fake Pi repaint TUI answers from semantic traces after terminal repaint", async () => {
    const runtimeRoot = await mkdtemp(path.join(os.tmpdir(), "exo-cli-pi-trace-"));
    const traceSidecar = path.join(runtimeRoot, "fake-pi-sidecar.ndjson");
    const sessionId = "fake-pi-session";
    const harnessId = "fake-pi";
    const fixturePath = path.resolve(
      path.dirname(fileURLToPath(import.meta.url)),
      "../../../apps/desktop/tests/fixtures/fake-pi-repaint-tui.mjs",
    );
    let stdout = "";
    let childOutput = "";
    const child = spawn(process.execPath, [fixturePath], {
      env: {
        ...process.env,
        EXO_FAKE_PI_VISIBLE_MS: "10",
        EXO_FAKE_PI_TRACE_PATH: traceSidecar,
        EXO_FAKE_PI_TRACE_SESSION_ID: sessionId,
        EXO_FAKE_PI_TRACE_HARNESS_ID: harnessId,
      },
      stdio: ["pipe", "pipe", "pipe"],
    });

    try {
      child.stdout?.on("data", (chunk) => {
        childOutput += chunk.toString("utf8");
      });
      child.stdin?.write("Reply exactly OK.\n");
      await waitFor(async () => {
        const raw = await readFile(traceSidecar, "utf8").catch(() => "");
        return raw.includes("PI_FIXTURE_ANSWER OK");
      });
      await waitFor(() => childOutput.includes("status: ready") && childOutput.includes("PI_FIXTURE_ANSWER OK"));

      const rawEvents = (await readFile(traceSidecar, "utf8"))
        .trim()
        .split("\n")
        .map((line) => JSON.parse(line) as HarnessRawTraceEvent);
      await new SemanticTraceStore(runtimeRoot).appendEvents(
        sessionId,
        rawEvents.map((event, index) => mapHarnessRawTraceEvent(event, { sessionId, harnessId }, index + 1)),
      );

      const exitCode = await runCli(["node", "exo-cli", "agents", "read", sessionId, "--semantic"], {
        env: {
          EXO_WORKSPACE_ROOT: "/tmp/exo-test-workspace",
          EXO_RUNTIME_ROOT: runtimeRoot,
        },
        stdout: { write: (text) => { stdout += text; } },
        stderr: { write: () => {} },
        connectAppClient: async () => {
          throw new Error("semantic agent reads should not connect to the app");
        },
      });

      expect(exitCode).toBe(0);
      expect(stdout).toContain("PI_FIXTURE_ANSWER OK");
    } finally {
      child.kill("SIGTERM");
      await once(child, "exit").catch(() => undefined);
      await rm(runtimeRoot, { recursive: true, force: true });
    }
  });

  it("says semantic agent reads are trace-backed when no events exist", async () => {
    const runtimeRoot = await mkdtemp(path.join(os.tmpdir(), "exo-cli-empty-trace-"));
    let stdout = "";

    try {
      const exitCode = await runCli(["node", "exo-cli", "agents", "read", "empty-session", "--semantic"], {
        env: {
          EXO_WORKSPACE_ROOT: "/tmp/exo-test-workspace",
          EXO_RUNTIME_ROOT: runtimeRoot,
        },
        stdout: { write: (text) => { stdout += text; } },
        stderr: { write: () => {} },
        connectAppClient: async () => {
          throw new Error("semantic agent reads should not connect to the app");
        },
      });

      expect(exitCode).toBe(0);
      expect(stdout).toBe("(no trace-backed semantic answer output)\n");
    } finally {
      await rm(runtimeRoot, { recursive: true, force: true });
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
          backendReady: true,
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
          EXO_PI_BACKEND_READY: "1",
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

  it("reads a bounded agent live output tail by default", async () => {
    let receivedTailChars: number | undefined;
    let stdout = "";
    let stderr = "";
    const exitCode = await runCli(["node", "exo-cli", "agents", "read", "term-1"], {
      env: testRuntimeEnv(),
      stdout: { write: (text) => { stdout += text; } },
      stderr: { write: (text) => { stderr += text; } },
      connectAppClient: async () => fakeAppClient({
        readTerminalTranscript: async (_id, tailChars) => {
          receivedTailChars = tailChars;
          return "old\nfresh\n";
        },
      }),
    });

    expect(exitCode).toBe(0);
    expect(receivedTailChars).toBe(20_000);
    expect(stderr).toContain("Source: live terminal output tail (20000 chars); format: ANSI-cleaned text; not semantic trace data.");
    expect(stdout).toBe("old\nfresh\n");
  });

  it("cleans terminal repaint and line-drawing controls from default agent reads", async () => {
    let stdout = "";
    const transcript = [
      "\u001b[?25l\u001b(0lqqqqqqqqk\u001b(B\r⠋ Thinking",
      "\r⠙ Thinking",
      "\r\u001b[2K\u001b(0x\u001b(B Codex ready € \u001b(0x\u001b(B\n",
      "\u001b(0mqqqqqqqqj\u001b(B\n",
      "\u001b]0;agent-title\u0007done\u001b[?25h\n",
    ].join("");

    const exitCode = await runCli(["node", "exo-cli", "agents", "read", "term-1"], {
      env: testRuntimeEnv(),
      stdout: { write: (text) => { stdout += text; } },
      stderr: { write: () => {} },
      connectAppClient: async () => fakeAppClient({
        readTerminalTranscript: async () => transcript,
      }),
    });

    expect(exitCode).toBe(0);
    expect(stdout).toContain("│ Codex ready € │");
    expect(stdout).toContain("└────────┘");
    expect(stdout).toContain("done");
    expect(stdout).not.toContain("qqqq");
    expect(stdout).not.toContain("Thinking");
    expect(stdout).not.toContain("\u001b");
    expect(stdout).not.toContain("\ufffd");
  });

  it("preserves raw agent live output reads behind --raw", async () => {
    let stdout = "";
    const transcript = "\u001b(0lqqk\u001b(B\r⠋ Thinking\n";

    const exitCode = await runCli(["node", "exo-cli", "agents", "read", "term-1", "--raw"], {
      env: testRuntimeEnv(),
      stdout: { write: (text) => { stdout += text; } },
      stderr: { write: () => {} },
      connectAppClient: async () => fakeAppClient({
        readTerminalTranscript: async () => transcript,
      }),
    });

    expect(exitCode).toBe(0);
    expect(stdout).toBe(transcript);
  });

  it("preserves full agent live output reads behind --full", async () => {
    let receivedTailChars: number | undefined;
    let stderr = "";
    const exitCode = await runCli(["node", "exo-cli", "agents", "read", "term-1", "--full"], {
      env: testRuntimeEnv(),
      stdout: { write: () => {} },
      stderr: { write: (text) => { stderr += text; } },
      connectAppClient: async () => fakeAppClient({
        readTerminalTranscript: async (_id, tailChars) => {
          receivedTailChars = tailChars;
          return "full transcript\n";
        },
      }),
    });

    expect(exitCode).toBe(0);
    expect(receivedTailChars).toBe(0);
    expect(stderr).toContain("Source: full live terminal output buffer; format: ANSI-cleaned text; not semantic trace data.");
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

  it("lists AgentCommand spawn in top-level help", async () => {
    let stderr = "";

    const exitCode = await runCli(["node", "exo-cli", "--help"], {
      env: testRuntimeEnv(),
      stdout: { write: () => {} },
      stderr: { write: (text) => { stderr += text; } },
      connectAppClient: async () => fakeAppClient(),
    });

    expect(exitCode).toBe(1);
    expect(stderr).toContain("exo spawn @handle <task>");
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
    expect(stdout).toContain("Usage: exo spawn @handle <task>");
    expect(stdout).toContain("`exo agents create` was removed.");
  });

  it("prints removed agents create help without creating a terminal", async () => {
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
    expect(stdout).toContain("Usage: exo spawn @handle <task>");
  });

  it("rejects agents create without creating a terminal", async () => {
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
    })).rejects.toThrow("exo agents create was removed.");

    expect(created).toBe(false);
  });

  it("spawns configured AgentCommands through the app command server", async () => {
    let receivedHandle = "";
    let receivedTask = "";
    let stdout = "";

    const exitCode = await runCli(["node", "exo-cli", "spawn", "@fable", "review", "the", "plan"], {
      env: testRuntimeEnv(),
      stdout: { write: (text) => { stdout += text; } },
      stderr: { write: () => {} },
      connectAppClient: async () => fakeAppClient({
        spawnAgentCommand: async (handle, task) => {
          receivedHandle = handle;
          receivedTask = task;
          return {
            ok: true,
            invocation: { id: "inv-1", context: "cli", status: "running" },
            terminal: { id: "term-1", title: "Fable" },
          };
        },
      }),
    });

    expect(exitCode).toBe(0);
    expect(receivedHandle).toBe("@fable");
    expect(receivedTask).toBe("review the plan");
    expect(JSON.parse(stdout)).toMatchObject({
      ok: true,
      invocation: { id: "inv-1" },
      terminal: { id: "term-1" },
    });
  });

  it("requires @handle syntax for AgentCommand spawn", async () => {
    await expect(runCli(["node", "exo-cli", "spawn", "fable", "review"], {
      env: testRuntimeEnv(),
      stdout: { write: () => {} },
      stderr: { write: () => {} },
      connectAppClient: async () => fakeAppClient(),
    })).rejects.toThrow("Usage: exo spawn @handle <task>");
  });

  it("reports app-unavailable AgentCommand spawn as a failed command", async () => {
    let stderr = "";

    const exitCode = await runCli(["node", "exo-cli", "spawn", "@fable", "review"], {
      env: testRuntimeEnv(),
      stdout: { write: () => {} },
      stderr: { write: (text) => { stderr += text; } },
      connectAppClient: async () => null,
    });

    expect(exitCode).toBe(1);
    expect(stderr).toContain("Exo app is not reachable");
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

  it("returns local index status when the app is unavailable", async () => {
    let stdout = "";

    const exitCode = await runCli(["node", "exo-cli", "index", "status"], {
      env: testRuntimeEnv(),
      stdout: { write: (text) => { stdout += text; } },
      stderr: { write: () => {} },
      connectAppClient: async () => null,
    });

    expect(exitCode).toBe(0);
    expect(stdout).toContain('"backend": "qmd"');
    expect(stdout).toContain('"mode":');
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

  it("keeps terminals commands available for operator debugging", async () => {
    const calls: string[] = [];
    let stdout = "";
    const client = fakeAppClient({
      terminalDiagnostics: async () => [{ id: "term-1", health: "healthy" }],
      sendTerminalMessage: async (_id, message, submit) => {
        calls.push(`${message}:${submit}`);
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
    expect(calls).toEqual(["raw command:true"]);
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
  openPreview: (target: string) => Promise<Record<string, unknown>>;
  focusPreview: () => Promise<Record<string, unknown>>;
  closePreview: () => Promise<Record<string, unknown>>;
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
  terminalDiagnostics: () => Promise<unknown[]>;
  createTerminal: (kind: string, cwd?: string) => Promise<Record<string, unknown>>;
  spawnAgentCommand: (handle: string, task: string) => Promise<Record<string, unknown>>;
  readTerminal: (id: string, options?: { maxLines?: number }) => Promise<string>;
  readTerminalTranscript: (id: string, tailChars?: number) => Promise<string>;
  writeTerminal: (id: string, data: string) => Promise<{ ok: boolean; delivery: "sent" | "queued" | "not-found"; queuedInputCount?: number }>;
  sendTerminalMessage: (id: string, message: string, submit?: boolean) => Promise<{ ok: boolean; delivery: "sent" | "queued" | "not-found"; queuedInputCount?: number }>;
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
    terminalDiagnostics: missing,
    createTerminal: missing,
    spawnAgentCommand: missing,
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
    killTerminal: missing,
    ...overrides,
  };
}

async function waitFor(predicate: () => boolean | Promise<boolean>, timeoutMs = 2_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await predicate()) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error("Timed out waiting for predicate.");
}
