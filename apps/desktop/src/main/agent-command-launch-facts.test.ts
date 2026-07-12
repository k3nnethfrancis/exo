import { chmod, mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { createDefaultClaudeAgentCommand } from "@exo/core";

import { executableToken, inspectAgentCommandLaunchFacts } from "./agent-command-launch-facts";

const temporaryRoots: string[] = [];

afterEach(async () => {
  await Promise.all(temporaryRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("agent command launch facts", () => {
  it("resolves an executable without running the configured command", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "exo-command-facts-"));
    temporaryRoots.push(root);
    const bin = path.join(root, "bin");
    const executable = path.join(bin, "fake-agent");
    await mkdir(bin);
    await writeFile(executable, "#!/bin/sh\nexit 0\n");
    await chmod(executable, 0o755);

    const facts = await inspectAgentCommandLaunchFacts(
      { ...createDefaultClaudeAgentCommand(), id: "fake", handle: "fake", label: "Fake", command: "fake-agent --flag" },
      { kind: "cli", workspaceRoot: root },
      { PATH: bin },
    );

    expect(facts).toMatchObject({
      cwd: root,
      cwdReady: true,
      executable: "fake-agent",
      executablePath: executable,
      executableReady: true,
      launchable: true,
    });
  });

  it("reports independent cwd and executable launch gates", async () => {
    const facts = await inspectAgentCommandLaunchFacts(
      { ...createDefaultClaudeAgentCommand(), command: "missing-agent" },
      { kind: "cli", workspaceRoot: "/definitely/missing/exo-workspace" },
      { PATH: "" },
    );
    expect(facts).toMatchObject({ cwdReady: false, executableReady: false, launchable: false, block: "cwd-missing" });
  });

  it("finds a user-installed command from a minimal packaged-app PATH", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "exo-command-facts-"));
    temporaryRoots.push(root);
    const localBin = path.join(root, ".local", "bin");
    const executable = path.join(localBin, "claude");
    await mkdir(localBin, { recursive: true });
    await writeFile(executable, "#!/bin/sh\nexit 0\n");
    await chmod(executable, 0o755);

    const facts = await inspectAgentCommandLaunchFacts(
      createDefaultClaudeAgentCommand(),
      { kind: "cli", workspaceRoot: root },
      { HOME: root, PATH: "/usr/bin:/bin" },
    );

    expect(facts).toMatchObject({ executablePath: executable, executableReady: true, launchable: true });
  });

  it("extracts quoted executable tokens without interpreting the shell command", () => {
    expect(executableToken("'/Applications/Fake Agent/bin/fake' --test")).toBe("/Applications/Fake Agent/bin/fake");
    expect(executableToken("fake\\ agent --test")).toBe("fake agent");
  });
});
