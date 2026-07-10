# Agent Output Conventions

Last updated: 2026-07-08

status: planning. Blocks productized command templates.

## Problem

Direct write + diff review only works if invoked agents understand that they should edit files when appropriate, not merely answer in the terminal.

Exo should avoid deep harness integration, but it still owns the invocation prompt contract and command templates it presents to users.

## Pointer Prompt

Base prompt:

```text
You have been tagged in an Exo document.

Document:
<absolute-or-workspace-relative-path>

Message:
<mention text>

Open the document to see its full contents. If the request asks for a change, edit the relevant file directly. Exo will refresh the document and show the user a diff of files changed during this invocation.
```

V1 should test whether the final sentence materially improves real outputs. The original thin prompt omitted it; direct-write V1 likely needs it.

## Command Templates

Templates are suggestions. The user owns the final command.

Candidate templates:

```json
{
  "id": "claude",
  "label": "Claude",
  "handle": "claude",
  "command": "claude -p",
  "cwdPolicy": "workspace_root",
  "promptDelivery": "terminal_input"
}
```

```json
{
  "id": "codex",
  "label": "Codex",
  "handle": "codex",
  "command": "codex",
  "cwdPolicy": "workspace_root",
  "promptDelivery": "terminal_input"
}
```

The actual prompt-delivery mechanism must match Exo's terminal launch path.

## Output Convention

Default convention:

- If asked to answer or critique, the agent may answer in terminal output.
- If asked to modify the document, the agent should edit the source file directly.
- If asked to create an artifact, the agent should create a nearby file or an `.exo` artifact only if instructed.
- The user reviews changes through Exo's diff banner.

V1 does not require agents to write inline comments, sidecar replies, or proposal batches.

## Prototype Evidence Required

Before productizing templates:

1. Pick 10 real note invocations.
2. Run the exact pointer prompt through the intended command.
3. Record whether the agent:
   - opened the right document;
   - understood the request;
   - edited the file when expected;
   - avoided editing when critique-only was expected;
   - left useful terminal output;
   - caused confusing diffs.
4. Revise the prompt only from evidence.

## Harness-Specific Notes

### Claude Code

Claude Code can edit files directly, but command flags and model choices change over time. Exo should not encode deep Claude lifecycle assumptions. Template docs can mention known command examples, but settings must remain user-owned.

### Codex

Codex app and Codex CLI behavior may differ. Treat Codex as a user-owned command until repeated use justifies a first-party template.

### Local Agents

Local agents are just commands. Exo should not assume model provider, auth, or output format.

## Red Lines

- No harness-specific parser for output in V1.
- No hidden prompt expansion beyond the visible template.
- No claim that an agent will edit correctly without prototype evidence.
- No skill install or provider config mutation as part of command setup.

-- Exo | 2026-07-08
