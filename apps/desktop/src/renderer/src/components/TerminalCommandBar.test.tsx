import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

import { createDefaultClaudeAgentCommand } from "@exo/core";

import { runConfirmedCommandTest, TerminalCommandBarView } from "./TerminalCommandBar";

describe("TerminalCommandBarView", () => {
  it("does not grant one-shot trust until the explicit native-code confirmation is accepted", async () => {
    const facts = {
      commandId: "fake",
      handle: "fake",
      label: "Fake",
      fingerprint: "fingerprint-1",
      cwd: "/workspace",
      cwdReady: true,
      executable: "fake-agent",
      executablePath: "/bin/fake-agent",
      executableReady: true,
      launchable: true,
      detail: "Ready",
    } as const;
    const calls: unknown[] = [];
    const declined = await runConfirmedCommandTest(facts, {
      confirm: (message) => { expect(message).toContain("native code"); return false; },
      test: async (input) => { calls.push(input); },
    });
    expect(declined).toBe("declined");
    expect(calls).toEqual([]);

    const launched = await runConfirmedCommandTest(facts, {
      confirm: (message) => { expect(message).toContain("Fingerprint: fingerprint-1"); return true; },
      test: async (input) => { calls.push(input); },
    });
    expect(launched).toBe("launched");
    expect(calls).toEqual([{ commandId: "fake", expectedFingerprint: "fingerprint-1" }]);
  });

  it("shows saved command facts and enables an ordinary terminal test only when launchable", () => {
    const command = createDefaultClaudeAgentCommand();
    const html = renderToStaticMarkup(
      <TerminalCommandBarView
        commands={[command]}
        selectedId={command.id}
        facts={{
          commandId: command.id,
          handle: command.handle,
          label: command.label,
          fingerprint: "abc123",
          cwd: "/workspace",
          cwdReady: true,
          executable: "claude",
          executablePath: "/usr/local/bin/claude",
          executableReady: true,
          launchable: true,
          detail: "Ready to test in a visible terminal.",
        }}
        status="Ready to test in a visible terminal."
        testing={false}
        onSelect={() => {}}
        onTest={() => {}}
      />,
    );
    expect(html).toContain("Claude");
    expect(html).toContain("/usr/local/bin/claude · /workspace");
    expect(html).toContain("Test");
    expect(html).not.toContain("disabled");
  });

  it("keeps Test disabled when launch facts are blocked", () => {
    const command = createDefaultClaudeAgentCommand();
    const html = renderToStaticMarkup(
      <TerminalCommandBarView
        commands={[command]}
        selectedId={command.id}
        facts={{
          commandId: command.id,
          handle: command.handle,
          label: command.label,
          fingerprint: "abc123",
          cwd: "/workspace",
          cwdReady: true,
          executable: "claude",
          executablePath: null,
          executableReady: false,
          launchable: false,
          block: "executable-missing",
          detail: "Executable was not found: claude",
        }}
        status="Executable was not found: claude"
        testing={false}
        onSelect={() => {}}
        onTest={() => {}}
      />,
    );
    expect(html).toContain("disabled");
    expect(html).toContain("Executable was not found: claude");
  });
});
