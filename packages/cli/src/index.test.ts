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
});
