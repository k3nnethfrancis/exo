import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import { TerminalSessionRegistry } from "./terminal-session-registry";

const tempPaths: string[] = [];

afterEach(async () => {
  vi.restoreAllMocks();
  await Promise.all(tempPaths.splice(0).map((target) => rm(target, { recursive: true, force: true })));
});

describe("TerminalSessionRegistry", () => {
  it("loads persisted sessions and recovers nextId from existing terminal ids", async () => {
    const filePath = await registryFixture({
      sessions: [
        {
          id: "term-7",
          title: "Shell",
          cwd: "/tmp/work",
          kind: "shell",
          command: "/bin/zsh",
          tmuxSessionName: "exo-session",
          transcriptPath: "/tmp/work/.exo/terminal-transcripts/term-7.ansi.log",
          createdAt: "2026-06-21T00:00:00.000Z",
          lastAttachedAt: null,
          status: "running",
        },
        {
          id: "bad",
          title: "Bad",
          cwd: "/tmp/work",
          kind: "invalid",
          command: "bad",
          tmuxSessionName: "bad",
          transcriptPath: "bad",
          createdAt: "2026-06-21T00:00:00.000Z",
          lastAttachedAt: null,
          status: "running",
        },
      ],
    });

    expect(new TerminalSessionRegistry(filePath).load()).toMatchObject({
      nextId: 8,
      sessions: [
        {
          id: "term-7",
          status: "running",
          tmuxSessionName: "exo-session",
        },
      ],
    });
  });

  it("saves the byte-compatible terminal registry shape", async () => {
    const filePath = await registryFixture({ sessions: [], nextId: 1 });
    const registry = new TerminalSessionRegistry(filePath);

    registry.save(3, [
      {
        info: {
          id: "term-2",
          title: "Codex",
          cwd: "/tmp/work",
          kind: "codex",
          command: "codex",
          instructionOverlayPath: null,
          status: "exited",
          exitCode: 1,
          readiness: "starting",
          readinessDetail: "Waiting briefly for Codex startup interstitials.",
          healthDetail: "Process exited with code 1.",
        },
        tmuxSessionName: "exo-session",
        tmuxPaneId: "%1",
        transcriptPath: "/tmp/work/.exo/terminal-transcripts/term-2.ansi.log",
        createdAt: "2026-06-21T00:00:00.000Z",
      },
    ]);

    const saved = JSON.parse(await readFile(filePath, "utf8"));
    expect(saved).toMatchObject({
      version: 1,
      nextId: 3,
      sessions: [
        {
          id: "term-2",
          kind: "codex",
          status: "exited",
          tmuxPaneId: "%1",
          readiness: "starting",
        },
      ],
    });
    expect(typeof saved.sessions[0].lastAttachedAt).toBe("string");
  });
});

async function registryFixture(contents: unknown): Promise<string> {
  const directory = await mkdtemp(path.join(os.tmpdir(), "exo-terminal-registry-"));
  tempPaths.push(directory);
  const filePath = path.join(directory, ".exo", "terminal-sessions.json");
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, JSON.stringify(contents), "utf8");
  return filePath;
}
