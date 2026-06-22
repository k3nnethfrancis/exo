import { describe, expect, it } from "vitest";
import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

import type { AgentHarness } from "../agent-harness";
import {
  agentHarnessRegistry,
  AgentHarnessRegistry,
  resolveRegisteredAgentHarnesses,
  resolveRegisteredAgentLauncher,
  validateRegisteredAgentHarnessLaunch,
} from "../agent-harness-registry";
import { builtInAgentHarnesses } from "../agent-harnesses/builtins";

describe("agent harness registry", () => {
  it("registers built-in harnesses", () => {
    expect(agentHarnessRegistry.list().map((harness) => harness.metadata.id)).toEqual(["shell", "claude", "codex", "pi", "hermes"]);
    expect(agentHarnessRegistry.require("shell")).toBe(builtInAgentHarnesses.shell);
    expect(agentHarnessRegistry.require("claude")).toBe(builtInAgentHarnesses.claude);
    expect(agentHarnessRegistry.require("codex")).toBe(builtInAgentHarnesses.codex);
    expect(agentHarnessRegistry.require("pi")).toBe(builtInAgentHarnesses.pi);
    expect(agentHarnessRegistry.require("hermes")).toBe(builtInAgentHarnesses.hermes);
  });

  it("resolves launchers through the registered harness", () => {
    expect(resolveRegisteredAgentLauncher("shell", { SHELL: "/bin/zsh" })).toMatchObject({
      kind: "shell",
      title: "Terminal",
      command: "/bin/zsh",
      args: ["-l"],
    });
  });

  it("rejects duplicate harness ids", () => {
    const registry = new AgentHarnessRegistry([builtInAgentHarnesses.shell]);

    expect(() => registry.register(builtInAgentHarnesses.shell)).toThrow("Agent harness already registered: shell");
  });

  it("can register another harness implementation with the same contract", () => {
    const testHarness: AgentHarness = {
      ...builtInAgentHarnesses.shell,
      metadata: {
        ...builtInAgentHarnesses.shell.metadata,
        id: "test-shell",
        label: "Test Shell",
      },
      resolveLauncher: () => ({
        kind: "shell",
        title: "Test Shell",
        command: "zsh",
        args: ["-lc", "echo test"],
      }),
    };
    const registry = new AgentHarnessRegistry([builtInAgentHarnesses.shell, testHarness]);

    expect(registry.list().map((harness) => harness.metadata.id)).toEqual(["shell", "test-shell"]);
    expect(registry.get("test-shell")).toBe(testHarness);
  });

  it("surfaces a configured custom Pi build without committing local defaults", () => {
    const tempRoot = mkdtempSync(path.join(os.tmpdir(), "exo-pi-harness-"));
    const piCommand = path.join(tempRoot, "pi");
    writeFileSync(piCommand, "#!/bin/sh\nexit 0\n", "utf8");
    chmodSync(piCommand, 0o755);

    try {
      const harnesses = resolveRegisteredAgentHarnesses({
        PATH: "/usr/bin",
        EXO_PI_COMMAND: piCommand,
        EXO_PI_REPO_PATH: tempRoot,
        EXO_PI_LABEL: "GA Pi",
        EXO_PI_CHANNEL: "custom",
      });

      expect(harnesses.find((harness) => harness.id === "pi")).toMatchObject({
        id: "pi",
        adapterId: "pi",
        label: "GA Pi",
        configured: true,
        launchable: true,
        status: "configured",
        channel: "custom",
        executablePath: piCommand,
        repoPath: tempRoot,
      });
    } finally {
      rmSync(tempRoot, { recursive: true, force: true });
    }
  });

  it("auto-detects a Pi source checkout in project roots", () => {
    const tempRoot = mkdtempSync(path.join(os.tmpdir(), "exo-pi-source-"));
    const cliPath = path.join(tempRoot, "packages", "coding-agent", "dist", "cli.js");
    mkdirSync(path.dirname(cliPath), { recursive: true });
    writeFileSync(cliPath, "#!/usr/bin/env node\n", "utf8");

    try {
      const harnesses = resolveRegisteredAgentHarnesses({
        PATH: "/usr/bin",
        EXO_PROJECT_ROOTS: tempRoot,
      });

      expect(harnesses.find((harness) => harness.id === "pi")).toMatchObject({
        id: "pi",
        adapterId: "pi",
        configured: false,
        launchable: true,
        status: "available",
        channel: "source",
        repoPath: tempRoot,
        launcher: {
          command: process.execPath,
          args: [cliPath],
        },
      });
    } finally {
      rmSync(tempRoot, { recursive: true, force: true });
    }
  });

  it("keeps missing Hermes visible but not launchable", () => {
    const hermes = resolveRegisteredAgentHarnesses({ PATH: "/tmp/does-not-exist" }).find((harness) => harness.id === "hermes");

    expect(hermes).toMatchObject({
      id: "hermes",
      adapterId: "hermes",
      configured: false,
      detected: false,
      launchable: false,
      status: "not-found",
    });
  });

  it("rejects unavailable registered harnesses before launch", () => {
    expect(() => validateRegisteredAgentHarnessLaunch("hermes", { PATH: "/tmp/does-not-exist" })).toThrow(
      "Agent harness is not launchable: hermes (Not found).",
    );
  });
});
