import { describe, expect, it } from "vitest";

import type { AgentHarness } from "../agent-harness";
import {
  agentHarnessRegistry,
  AgentHarnessRegistry,
  resolveRegisteredAgentLauncher,
} from "../agent-harness-registry";
import { builtInAgentHarnesses } from "../agent-harnesses/builtins";

describe("agent harness registry", () => {
  it("registers shell, Claude, and Codex as built-in harnesses", () => {
    expect(agentHarnessRegistry.list().map((harness) => harness.metadata.id)).toEqual(["shell", "claude", "codex"]);
    expect(agentHarnessRegistry.require("shell")).toBe(builtInAgentHarnesses.shell);
    expect(agentHarnessRegistry.require("claude")).toBe(builtInAgentHarnesses.claude);
    expect(agentHarnessRegistry.require("codex")).toBe(builtInAgentHarnesses.codex);
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
});
