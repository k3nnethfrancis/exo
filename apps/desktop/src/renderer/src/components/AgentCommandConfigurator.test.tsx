import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import {
  createDefaultClaudeAgentCommand,
  createDefaultCodexAgentCommand,
} from "@exo/core";

import {
  AgentCommandConfigurator,
  addRecommendedAgentCommand,
  customCommandDraftError,
} from "./AgentCommandConfigurator";

describe("AgentCommandConfigurator", () => {
  it("keeps recommended templates primary and Custom subordinate", () => {
    const html = renderToStaticMarkup(
      <AgentCommandConfigurator
        commands={[createDefaultClaudeAgentCommand(), createDefaultCodexAgentCommand()]}
        onChange={() => {}}
        testId="commands"
      />,
    );

    expect(html.indexOf("Recommended")).toBeLessThan(html.indexOf("Custom"));
    expect(html).toContain("Claude and Codex templates");
    expect(html).toContain("One provider-neutral local command");
    expect(html).toContain("Add Custom");
    expect(html).toContain("Executable and arguments");
  });

  it("keeps removed recommended templates available without replacing Custom configuration", () => {
    const custom = {
      ...createDefaultCodexAgentCommand(),
      id: "custom",
      label: "Local",
      handle: "local",
      command: "/usr/local/bin/local-agent --json",
      adapter: "generic" as const,
    };

    expect(addRecommendedAgentCommand([custom], "codex")).toEqual([
      createDefaultCodexAgentCommand(),
      custom,
    ]);
    expect(addRecommendedAgentCommand([createDefaultCodexAgentCommand(), custom], "codex")).toEqual([
      createDefaultCodexAgentCommand(),
      custom,
    ]);
  });

  it("validates the single Custom draft before it enters persisted configuration", () => {
    const configured = [createDefaultClaudeAgentCommand(), createDefaultCodexAgentCommand()];
    expect(customCommandDraftError({ label: "", handle: "", command: "", adapter: "generic", continuityPolicy: "fresh" }, configured))
      .toBe("Enter a name.");
    expect(customCommandDraftError({ label: "Claude copy", handle: "claude", command: "/bin/echo", adapter: "generic", continuityPolicy: "fresh" }, configured))
      .toBe("@claude is already configured.");
    expect(customCommandDraftError({ label: "Local", handle: "local", command: "/bin/echo --ready", adapter: "generic", continuityPolicy: "fresh" }, configured))
      .toBeNull();
  });
});
