import { chmod, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { configureProviderMcp, providerMcpCommand } from "./provider-mcp-setup";

const temporaryRoots: string[] = [];

afterEach(async () => {
  await Promise.all(temporaryRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

async function providerEnvironment(): Promise<NodeJS.ProcessEnv> {
  const home = await mkdtemp(path.join(os.tmpdir(), "exo-provider-mcp-"));
  temporaryRoots.push(home);
  const bin = path.join(home, ".local", "bin");
  await mkdir(bin, { recursive: true });
  const exo = path.join(bin, "exo");
  await writeFile(exo, "#!/bin/sh\nexit 0\n", "utf8");
  await chmod(exo, 0o755);
  return { HOME: home, PATH: "/usr/bin:/bin" };
}

describe("provider MCP handoff", () => {
  it("uses Claude's user-scoped command for Exo's read-only server", () => {
    expect(providerMcpCommand("claude", { providers: ["claude"] }))
      .toEqual(["claude", ["mcp", "add", "--scope", "user", "exo", "--", "exo", "mcp", "serve"]]);
  });

  it("uses Codex's stdio command for Exo's read-only server", () => {
    expect(providerMcpCommand("codex", { providers: ["codex"] }))
      .toEqual(["codex", ["mcp", "add", "exo", "--", "exo", "mcp", "serve"]]);
  });

  it("requires at least one provider", () => {
    expect(() => providerMcpCommand("claude", {
      providers: [],
    })).toThrow("at least one agent");
  });

  it("treats an existing MCP registration as a successful no-op", async () => {
    const env = await providerEnvironment();
    const results = await configureProviderMcp({ providers: ["claude"] }, {
      env,
      execute: async () => {
        throw new Error("MCP server exo already exists in user config");
      },
    });

    expect(results).toEqual([{ provider: "claude", ok: true, detail: "Exo MCP is already installed for Claude." }]);
  });

  it("uses the packaged app command environment to find provider CLIs", async () => {
    const env = await providerEnvironment();
    let commandPath = "";
    const results = await configureProviderMcp({ providers: ["codex"] }, {
      env,
      execute: async (file, _args, commandEnv) => {
        commandPath = commandEnv.PATH ?? "";
        expect(file).toBe("codex");
        return { stdout: "", stderr: "" };
      },
    });

    expect(results).toEqual([{ provider: "codex", ok: true, detail: "Added Exo MCP to Codex." }]);
    expect(commandPath.split(path.delimiter)).toContain(path.join(env.HOME!, ".local", "bin"));
  });

  it("turns a missing provider CLI into an actionable setup error", async () => {
    const env = await providerEnvironment();
    const missing = Object.assign(new Error("spawn codex ENOENT"), { code: "ENOENT" });
    const results = await configureProviderMcp({ providers: ["codex"] }, {
      env,
      execute: async () => {
        throw missing;
      },
    });

    expect(results).toEqual([{
      provider: "codex",
      ok: false,
      detail: "Codex CLI was not found. Install it or add it to Exo's PATH, then try again.",
    }]);
  });
});
