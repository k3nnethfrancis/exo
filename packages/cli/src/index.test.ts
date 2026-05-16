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
          EXO_WORKSPACE_ROOT: "/tmp/exo-test-workspace",
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

  it("calls the app for index status", async () => {
    const runtimeRoot = await mkdtemp(path.join(os.tmpdir(), "exo-cli-"));
    const server = createServer((req, res) => {
      if (req.url === "/status") {
        json(res, { ok: true });
        return;
      }
      if (req.url === "/index/status") {
        json(res, { enabled: true, mode: "hybrid", backend: "qmd" });
        return;
      }
      res.writeHead(404).end();
    });

    try {
      const port = await listen(server);
      await writeFile(path.join(runtimeRoot, "server.json"), JSON.stringify({ port, pid: process.pid }), "utf8");
      let stdout = "";

      const exitCode = await runCli(["node", "exo-cli", "index", "status"], {
        env: { EXO_WORKSPACE_ROOT: "/tmp/exo-test-workspace", EXO_RUNTIME_ROOT: runtimeRoot },
        stdout: { write: (text) => { stdout += text; } },
        stderr: { write: () => {} },
      });

      expect(exitCode).toBe(0);
      expect(stdout).toContain('"mode": "hybrid"');
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
      await rm(runtimeRoot, { recursive: true, force: true });
    }
  });

  it("adds index roots through the app settings route", async () => {
    const runtimeRoot = await mkdtemp(path.join(os.tmpdir(), "exo-cli-"));
    let receivedBody = "";
    const server = createServer((req, res) => {
      if (req.url === "/status") {
        json(res, { ok: true });
        return;
      }
      if (req.url === "/index/roots" && req.method === "POST") {
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

      const exitCode = await runCli(["node", "exo-cli", "index", "add", "notes", "--name", "notes", "--kind", "notes"], {
        env: { EXO_WORKSPACE_ROOT: "/tmp/exo-test-workspace", EXO_RUNTIME_ROOT: runtimeRoot },
        cwd: "/tmp/exo-test-workspace",
        stdout: { write: () => {} },
        stderr: { write: () => {} },
      });

      expect(exitCode).toBe(0);
      expect(JSON.parse(receivedBody)).toMatchObject({ path: "/tmp/exo-test-workspace/notes", name: "notes", kind: "notes" });
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
      await rm(runtimeRoot, { recursive: true, force: true });
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
