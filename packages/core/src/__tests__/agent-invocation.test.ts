import { describe, expect, it } from "vitest";

import {
  agentCommandExecutableFingerprint,
  createDefaultClaudeAgentCommand,
  createDefaultCodexAgentCommand,
  deriveAgentCommandLaunch,
  formatNoteInvocationPrompt,
  normalizeAgentCommand,
  normalizeAgentCommands,
  normalizeAgentHandle,
  normalizeInvocationRecord,
} from "../agent-invocation";
import { findDocumentAgentEnvelopes, formatDocumentAgentInvocation, formatDocumentAgentResponse } from "../document-agent-protocol";

describe("agent invocation model", () => {
  it("ships a headless Codex command suitable for a workspace invocation", () => {
    const command = createDefaultCodexAgentCommand();
    expect(command).toMatchObject({
      id: "codex",
      handle: "codex",
      command: "codex exec --sandbox workspace-write -",
      cwdPolicy: "workspace_root",
      promptDelivery: "stdin",
      enabled: true,
    });
    expect(deriveAgentCommandLaunch(command, { kind: "note", workspaceRoot: "/workspace", documentPath: "/workspace/a.md" }))
      .toEqual({ launchable: true, cwd: "/workspace" });
  });

  it("derives one command launch decision for CLI and note contexts", () => {
    const command = createDefaultClaudeAgentCommand();
    expect(deriveAgentCommandLaunch(command, { kind: "cli", workspaceRoot: "/workspace" })).toEqual({
      launchable: true,
      cwd: "/workspace",
    });
    expect(deriveAgentCommandLaunch(
      { ...command, cwdPolicy: "note_dir" },
      { kind: "note", workspaceRoot: "/workspace", documentPath: "/workspace/notes/task.md" },
    )).toEqual({ launchable: true, cwd: "/workspace/notes" });
    expect(deriveAgentCommandLaunch(
      { ...command, cwdPolicy: "note_dir" },
      { kind: "cli", workspaceRoot: "/workspace" },
    )).toMatchObject({ launchable: false, block: "invalid-cwd-policy" });
  });

  it("normalizes configured agent handles", () => {
    expect(normalizeAgentHandle(" @Claude ")).toBe("claude");
    expect(normalizeAgentHandle("@codex-1")).toBe("codex-1");
    expect(normalizeAgentHandle("@c")).toBeNull();
    expect(normalizeAgentHandle("@import url")).toBeNull();
  });

  it("normalizes command records with headless stdin delivery as the default", () => {
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
      promptDelivery: "stdin",
      version: 1,
      enabled: true,
    });
  });

  it("upgrades only prior built-in Claude defaults to the current headless edit command", () => {
    expect(normalizeAgentCommand({
      id: "claude", label: "Claude", handle: "claude", command: "claude",
      cwdPolicy: "workspace_root", promptDelivery: "terminalInputAfterLaunch",
    })).toMatchObject({ command: "claude -p --permission-mode acceptEdits", promptDelivery: "stdin" });
    expect(normalizeAgentCommand({
      id: "claude", label: "Claude", handle: "claude", command: "claude -p",
      cwdPolicy: "workspace_root", promptDelivery: "stdin", version: 1,
    })).toMatchObject({ command: "claude -p --permission-mode acceptEdits", promptDelivery: "stdin" });
    expect(normalizeAgentCommand({
      id: "custom", label: "My Claude", handle: "claude", command: "claude",
      cwdPolicy: "workspace_root", promptDelivery: "terminalInputAfterLaunch",
    })).toMatchObject({ command: "claude", promptDelivery: "stdin" });
    expect(normalizeAgentCommand({
      id: "claude", label: "Claude", handle: "claude", command: "claude -p --model sonnet",
      cwdPolicy: "workspace_root", promptDelivery: "stdin", version: 1,
    })).toMatchObject({ command: "claude -p --model sonnet" });
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

  it("normalizes legacy terminal delivery and rejects unsupported prompt delivery modes", () => {
    expect(normalizeAgentCommand({
      id: "claude",
      label: "Claude",
      handle: "claude",
      command: "claude",
      promptDelivery: "stdin",
    })).toMatchObject({ promptDelivery: "stdin" });
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

  it("formats a note invocation with Exo workspace and referenced-note guidance", () => {
    const protocolInvocationId = "11111111-1111-4111-8111-111111111111";
    const prompt = formatNoteInvocationPrompt({
      workspaceRoot: "/workspace",
      documentPath: "/workspace/notes/task.md",
      mentionText: "@claude",
      message: "Read [[research/self-improving-systems|the essay]] and tell me what you think.",
      protocolInvocationId,
      agentHandle: "claude",
      frontmatter: { tags: ["exo"] },
      body: "# Task\n\nCurrent draft",
    });
    expect(prompt).toContain("Working note:\n/workspace/notes/task.md");
    expect(prompt).toContain("Message:\nRead [[research/self-improving-systems|the essay]] and tell me what you think.");
    expect(prompt).toContain('"tags": [');
    expect(prompt).toContain("# Task");
    expect(prompt).toContain("Exo Workspace");
    expect(prompt).toContain("Workspace root:\n/workspace");
    expect(prompt).toContain("configured Note Roots");
    expect(prompt).toContain("[[durable/path/to/note|Readable title]]");
    expect(prompt).toContain("[[note-name]]");
    expect(prompt).toContain("native filesystem tools or Exo CLI/Search");
    expect(prompt).toContain("prefer the durable path target with a readable alias");
    expect(prompt).toContain("Exo document-agent protocol:");
    expect(prompt).toContain(`<exo-agent-response invocation="${protocolInvocationId}" agent="claude">`);
  });

  it("keeps opinion and analysis requests response-only unless edits are useful", () => {
    const prompt = formatNoteInvocationPrompt({
      documentPath: "/workspace/notes/essay.md",
      mentionText: "@claude",
      message: "What do you think of this essay?",
      protocolInvocationId: "11111111-1111-4111-8111-111111111111",
      agentHandle: "claude",
      body: "# Essay\n\nDraft",
    });

    expect(prompt).toContain("For an answer-shaped request");
    expect(prompt).toContain("the linked Exo agent response is the deliverable");
    expect(prompt).toContain("Make direct Markdown edits only when requested or genuinely useful.");
    expect(prompt).not.toContain("Complete the user's request by editing the working document directly");
    expect(prompt).not.toContain("write the useful result into the working document in the appropriate place");
  });

  it("directs requested document changes to ordinary reviewable Markdown", () => {
    const prompt = formatNoteInvocationPrompt({
      documentPath: "/workspace/notes/essay.md",
      mentionText: "@claude",
      message: "Rewrite the introduction and add two sources.",
      protocolInvocationId: "11111111-1111-4111-8111-111111111111",
      agentHandle: "claude",
      body: "# Essay\n\nDraft",
    });

    expect(prompt).toContain("For an edit-shaped request, edit the relevant Markdown directly");
    expect(prompt).toContain("use the linked Exo agent response as a concise receipt describing those edits");
    expect(prompt).toContain("Direct edits remain ordinary Markdown and Exo presents them for review.");
  });

  it("marks the supplied note snapshot as bounded and directs full reads to disk", () => {
    const withBody = formatNoteInvocationPrompt({
      documentPath: "/workspace/notes/large.md",
      mentionText: "@claude",
      message: "Check the conclusion.",
      body: "# Large note\n\nPartial snapshot",
    });
    const withoutBody = formatNoteInvocationPrompt({
      documentPath: "/workspace/notes/large.md",
      mentionText: "@claude",
      message: "Check the conclusion.",
    });

    expect(withBody).toContain("--- body snapshot (may be truncated) ---");
    expect(withBody).toContain("--- end bounded snapshot; read the working note from disk when more context is needed ---");
    expect(withoutBody).toContain("The current body was not supplied; read the file from disk.");
  });

  it("requires one linked, durable page-native response rather than a transient result", () => {
    const invocationId = "11111111-1111-4111-8111-111111111111";
    const prompt = formatNoteInvocationPrompt({
      documentPath: "/workspace/notes/essay.md",
      mentionText: "@claude",
      message: "Summarize the argument.",
      protocolInvocationId: invocationId,
      agentHandle: "claude",
    });

    expect(prompt).toContain(`exactly one <exo-agent-response> linked to invocation ${invocationId}`);
    expect(prompt).toContain("Exo renders that envelope as the colored, page-native agent response");
    expect(prompt).toContain("Never leave the useful answer only in stdout, chat, or another transient surface.");
    expect(prompt.match(/<exo-agent-response invocation=/g)).toHaveLength(1);
  });

  it("round-trips the inert document-agent envelopes and ignores malformed source", () => {
    const invocationId = "11111111-1111-4111-8111-111111111111";
    const document = [
      "# Note",
      formatDocumentAgentInvocation({ id: invocationId, agent: "claude", message: "@claude inspect this note" }),
      formatDocumentAgentResponse({ invocationId, agent: "claude", message: "## Finding\n\nThe durable result." }),
      '<exo-agent-response invocation="not-an-id" agent="claude">\nIgnore me\n</exo-agent-response>',
    ].join("\n\n");
    expect(findDocumentAgentEnvelopes(document)).toEqual([
      expect.objectContaining({ kind: "invocation", id: invocationId, agent: "claude", status: "sent" }),
      expect.objectContaining({ kind: "response", invocationId, agent: "claude" }),
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
      promptDelivery: "stdin",
      command: createDefaultClaudeAgentCommand(),
      cwd: "/tmp",
      createdAt: "2026-07-08T00:00:00.000Z",
      changedFileRefs: [{ path: "/tmp/note.md", kind: "modified", attribution: "ambiguous", diffRefId: "diff-1" }],
      diffRefs: [{ id: "diff-1", path: "/tmp/note.md", format: "unified", ref: ".exo/invocations/inv-1/diff.patch" }],
      attribution: { status: "ambiguous", reason: "user and agent touched the file during the invocation window" },
      providerSessionId: "ce4b9e26-2574-4433-a054-1110cd403792",
      review: { status: "pending", beforeSha256: "a".repeat(64), afterSha256: "b".repeat(64) },
    });

    expect(record).toMatchObject({
      id: "inv-1",
      status: "pending",
      context: "note",
      promptDelivery: "stdin",
      command: { id: "claude", handle: "claude", version: 1, executableFingerprint: expect.any(String) },
      changedFileRefs: [{ path: "/tmp/note.md", kind: "modified", attribution: "ambiguous", diffRefId: "diff-1" }],
      attribution: { status: "ambiguous" },
      providerSessionId: "ce4b9e26-2574-4433-a054-1110cd403792",
      review: { status: "pending" },
    });
  });

  it("drops malformed persisted review hashes and session provenance", () => {
    const record = normalizeInvocationRecord({
      id: "inv-unsafe", status: "process-exited", context: "cli", message: "task", promptDelivery: "stdin",
      command: createDefaultClaudeAgentCommand(), cwd: "/tmp", createdAt: "2026-07-08T00:00:00.000Z",
      providerSessionId: "made-up", review: { status: "pending", beforeSha256: "invalid", afterSha256: "also-invalid" },
    });
    expect(record?.providerSessionId).toBeUndefined();
    expect(record?.review).toBeUndefined();
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
