import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { PassThrough } from "node:stream";
import { afterEach, describe, expect, it } from "vitest";

import { runExoMcpServer } from "./mcp-server";

const temporaryRoots: string[] = [];

afterEach(async () => {
  await Promise.all(temporaryRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("Exo MCP server", () => {
  it("serves the active workspace through read-only status, search, and read tools", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "exo-mcp-"));
    temporaryRoots.push(root);
    const notePath = path.join(root, "research.md");
    await writeFile(notePath, "# Research\n\nExo holds local context.\n", "utf8");
    const input = new PassThrough();
    const output = new PassThrough();
    let text = "";
    output.on("data", (chunk) => { text += chunk.toString(); });
    const server = runExoMcpServer({
      input,
      output,
      error: new PassThrough(),
      env: { EXO_WORKSPACE_ROOT: root, EXO_NOTE_ROOTS: root },
    });
    input.end([
      JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize", params: {} }),
      JSON.stringify({ jsonrpc: "2.0", id: 2, method: "tools/list", params: {} }),
      JSON.stringify({ jsonrpc: "2.0", id: 3, method: "tools/call", params: { name: "search_notes", arguments: { query: "context" } } }),
      JSON.stringify({ jsonrpc: "2.0", id: 4, method: "tools/call", params: { name: "read_note", arguments: { target: notePath } } }),
    ].join("\n"));
    await server;

    const responses = text.trim().split("\n").map((line) => JSON.parse(line));
    expect(responses[0].result).toMatchObject({ protocolVersion: "2025-06-18", capabilities: { tools: { listChanged: false } } });
    expect(responses[1].result.tools.map((tool: { name: string }) => tool.name)).toEqual(["workspace_status", "search_notes", "read_note"]);
    expect(responses[2].result.content[0].text).toContain("research.md");
    expect(responses[3].result.content[0].text).toContain("Exo holds local context.");
  });

  it("returns tool errors as MCP tool results rather than crashing the protocol", async () => {
    const input = new PassThrough();
    const output = new PassThrough();
    let text = "";
    output.on("data", (chunk) => { text += chunk.toString(); });
    const server = runExoMcpServer({ input, output, error: new PassThrough(), env: { EXO_WORKSPACE_ROOT: process.cwd(), EXO_NOTE_ROOTS: process.cwd() } });
    input.end(JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "read_note", arguments: {} } }));
    await server;
    expect(JSON.parse(text).result).toMatchObject({ isError: true });
  });
});
