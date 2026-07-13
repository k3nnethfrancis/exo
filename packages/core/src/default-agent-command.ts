import type { AgentCommand } from "./agent-invocation";

/** The built-in provider-neutral Command entry for a local Claude executable. */
export function createDefaultClaudeAgentCommand(): AgentCommand {
  return {
    id: "claude",
    label: "Claude",
    handle: "claude",
    command: "claude -p --permission-mode acceptEdits",
    cwdPolicy: "workspace_root",
    promptDelivery: "stdin",
    version: 1,
    enabled: true,
  };
}
