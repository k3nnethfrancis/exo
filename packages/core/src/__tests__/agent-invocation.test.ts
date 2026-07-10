import { describe, expect, it } from "vitest";

import {
  agentCommandExecutableFingerprint,
  createDefaultClaudeAgentCommand,
  normalizeAgentCommand,
  normalizeAgentCommands,
  normalizeAgentHandle,
  normalizeInvocationRecord,
} from "../agent-invocation";
import { parseAgentMentions } from "../agent-mention-parser";

describe("agent invocation model", () => {
  it("normalizes configured agent handles", () => {
    expect(normalizeAgentHandle(" @Claude ")).toBe("claude");
    expect(normalizeAgentHandle("@codex-1")).toBe("codex-1");
    expect(normalizeAgentHandle("@c")).toBeNull();
    expect(normalizeAgentHandle("@import url")).toBeNull();
  });

  it("normalizes command records with terminal input delivery as the default", () => {
    expect(normalizeAgentCommand({
      id: " Claude Code ",
      label: " Claude Code ",
      handle: " @Claude ",
      command: " claude ",
      cwdPolicy: "workspace_root",
      promptDelivery: "auto",
      version: 0,
    })).toEqual({
      id: "Claude-Code",
      label: "Claude Code",
      handle: "claude",
      command: "claude",
      cwdPolicy: "workspace_root",
      promptDelivery: "terminalInputAfterLaunch",
      version: 1,
      enabled: true,
    });
  });

  it("rejects V1 command records with env or template execution fields", () => {
    expect(normalizeAgentCommand({
      id: "claude",
      label: "Claude",
      handle: "claude",
      command: "claude",
      env: { ANTHROPIC_API_KEY: "secret" },
    })).toBeNull();
    expect(normalizeAgentCommand({
      id: "claude",
      label: "Claude",
      handle: "claude",
      command: "claude",
      promptTemplate: "{{message}}",
    })).toBeNull();
  });

  it("rejects V1 command records with unsupported prompt delivery modes", () => {
    expect(normalizeAgentCommand({
      id: "claude",
      label: "Claude",
      handle: "claude",
      command: "claude",
      promptDelivery: "stdin",
    })).toBeNull();
    expect(normalizeAgentCommand({
      id: "claude",
      label: "Claude",
      handle: "claude",
      command: "claude",
      promptDelivery: "argv",
    })).toBeNull();
  });

  it("fingerprints only executable command fields", () => {
    const command = createDefaultClaudeAgentCommand();
    const fingerprint = agentCommandExecutableFingerprint(command);

    expect(fingerprint).toMatch(/^[a-f0-9]{64}$/);
    expect(agentCommandExecutableFingerprint({ ...command, label: "Claude Code" })).toBe(fingerprint);
    expect(agentCommandExecutableFingerprint({ ...command, command: "claude --print" })).not.toBe(fingerprint);
  });

  it("requires fixed cwd command records to include fixedCwd", () => {
    expect(normalizeAgentCommand({
      id: "local",
      label: "Local",
      handle: "local",
      command: "node agent.js",
      cwdPolicy: "fixed",
    })).toBeNull();
  });

  it("rejects multiline configured commands", () => {
    expect(normalizeAgentCommand({
      id: "local",
      label: "Local",
      handle: "local",
      command: "echo one\necho two",
    })).toBeNull();
  });

  it("deduplicates command records by id and handle", () => {
    expect(normalizeAgentCommands([
      createDefaultClaudeAgentCommand(),
      { ...createDefaultClaudeAgentCommand(), id: "claude-copy", command: "claude --dangerously-skip-permissions" },
      { ...createDefaultClaudeAgentCommand(), handle: "codex", command: "codex" },
    ])).toEqual([createDefaultClaudeAgentCommand()]);
  });

  it("parses only strict editor-owned line-start mentions", () => {
    const markdown = [
      "---",
      "owner: @claude",
      "---",
      "",
      "@claude summarize this note",
      "  @codex check the links",
      "hello @claude not a mention",
      "> @claude quoted text",
      "- @claude list item",
      "```",
      "@claude code fence",
      "```",
      "<script>",
      "@claude script body",
      "</script>",
      "@unknown ignored",
    ].join("\n");

    expect(parseAgentMentions(markdown, ["claude", "codex"])).toEqual([
      {
        handle: "claude",
        message: "summarize this note",
        originalText: "@claude summarize this note",
        line: 5,
        column: 1,
        offset: expect.any(Number),
      },
      {
        handle: "codex",
        message: "check the links",
        originalText: "@codex check the links",
        line: 6,
        column: 3,
        offset: expect.any(Number),
      },
    ]);
  });

  it("normalizes invocation records with lifecycle and attribution placeholders", () => {
    const record = normalizeInvocationRecord({
      id: "inv-1",
      status: "pending",
      context: "note",
      taggedDocumentPath: "/tmp/note.md",
      originalMentionText: "@claude summarize this",
      mentionProvenance: "human-authored",
      message: "summarize this",
      promptDelivery: "terminalInputAfterLaunch",
      command: createDefaultClaudeAgentCommand(),
      cwd: "/tmp",
      createdAt: "2026-07-08T00:00:00.000Z",
      changedFileRefs: [{ path: "/tmp/note.md", kind: "modified", attribution: "ambiguous", diffRefId: "diff-1" }],
      diffRefs: [{ id: "diff-1", path: "/tmp/note.md", format: "unified", ref: ".exo/invocations/inv-1/diff.patch" }],
      attribution: { status: "ambiguous", reason: "user and agent touched the file during the invocation window" },
    });

    expect(record).toMatchObject({
      id: "inv-1",
      status: "pending",
      context: "note",
      promptDelivery: "terminalInputAfterLaunch",
      command: { id: "claude", handle: "claude", version: 1, executableFingerprint: expect.any(String) },
      changedFileRefs: [{ path: "/tmp/note.md", kind: "modified", attribution: "ambiguous", diffRefId: "diff-1" }],
      attribution: { status: "ambiguous" },
    });
  });

  it("normalizes CLI invocation records without a tagged document", () => {
    expect(normalizeInvocationRecord({
      id: "inv-cli",
      status: "user-ended",
      context: "cli",
      message: "Inspect the repo",
      promptDelivery: "terminalInputAfterLaunch",
      command: createDefaultClaudeAgentCommand(),
      cwd: "/tmp",
      createdAt: "2026-07-08T00:00:00.000Z",
    })).toMatchObject({
      id: "inv-cli",
      context: "cli",
      status: "user-ended",
      mentionProvenance: "unknown",
    });
  });
});
