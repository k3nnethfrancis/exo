import { describe, expect, it } from "vitest";

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
});
