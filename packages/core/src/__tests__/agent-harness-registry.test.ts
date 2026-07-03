import { describe, expect, it } from "vitest";
import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

import type { AgentHarness } from "../agent-harness";
import {
  agentHarnessRegistry,
  AgentHarnessRegistry,
  formatRegisteredAgentHarnessUsage,
  normalizeRegisteredAgentHarnessKindForSurface,
  resolveRegisteredAgentHarnessDetection,
  resolveRegisteredAgentHarnesses,
  resolveRegisteredAgentHarnessesForSurface,
  resolveRegisteredAgentLauncher,
  resolveRegisteredAgentLaunchers,
  validateRegisteredAgentHarnessLaunch,
  validateRegisteredAgentHarnessLaunchForSurface,
} from "../agent-harness-registry";
import { builtInAgentHarnesses } from "../agent-harnesses/builtins";
import {
  formatManagedAgentKindUsage,
  MANAGED_AGENT_KINDS,
  normalizeManagedAgentKind,
  terminalSubstrateKindForManagedAgentKind,
} from "../types";

describe("agent harness registry", () => {
  it("keeps built-in harness kind parsing and usage in one core boundary", () => {
    expect(MANAGED_AGENT_KINDS).toEqual(["shell", "claude", "codex", "pi", "hermes"]);
    expect(formatManagedAgentKindUsage()).toBe("shell|claude|codex|pi|hermes");
    expect(normalizeManagedAgentKind("codex")).toBe("codex");
    expect(normalizeManagedAgentKind("unknown")).toBeNull();
    expect(terminalSubstrateKindForManagedAgentKind("shell")).toBe("shell");
    expect(terminalSubstrateKindForManagedAgentKind("codex")).toBe("agent");
  });

  it("registers built-in harnesses", () => {
    expect(agentHarnessRegistry.list().map((harness) => harness.metadata.id)).toEqual([...MANAGED_AGENT_KINDS]);
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

  it("resolves the runtime launcher record from the managed harness kind boundary", () => {
    const launchers = resolveRegisteredAgentLaunchers({ SHELL: "/bin/zsh" });

    expect(Object.keys(launchers)).toEqual([...MANAGED_AGENT_KINDS]);
    expect(launchers.shell).toMatchObject({ kind: "shell", command: "/bin/zsh" });
    expect(launchers.codex).toMatchObject({ kind: "codex", command: "codex" });
  });

  it("standardizes readiness and setup metadata for built-in harness inventory", () => {
    const tempRoot = mkdtempSync(path.join(os.tmpdir(), "exo-harness-metadata-"));
    const claudeCommand = path.join(tempRoot, "claude");
    const codexCommand = path.join(tempRoot, "codex");
    const piCommand = path.join(tempRoot, "pi");
    const hermesCommand = path.join(tempRoot, "hermes");
    for (const command of [claudeCommand, codexCommand, piCommand, hermesCommand]) {
      writeFileSync(command, "#!/bin/sh\nexit 0\n", "utf8");
      chmodSync(command, 0o755);
    }

    try {
      const env = {
        PATH: "/usr/bin",
        EXO_CLAUDE_COMMAND: claudeCommand,
        EXO_CODEX_COMMAND: codexCommand,
        EXO_PI_COMMAND: piCommand,
        EXO_PI_REPO_PATH: tempRoot,
        EXO_PI_BACKEND_URL: "http://127.0.0.1:8080",
        EXO_PI_BACKEND_READY: "1",
        EXO_HERMES_COMMAND: hermesCommand,
      };
      const harnesses = resolveRegisteredAgentHarnesses(env);

      for (const id of ["claude", "codex", "pi", "hermes"] as const) {
        expect(harnesses.find((harness) => harness.id === id)).toMatchObject({
          id,
          configured: true,
          detected: true,
          launchable: true,
          executablePath: id === "claude" ? claudeCommand : id === "codex" ? codexCommand : id === "pi" ? piCommand : hermesCommand,
          setupSummary: "Configured and ready to launch.",
        });
      }
      expect(harnesses.find((harness) => harness.id === "pi")).toMatchObject({
        repoPath: tempRoot,
        install: { label: "Configure a local Pi build" },
        dependencies: [expect.objectContaining({ id: "pi-inference-backend", satisfied: true })],
      });
      expect(harnesses.find((harness) => harness.id === "hermes")).toMatchObject({
        install: { label: "Configure Hermes" },
      });
    } finally {
      rmSync(tempRoot, { recursive: true, force: true });
    }
  });

  it("declares built-in semantic message and readiness behavior as harness contract metadata", () => {
    expect(builtInAgentHarnesses.shell).toMatchObject({
      contractVersion: "agent-harness.v1",
      terminalOwnership: "core",
      semanticMessages: {
        defaultMode: "stdin",
        submitOnEnter: true,
      },
    });
    expect(builtInAgentHarnesses.claude).toMatchObject({
      contractVersion: "agent-harness.v1",
      terminalOwnership: "core",
      adapter: {
        family: "claude-code",
        productName: "Claude Code",
      },
      semanticMessages: {
        defaultMode: "paste-enter",
        supportsMultiline: true,
      },
    });
    expect(builtInAgentHarnesses.codex).toMatchObject({
      contractVersion: "agent-harness.v1",
      terminalOwnership: "core",
      adapter: {
        family: "codex",
        productName: "Codex CLI",
      },
      semanticMessages: {
        defaultMode: "paste-enter",
        queueSubmittedInputUntilReady: true,
        readiness: {
          signal: "prompt-pattern",
          initialReadiness: "starting",
          initialDetail: "Waiting briefly for Codex startup interstitials.",
          readyDetail: "Codex chat input is ready.",
          graceReadyDetail: "Codex startup grace elapsed.",
          blockedPatterns: [
            expect.objectContaining({ id: "trust", readiness: "blocked" }),
            expect.objectContaining({ id: "update", readiness: "blocked" }),
          ],
        },
      },
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

  it("accepts the richer adapter contract needed by local and open-source harness plugins", () => {
    const localHarness: AgentHarness = {
      contractVersion: "agent-harness.v1",
      metadata: {
        ...builtInAgentHarnesses.shell.metadata,
        id: "local.llama-agent",
        label: "Local Llama Agent",
        owner: "local.plugin",
      },
      kind: "shell",
      title: "Local Llama Agent",
      adapter: {
        id: "local:llama-agent",
        family: "local",
        productName: "Local Llama Agent",
        executableNames: ["llama-agent"],
      },
      terminalOwnership: "core",
      skills: [
        {
          id: "repo-edit",
          label: "Repository editing",
          source: "filesystem",
          enabled: true,
          required: true,
          configPaths: [".llama-agent/skills/repo-edit"],
        },
      ],
      configs: [
        {
          id: "model-path",
          label: "Model path",
          source: "environment",
          valueKind: "path",
          required: true,
          configured: true,
          envVar: "LLAMA_AGENT_MODEL",
        },
      ],
      semanticMessages: {
        modes: ["paste-enter", "file"],
        defaultMode: "paste-enter",
        supportsMultiline: true,
        submitOnEnter: true,
        readiness: {
          signal: "prompt-pattern",
          pattern: "Ready",
          timeoutMs: 10_000,
        },
      },
      semanticTrace: {
        schemaVersion: "exo.semantic-trace.v1",
        sources: ["stdout-jsonl", "hooks"],
        eventKinds: ["session.started", "message", "tool.call", "tool.result", "file.change"],
        defaultVisibility: "private",
        artifactFileName: "semantic-trace.jsonl",
      },
      setup: {
        summary: "Install the local agent binary and configure LLAMA_AGENT_MODEL.",
        actions: [
          {
            id: "configure-model",
            kind: "configure",
            label: "Set LLAMA_AGENT_MODEL",
            required: true,
          },
        ],
      },
      resolveLauncher: () => ({
        kind: "shell",
        title: "Local Llama Agent",
        command: "llama-agent",
        args: ["--interactive"],
      }),
    };

    const registry = new AgentHarnessRegistry([localHarness]);

    expect(registry.get("local.llama-agent")).toMatchObject({
      contractVersion: "agent-harness.v1",
      adapter: { family: "local", id: "local:llama-agent" },
      semanticMessages: { defaultMode: "paste-enter", supportsMultiline: true },
      semanticTrace: {
        schemaVersion: "exo.semantic-trace.v1",
        sources: ["stdout-jsonl", "hooks"],
        eventKinds: ["session.started", "message", "tool.call", "tool.result", "file.change"],
      },
      terminalOwnership: "core",
    });
    expect(registry.list().map((harness) => harness.metadata.id)).toEqual(["local.llama-agent"]);
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
        setupSummary: "Configure EXO_PI_BACKEND_URL or EXO_PI_BACKEND_COMMAND for a compatible local inference backend.",
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
      expect(() =>
        validateRegisteredAgentHarnessLaunchForSurface(
          "pi",
          { surface: "commandServer", requireLaunchable: true },
          { EXO_PI_COMMAND: piCommand, EXO_PI_REPO_PATH: tempRoot },
        ),
      ).toThrow("Approved launchable harnesses for commandServer:");
    } finally {
      rmSync(tempRoot, { recursive: true, force: true });
    }
  });

  it("blocks a configured custom Pi-compatible build until backend readiness is confirmed", () => {
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
        EXO_PI_BACKEND_COMMAND: "pi-backend --port 8080",
      });

      expect(harnesses.find((harness) => harness.id === "pi")).toMatchObject({
        id: "pi",
        adapterId: "pi",
        label: "Custom Pi build",
        productName: "Pi-compatible harness",
        configured: true,
        launchable: false,
        status: "missing-dependency",
        setupSummary:
          "Pi backend is configured but not confirmed ready. Set EXO_PI_BACKEND_READY=1 after starting it. URL: http://127.0.0.1:8080 Start command: pi-backend --port 8080",
        channel: "custom",
        executablePath: piCommand,
        repoPath: tempRoot,
        dependencies: [
          expect.objectContaining({
            id: "pi-inference-backend",
            configured: true,
            detected: false,
            satisfied: false,
            statusLabel: "Not ready",
            detail:
              "Pi backend is configured but not confirmed ready. Set EXO_PI_BACKEND_READY=1 after starting it. URL: http://127.0.0.1:8080 Start command: pi-backend --port 8080",
            autoStart: {
              command: "pi-backend --port 8080",
              probeUrl: "http://127.0.0.1:8080",
              readyEnv: { EXO_PI_BACKEND_READY: "1" },
            },
          }),
        ],
      });
      expect(() =>
        validateRegisteredAgentHarnessLaunchForSurface("pi", { surface: "commandServer", requireLaunchable: true }, {
          PATH: "/usr/bin",
          EXO_PI_COMMAND: piCommand,
          EXO_PI_REPO_PATH: tempRoot,
          EXO_PI_BACKEND_URL: "http://127.0.0.1:8080",
        }),
      ).toThrow("Approved launchable harnesses for commandServer:");
    } finally {
      rmSync(tempRoot, { recursive: true, force: true });
    }
  });

  it("surfaces a ready custom Pi-compatible build without committing local defaults", () => {
    const tempRoot = mkdtempSync(path.join(os.tmpdir(), "exo-pi-ready-harness-"));
    const piCommand = path.join(tempRoot, "pi");
    writeFileSync(piCommand, "#!/bin/sh\nexit 0\n", "utf8");
    chmodSync(piCommand, 0o755);

    try {
      const env = {
        PATH: "/usr/bin",
        EXO_PI_COMMAND: piCommand,
        EXO_PI_REPO_PATH: tempRoot,
        EXO_PI_LABEL: "Custom Pi build",
        EXO_PI_CHANNEL: "custom",
        EXO_PI_BACKEND_URL: "http://127.0.0.1:8080",
        EXO_PI_BACKEND_READY: "1",
      };
      const harnesses = resolveRegisteredAgentHarnesses(env);

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
            detected: true,
            satisfied: true,
            statusLabel: "Ready",
            detail: "http://127.0.0.1:8080",
          }),
        ],
      });
      expect(validateRegisteredAgentHarnessLaunchForSurface("pi", { surface: "commandServer", requireLaunchable: true }, env)).toMatchObject({
        harnessId: "pi",
        terminalKind: "pi",
        launcher: { kind: "pi", command: piCommand },
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
    chmodSync(cliPath, 0o755);

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
        executablePath: expect.stringMatching(/\/node$/),
        launcher: undefined,
        setupSummary: "Configure EXO_PI_BACKEND_URL or EXO_PI_BACKEND_COMMAND for a compatible local inference backend.",
        dependencies: [expect.objectContaining({ id: "pi-inference-backend", satisfied: false })],
      });
    } finally {
      rmSync(tempRoot, { recursive: true, force: true });
    }
  });

  it("does not expose Codex or packaged Exo commands as Pi-compatible executables", () => {
    const tempRoot = mkdtempSync(path.join(os.tmpdir(), "exo-pi-cross-command-"));
    const codexPath = path.join(tempRoot, "codex");
    const exoPath = path.join(tempRoot, "Exo.app", "Contents", "MacOS", "Exo");
    mkdirSync(path.dirname(exoPath), { recursive: true });
    writeFileSync(codexPath, "#!/bin/sh\nexit 0\n", "utf8");
    writeFileSync(exoPath, "#!/bin/sh\nexit 0\n", "utf8");
    chmodSync(codexPath, 0o755);
    chmodSync(exoPath, 0o755);

    try {
      for (const command of [codexPath, exoPath]) {
        const pi = resolveRegisteredAgentHarnessDetection("pi", {
          PATH: tempRoot,
          EXO_PI_COMMAND: command,
          EXO_PI_BACKEND_URL: "http://127.0.0.1:8080",
        });

        expect(pi).toBeDefined();
        if (!pi) {
          throw new Error("Expected Pi-compatible harness detection.");
        }
        expect(pi.id).toBe("pi");
        expect(pi.launchable).toBe(false);
        expect(pi.executablePath).toBeUndefined();
        expect(pi.launcher).toBeUndefined();
        expect(JSON.stringify(pi)).not.toContain(command);
        expect(JSON.stringify(pi)).not.toContain("codex");
        expect(JSON.stringify(pi)).not.toContain("Contents/MacOS/Exo");
      }
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
      setupSummary: "Disabled.",
      visible: false,
    });
    expect(() =>
      validateRegisteredAgentHarnessLaunchForSurface("hermes", { surface: "commandServer", requireLaunchable: true }, { PATH: "/tmp/does-not-exist" }),
    ).toThrow("Agent harness is registered but not enabled for commandServer launch: hermes");
  });

  it("derives CLI/MCP agent creation choices from registered visible harnesses", () => {
    const env = { PATH: "/tmp/does-not-exist", SHELL: "/bin/zsh" };

    expect(resolveRegisteredAgentHarnessesForSurface({ surface: "cli" }, env).map((harness) => harness.id)).toEqual([
      "shell",
      "claude",
      "codex",
      "pi",
    ]);
    expect(formatRegisteredAgentHarnessUsage({ surface: "mcp" }, env)).toBe("shell|claude|codex|pi");
    expect(normalizeRegisteredAgentHarnessKindForSurface("codex", { surface: "cli" }, env)).toBe("codex");
    expect(normalizeRegisteredAgentHarnessKindForSurface("hermes", { surface: "cli" }, env)).toBeNull();
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
      expect(formatRegisteredAgentHarnessUsage({ surface: "cli" }, {
        PATH: "/usr/bin",
        EXO_HERMES_COMMAND: hermesCommand,
      })).toBe("shell|claude|codex|pi|hermes");
    } finally {
      rmSync(tempRoot, { recursive: true, force: true });
    }
  });

  it("rejects unavailable registered harnesses before launch", () => {
    expect(() => validateRegisteredAgentHarnessLaunch("hermes", { PATH: "/tmp/does-not-exist" })).toThrow(
      "Agent harness is not launchable: hermes (Disabled).",
    );
  });

  it("reports registered, approved, and launchable public harness choices for invalid ids", () => {
    expect(() =>
      validateRegisteredAgentHarnessLaunchForSurface(
        "aider",
        { surface: "commandServer", requireLaunchable: true },
        { PATH: "/bin:/usr/bin", EXO_CODEX_COMMAND: "/bin/sh", EXO_CLAUDE_COMMAND: "/bin/sh" },
      ),
    ).toThrow(
      "Agent harness is not registered: aider. Registered harnesses: shell|claude|codex|pi|hermes. Approved launchable harnesses for commandServer: shell|claude|codex.",
    );
  });
});
