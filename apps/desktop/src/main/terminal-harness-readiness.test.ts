import os from "node:os";
import path from "node:path";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";

import { afterEach, describe, expect, it, vi } from "vitest";
import { resolveRuntimeConfig } from "@exo/core";

import type { TerminalSessionInfo } from "../shared/api";
import {
  harnessLaunchArgs,
  initialHarnessReadiness,
  observeHarnessReadiness,
  semanticMessageWrite,
  shouldQueueRawWrite,
  shouldQueueSemanticMessage,
} from "./terminal-harness-readiness";

const tempPaths: string[] = [];

afterEach(async () => {
  vi.unstubAllEnvs();
  await Promise.all(tempPaths.splice(0).map((targetPath) => rm(targetPath, { recursive: true, force: true })));
});

describe("terminal harness readiness", () => {
  it("gates Codex startup while other harnesses start ready", () => {
    expect(initialHarnessReadiness("codex")).toBe("starting");
    expect(initialHarnessReadiness("claude")).toBe("ready");
    expect(initialHarnessReadiness("shell")).toBe("ready");
  });

  it("keeps Codex semantic sends queued until chat input is ready", () => {
    const info = terminalInfo({ kind: "codex", readiness: "starting" });

    expect(shouldQueueSemanticMessage(info, true)).toBe(true);
    expect(shouldQueueSemanticMessage(info, false)).toBe(false);
    expect(shouldQueueRawWrite(info, "work on this\r")).toBe(true);
    expect(shouldQueueRawWrite(info, "\u0003")).toBe(false);

    expect(observeHarnessReadiness(info, "OpenAI Codex\n› ")).toMatchObject({
      readiness: "ready",
      readinessDetail: "Codex chat input is ready.",
      flushQueued: true,
      clearTimer: true,
    });
  });

  it("keeps queued Codex sends blocked at trust and update prompts", () => {
    const info = terminalInfo({ kind: "codex", readiness: "starting" });

    expect(observeHarnessReadiness(info, "Do you trust the files in this folder?")).toMatchObject({
      readiness: "blocked",
      readinessDetail: "Codex startup trust prompt is waiting for interactive confirmation.",
      flushQueued: false,
      clearTimer: true,
    });
    expect(observeHarnessReadiness(info, "OpenAI Codex\nUpdate available!\n3. Skip until next version")).toMatchObject({
      readiness: "blocked",
      readinessDetail: "Codex startup update prompt is waiting for Skip, Skip until next version, or Update.",
      flushQueued: false,
      clearTimer: true,
    });
  });

  it("uses bracketed paste for agent messages and plain text for shell messages", () => {
    expect(semanticMessageWrite("shell", "echo hello")).toBe("echo hello");
    expect(semanticMessageWrite("claude", "line 1\nline 2")).toBe("\x1b[200~line 1\nline 2\x1b[201~");
  });

  it("prepares Codex MCP launch args from the imported Exo project root, not the agent worktree cwd", async () => {
    const mainRoot = await makeExoCheckout("exo-desktop-mcp-main-");
    const worktreeRoot = await makeExoCheckout("exo-desktop-mcp-worktree-");
    vi.stubEnv("NODE", "/opt/homebrew/bin/node");

    const config = resolveRuntimeConfig({
      EXO_WORKSPACE_ROOT: path.dirname(mainRoot),
      EXO_NOTE_ROOTS: path.join(path.dirname(mainRoot), "notes"),
      EXO_PROJECT_ROOTS: mainRoot,
      EXO_CODEX_COMMAND: "codex",
    });

    const args = harnessLaunchArgs("codex", ['-c', 'model_reasoning_effort="high"'], config, worktreeRoot);

    expect(args).toContain('mcp_servers.exo.command="/opt/homebrew/bin/node"');
    expect(args).toContain(`mcp_servers.exo.args=["${mainRoot}/packages/mcp/bin/exo-mcp.mjs"]`);
    expect(args).not.toContain(`mcp_servers.exo.args=["${worktreeRoot}/packages/mcp/bin/exo-mcp.mjs"]`);
  });
});

async function makeExoCheckout(prefix: string): Promise<string> {
  const root = await mkdtemp(path.join(os.tmpdir(), prefix));
  tempPaths.push(root);
  await mkdir(path.join(root, "packages", "mcp", "bin"), { recursive: true });
  await writeFile(path.join(root, "package.json"), JSON.stringify({ name: "exo" }), "utf8");
  await writeFile(path.join(root, "packages", "mcp", "bin", "exo-mcp.mjs"), "#!/usr/bin/env node\n", "utf8");
  return root;
}

function terminalInfo(overrides: Partial<TerminalSessionInfo>): TerminalSessionInfo {
  return {
    id: "term-1",
    title: "Codex",
    cwd: "/workspace",
    terminalKind: "agent",
    harnessId: "codex",
    kind: "codex",
    command: "codex",
    status: "running",
    readiness: "ready",
    queuedInputCount: 0,
    attachGeneration: 1,
    ...overrides,
  };
}
