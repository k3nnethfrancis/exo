import { describe, expect, it } from "vitest";

import { InvocationActivityAdapter } from "./invocation-activity-adapter";

describe("invocation activity adapter", () => {
  it("parses split Claude JSONL into bounded tool facts", () => {
    const parser = new InvocationActivityAdapter("claude-code");
    expect(parser.push("stdout", '{"type":"system"}\n{"type":"assistant","message":{"content":[{"type":"tool_')).toEqual([
      { kind: "working" },
    ]);
    expect(parser.push("stdout", 'use","name":"Read","input":{"file_path":"/private/wiki/essay.md"}}]}}\n')).toEqual([
      { kind: "reading", label: "essay.md" },
    ]);
    expect(parser.push("stdout", '{"type":"assistant","message":{"content":[{"type":"tool_use","name":"Bash","input":{"command":"cat ~/.ssh/id_rsa"}}]}}\n')).toEqual([
      { kind: "running" },
    ]);
    expect(parser.push("stdout", '{"type":"result","result":"private assistant prose"}\n')).toEqual([
      { kind: "finishing" },
    ]);
  });

  it("ignores reasoning, assistant prose, stderr, and malformed output", () => {
    const claude = new InvocationActivityAdapter("claude-code");
    expect(claude.push("stderr", '{"type":"assistant"}\n')).toEqual([]);
    expect(claude.push("stdout", 'not json\n{"type":"assistant","message":{"content":[{"type":"text","text":"secret"}]}}\n')).toEqual([]);

    const codex = new InvocationActivityAdapter("codex-cli");
    expect(codex.push("stdout", '{"type":"item.completed","item":{"type":"reasoning","text":"secret"}}\n')).toEqual([]);
    expect(codex.push("stdout", '{"type":"item.completed","item":{"type":"agent_message","text":"secret"}}\n')).toEqual([]);
  });

  it("maps Codex lifecycle and file events without forwarding commands", () => {
    const parser = new InvocationActivityAdapter("codex-cli");
    const events = [
      '{"type":"thread.started"}',
      '{"type":"item.started","item":{"type":"command_execution","command":"cat ~/.ssh/id_rsa"}}',
      '{"type":"item.completed","item":{"type":"file_change","changes":[{"path":"/private/wiki/tasks.md"}]}}',
      '{"type":"turn.completed"}',
    ].join("\n");
    expect(parser.push("stdout", `${events}\n`)).toEqual([
      { kind: "working" },
      { kind: "running" },
      { kind: "editing", label: "tasks.md" },
      { kind: "finishing" },
    ]);
  });

  it("keeps generic command output entirely opaque", () => {
    const parser = new InvocationActivityAdapter("generic");
    expect(parser.push("stdout", '{"type":"assistant","message":{"content":[{"type":"tool_use","name":"Read","input":{"file_path":"/secret.md"}}]}}\n')).toEqual([]);
  });
});
