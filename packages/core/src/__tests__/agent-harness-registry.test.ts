import { describe, expect, it } from "vitest";
import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

import type { AgentHarness } from "../agent-harness";
import {
  agentHarnessRegistry,
  AgentHarnessRegistry,
  resolveRegisteredAgentHarnessDetection,
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

  it("blocks a configured Pi executable when no inference backend is configured", () => {
    const tempRoot = mkdtempSync(path.join(os.tmpdir(), "exo-pi-missing-backend-"));
    const piCommand = path.join(tempRoot, "pi");
    writeFileSync(piCommand, "#!/bin/sh\nexit 0\n", "utf8");
    chmodSync(piCommand, 0o755);

    try {
      const pi = resolveRegisteredAgentHarnesses({
        PATH: "/usr/bin",
        EXO_PI_COMMAND: piCommand,
        EXO_PI_REPO_PATH: tempRoot,
      }).find((harness) => harness.id === "pi");

      expect(pi).toMatchObject({
        id: "pi",
        configured: true,
        detected: true,
        launchable: false,
        status: "missing-dependency",
        statusLabel: "Missing dependency",
        dependencies: [
          expect.objectContaining({
            id: "pi-inference-backend",
            kind: "inference-backend",
            required: true,
            configured: false,
            satisfied: false,
            statusLabel: "Missing",
          }),
        ],
      });
      expect(() => validateRegisteredAgentHarnessLaunch("pi", { EXO_PI_COMMAND: piCommand, EXO_PI_REPO_PATH: tempRoot })).toThrow(
        "Agent harness is not launchable: pi (Missing dependency).",
      );
    } finally {
      rmSync(tempRoot, { recursive: true, force: true });
    }
  });

  it("surfaces a configured custom Pi-compatible build without committing local defaults", () => {
    const tempRoot = mkdtempSync(path.join(os.tmpdir(), "exo-pi-harness-"));
    const piCommand = path.join(tempRoot, "pi");
    writeFileSync(piCommand, "#!/bin/sh\nexit 0\n", "utf8");
    chmodSync(piCommand, 0o755);

    try {
      const harnesses = resolveRegisteredAgentHarnesses({
        PATH: "/usr/bin",
        EXO_PI_COMMAND: piCommand,
        EXO_PI_REPO_PATH: tempRoot,
        EXO_PI_LABEL: "Custom Pi build",
        EXO_PI_CHANNEL: "custom",
        EXO_PI_BACKEND_URL: "http://127.0.0.1:8080",
      });

      expect(harnesses.find((harness) => harness.id === "pi")).toMatchObject({
        id: "pi",
        adapterId: "pi",
        label: "Custom Pi build",
        productName: "Pi-compatible harness",
        configured: true,
        launchable: true,
        status: "configured",
        channel: "custom",
        executablePath: piCommand,
        repoPath: tempRoot,
        dependencies: [
          expect.objectContaining({
            id: "pi-inference-backend",
            configured: true,
            satisfied: true,
            detail: "http://127.0.0.1:8080",
          }),
        ],
      });
    } finally {
      rmSync(tempRoot, { recursive: true, force: true });
    }
  });

  it("auto-detects a Pi source checkout but keeps launch unavailable until backend config exists", () => {
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
        launchable: false,
        status: "missing-dependency",
        channel: "source",
        repoPath: tempRoot,
        launcher: undefined,
        dependencies: [expect.objectContaining({ id: "pi-inference-backend", satisfied: false })],
      });
    } finally {
      rmSync(tempRoot, { recursive: true, force: true });
    }
  });

  it("hides unconfigured Hermes from normal harness lists", () => {
    const harnesses = resolveRegisteredAgentHarnesses({ PATH: "/tmp/does-not-exist" });

    expect(harnesses.find((harness) => harness.id === "hermes")).toBeUndefined();
    expect(resolveRegisteredAgentHarnessDetection("hermes", { PATH: "/tmp/does-not-exist" })).toMatchObject({
      id: "hermes",
      adapterId: "hermes",
      configured: false,
      detected: false,
      launchable: false,
      visible: false,
    });
  });

  it("surfaces explicitly configured Hermes without making it a default launcher", () => {
    const tempRoot = mkdtempSync(path.join(os.tmpdir(), "exo-hermes-harness-"));
    const hermesCommand = path.join(tempRoot, "hermes");
    writeFileSync(hermesCommand, "#!/bin/sh\nexit 0\n", "utf8");
    chmodSync(hermesCommand, 0o755);

    try {
      const hermes = resolveRegisteredAgentHarnesses({
        PATH: "/usr/bin",
        EXO_HERMES_COMMAND: hermesCommand,
      }).find((harness) => harness.id === "hermes");

      expect(hermes).toMatchObject({
        id: "hermes",
        configured: true,
        launchable: true,
        status: "configured",
        executablePath: hermesCommand,
      });
    } finally {
      rmSync(tempRoot, { recursive: true, force: true });
    }
  });

  it("rejects unavailable registered harnesses before launch", () => {
    expect(() => validateRegisteredAgentHarnessLaunch("hermes", { PATH: "/tmp/does-not-exist" })).toThrow(
      "Agent harness is not launchable: hermes (Disabled).",
    );
  });
});
