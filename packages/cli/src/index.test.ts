import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { runCli } from "./index";

const client = {
  getStatus: async () => ({ ok: true }), showWindow: async () => {}, search: async (query: string) => ({ query }), readDocument: async (target: string) => ({ target }), getIndexStatus: async () => ({ status: "ready" }), syncIndex: async () => ({ ok: true }), addIndexRoot: async (input: Record<string, unknown>) => input, removeIndexRoot: async (target: string) => ({ target }), openFile: async () => {}, openPreview: async (target: string) => ({ target }), focusPreview: async () => ({ ok: true }), closePreview: async () => ({ ok: true }), getConfig: async () => ({ ok: true }), spawnAgentCommand: async (handle: string, task: string) => ({ handle, task }), listTerminals: async () => [], createTerminal: async () => ({ id: "term-1" }), readTerminal: async () => "tail\n", writeTerminal: async () => ({ ok: true }), sendTerminalMessage: async () => ({ ok: true }), killTerminal: async () => {},
};
const connect = async () => client;

describe("minimal Exo operator CLI", () => {
  it("routes retained search/read/index/preview/config/Command/terminal operations", async () => {
    let output = "";
    const options = { stdout: { write: (text: string) => { output += text; } }, stderr: { write: () => {} }, connectAppClient: connect };
    expect(await runCli(["node", "exo", "search", "hello"], options)).toBe(0);
    expect(await runCli(["node", "exo", "read", "note.md"], options)).toBe(0);
    expect(await runCli(["node", "exo", "index", "sync"], options)).toBe(0);
    expect(await runCli(["node", "exo", "preview", "open", "http://localhost"], options)).toBe(0);
    expect(await runCli(["node", "exo", "config", "get"], options)).toBe(0);
    expect(await runCli(["node", "exo", "spawn", "@review", "check", "this"], options)).toBe(0);
    expect(await runCli(["node", "exo", "terminals", "read", "term-1"], options)).toBe(0);
    expect(output).toContain("hello"); expect(output).toContain("tail");
  });

  it("rejects deleted families instead of preserving aliases", async () => {
    await expect(runCli(["node", "exo", "traces", "list"], { stderr: { write: () => {} }, connectAppClient: connect })).rejects.toThrow("Usage:");
    await expect(runCli(["node", "exo", "agents", "list"], { stderr: { write: () => {} }, connectAppClient: connect })).rejects.toThrow("Usage:");
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

  it("keeps status, search, and read useful when the resident app is unavailable", async () => {
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
      expect(await runCli(["node", "exo", "read", notePath], options)).toBe(0);

      expect(output).toContain('"available": false');
      expect(output).toContain("orientation.md");
      expect(output).toContain("The local-first workspace.");
      expect(discoveredRuntimeRoot).toBe(path.join(workspaceRoot, ".exo"));
    } finally {
      await rm(workspaceRoot, { recursive: true, force: true });
    }
  });
});
