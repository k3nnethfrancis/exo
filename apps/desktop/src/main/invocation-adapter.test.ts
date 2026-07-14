import { describe, expect, it } from "vitest";

import { createDefaultClaudeAgentCommand, createDefaultCodexAgentCommand, type InvocationConversationHead } from "@exo/core";

import { commandForHeadlessInvocation, extractClaudeSessionId, inspectInvocationAdapterResult, supportsAutomaticContinuity } from "./invocation-adapter";

const SESSION_ID = "ce4b9e26-2574-4433-a054-1110cd403792";
const HEAD: InvocationConversationHead = {
  version: 1,
  workspaceFingerprint: "a".repeat(64),
  commandId: "claude",
  commandFingerprint: "b".repeat(64),
  adapter: "claude-code",
  cwd: "/workspace",
  providerSessionId: SESSION_ID,
  sourceInvocationId: "invocation-1",
  updatedAt: "2026-07-13T00:00:00.000Z",
};

describe("invocation adapter", () => {
  it("builds separate structured Claude fresh and resume commands", () => {
    const command = createDefaultClaudeAgentCommand();
    expect(commandForHeadlessInvocation(command))
      .toBe("claude -p --permission-mode acceptEdits --output-format json");
    expect(commandForHeadlessInvocation(command, HEAD))
      .toBe(`claude -p --permission-mode acceptEdits --output-format json --resume '${SESSION_ID}'`);
    expect(commandForHeadlessInvocation({ ...command, command: "claude -p --output-format stream-json" }, HEAD))
      .toBe(`claude -p --output-format stream-json --resume '${SESSION_ID}'`);
  });

  it("does not give Codex or generic Commands unproven continuity", () => {
    const codex = createDefaultCodexAgentCommand();
    expect(codex.continuityPolicy).toBe("fresh");
    expect(supportsAutomaticContinuity(codex)).toBe(false);
    expect(commandForHeadlessInvocation(codex, HEAD)).toBe(codex.command);
    expect(supportsAutomaticContinuity({ ...createDefaultClaudeAgentCommand(), adapter: "generic", continuityPolicy: "fresh" })).toBe(false);
  });

  it("extracts only a real structured Claude session id", () => {
    expect(extractClaudeSessionId(`ordinary output\n{"session_id":"${SESSION_ID}"}`)).toBe(SESSION_ID);
    expect(extractClaudeSessionId('{"session_id":"not-a-session"}')).toBeNull();
  });

  it("classifies only the exact proven stale-resume signature for the attempted id", () => {
    expect(inspectInvocationAdapterResult(createDefaultClaudeAgentCommand(), {
      exitCode: 1,
      stdout: "",
      stderr: `No conversation found with session ID: ${SESSION_ID}\n`,
    }, HEAD)).toMatchObject({ staleResumeRejected: true });
    expect(inspectInvocationAdapterResult(createDefaultClaudeAgentCommand(), {
      exitCode: 1,
      stdout: "",
      stderr: "No conversation found with session ID: another-id\n",
    }, HEAD)).toMatchObject({ staleResumeRejected: false });
    expect(inspectInvocationAdapterResult(createDefaultClaudeAgentCommand(), {
      exitCode: 2,
      stdout: "",
      stderr: `No conversation found with session ID: ${SESSION_ID}\n`,
    }, HEAD)).toMatchObject({ staleResumeRejected: false });
  });
});
