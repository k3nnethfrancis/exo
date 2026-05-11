import { describe, expect, it } from "vitest";
import { createServer, type ServerResponse } from "node:http";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { runCli } from "./index";

describe("cli package", () => {
  it("renders runtime status", async () => {
    let stdout = "";
    const exitCode = await runCli(["node", "exo-cli", "runtime", "status"], {
      env: {
        EXO_WORKSPACE_ROOT: "/tmp/lab",
        EXO_NOTE_ROOTS: "/tmp/lab/notes",
        EXO_PROJECT_ROOTS: "/tmp/lab/projects",
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
    expect(stdout).toContain('"workspaceRoot": "/tmp/lab"');
    expect(stdout).toContain('"kind": "qmd"');
  });

  it("renders a launch plan for Claude", async () => {
    let stdout = "";
    const exitCode = await runCli(["node", "exo-cli", "runtime", "launch-plan", "claude", "/tmp/lab/projects/helm"], {
      env: {
        EXO_WORKSPACE_ROOT: "/tmp/lab",
        EXO_NOTE_ROOTS: "/tmp/lab/notes",
        EXO_PROJECT_ROOTS: "/tmp/lab/projects",
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
    expect(stdout).toContain('"/tmp/lab/projects/helm"');
    expect(stdout).toContain('"EXO_RUNTIME_PRIMARY_INSTRUCTIONS"');
  });

  it("syncs runtime instruction files", async () => {
    let stdout = "";
    const exitCode = await runCli(["node", "exo-cli", "runtime", "sync"], {
      env: {
        EXO_WORKSPACE_ROOT: "/tmp/lab",
        EXO_NOTE_ROOTS: "/tmp/lab/notes",
        EXO_PROJECT_ROOTS: "/tmp/lab/projects",
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
    expect(stdout).toContain('"/tmp/lab/.exo/instructions/AGENTS.md"');
    expect(stdout).toContain('"/tmp/lab/.exo/instructions/CLAUDE.md"');
  });

  it("launches a shell with Exo runtime env", async () => {
    let stdout = "";
    const exitCode = await runCli(["node", "exo-cli", "launch", "shell", "/tmp"], {
      env: {
        EXO_WORKSPACE_ROOT: "/tmp/lab",
        EXO_NOTE_ROOTS: "/tmp/lab/notes",
        EXO_PROJECT_ROOTS: "/tmp/lab/projects",
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
    expect(stdout).toContain("|/tmp/lab/.exo/instructions/AGENTS.md");
  });

  it("submits agent messages by default", async () => {
    const runtimeRoot = await mkdtemp(path.join(os.tmpdir(), "exo-cli-"));
    let receivedBody = "";
    const server = createServer((req, res) => {
      if (req.url === "/status") {
        json(res, { ok: true });
        return;
      }
      if (req.url === "/terminals/term-1/write" && req.method === "POST") {
        req.on("data", (chunk) => {
          receivedBody += chunk;
        });
        req.on("end", () => json(res, { ok: true }));
        return;
      }
      res.writeHead(404).end();
    });

    try {
      const port = await listen(server);
      await writeFile(path.join(runtimeRoot, "server.json"), JSON.stringify({ port, pid: process.pid }), "utf8");

      const exitCode = await runCli(["node", "exo-cli", "agents", "send", "term-1", "hello"], {
        env: {
          EXO_WORKSPACE_ROOT: "/tmp/lab",
          EXO_RUNTIME_ROOT: runtimeRoot,
        },
        stdout: { write: () => {} },
        stderr: { write: () => {} },
      });

      expect(exitCode).toBe(0);
      expect(JSON.parse(receivedBody)).toEqual({ data: "hello\r" });
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
      await rm(runtimeRoot, { recursive: true, force: true });
    }
  });
});

function listen(server: ReturnType<typeof createServer>): Promise<number> {
  return new Promise((resolve, reject) => {
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (typeof address === "object" && address) {
        resolve(address.port);
      } else {
        reject(new Error("No server address"));
      }
    });
  });
}

function json(res: ServerResponse, body: unknown) {
  res.writeHead(200, { "Content-Type": "application/json" });
  res.end(JSON.stringify(body));
}
