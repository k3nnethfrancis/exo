# Agent Output Conventions

Last updated: 2026-07-13

status: shipped document-agent protocol; real-work response-block dogfood remains.

## Problem

Document-native invocation works only if agents know when the response envelope
is the answer and when the note itself should change.

Exo should avoid deep harness integration, but it still owns the invocation prompt contract and command templates it presents to users.

## Pointer Prompt

Base prompt:

```text
You were explicitly invoked from an Exo document.

Document:
<absolute-or-workspace-relative-path>

Invocation:
<explicit @handle>

Message:
<user-authored multiline request>

Workspace root and configured Note Roots:
<authorized local paths>

Document snapshot at invocation:
<frontmatter and a bounded window around the request>

For an answer-shaped request, write the durable answer in the linked
`<exo-agent-response>` envelope. For an edit-shaped request, edit the relevant
Markdown and use the response as a concise receipt. Follow durable aliased or
legacy wikilinks with native filesystem tools or Exo Search when the request
needs referenced context. Exo observes Note-Root changes and shows them for
review.
```

The bounded snapshot is orientation, not a substitute for reading the working
note or a referenced note from disk.

## Command Templates

Templates are suggestions. The user owns the final command.

Candidate templates:

```json
{
  "id": "claude",
  "label": "Claude",
  "handle": "claude",
  "command": "claude -p --permission-mode acceptEdits",
  "cwdPolicy": "workspace_root",
  "promptDelivery": "stdin"
}
```

```json
{
  "id": "codex",
  "label": "Codex",
  "handle": "codex",
  "command": "codex",
  "cwdPolicy": "workspace_root",
  "promptDelivery": "stdin"
}
```

Note invocations deliver one complete prompt over stdin to a headless process. CLI/Test commands may still use a visible terminal.

## Output Convention

Default convention:

- If asked to answer, critique, research, or plan, the agent writes the useful
  result inside the linked response envelope. It does not rewrite unrelated
  prose merely to create a diff.
- If asked to change the document, the agent edits the source Markdown directly
  and uses the linked response as a receipt.
- Chat-only stdout is never the durable product result.
- The agent writes one durable `<exo-agent-response invocation="…">` envelope
  immediately after the matching request envelope. It is portable Markdown
  source and renders as page-native prose in Exo, not a chat card.
- If asked to create an artifact, the agent should create a nearby file or an `.exo` artifact only if instructed.
- The user reviews ordinary edits inline against Exo's retained pre-invocation
  snapshot. The colored response is the answer/receipt; other changes remain
  observed edits until kept or rejected.

V1 does not require agents to write inline comments or proposal batches. The
linked response envelope is the one durable reply convention.

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

Claude Code can edit files directly. Exo's explicit adapter owns only the small
provider seam needed for structured session provenance and safe resume; the
user-owned command still controls model, permissions, and other launch flags.

### Codex

Codex app and Codex CLI behavior may differ. Treat Codex as a user-owned command until repeated use justifies a first-party template.

### Local Agents

Local agents are just commands. Exo should not assume model provider, auth, or output format.

## Red Lines

- The document-agent protocol remains provider-agnostic and its XML-like
  envelopes are inert source text. Provider session parsing stays behind an
  explicit adapter and cannot key off a user-editable handle.
- No vault injection. The prompt carries explicit paths, request data, and a
  bounded note snapshot; agents read further context only when the request
  needs it.
- No claim that an agent will edit correctly without prototype evidence.
- No skill install or provider config mutation as part of command setup.

-- Exo | 2026-07-13
