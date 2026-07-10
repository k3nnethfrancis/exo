# Invocation Context And Safety

Last updated: 2026-07-08

status: planning. Blocks mention detection shipping.

## Problem

The V1 prompt is intentionally thin:

```text
You have been tagged in the following document:
<path>

Message:
<mention text>

Open the document to see its full contents.
```

But a thin prompt does not mean a thin safety model. The invoked command may have access to the workspace, note roots, project roots, global agent context, MCP tools, network, and local credentials.

## V1 Context Policy

V1 should be explicit and conservative:

- The user confirms every invocation.
- Exo shows the command label and cwd before launch.
- Exo does not promise sandboxing.
- Exo does not enforce private zones yet.
- Exo records the cwd and command version in the invocation record.
- Exo warns that the command may read files available to that process.

## Cwd Policy

Supported V1 policies:

- `workspace_root`: run from the active workspace root.
- `note_dir`: run from the directory containing the tagged document.
- `fixed`: run from a configured absolute path.

Default for Kenneth's Exo dogfooding should likely be `workspace_root`, because agents need repo and notes context. For general users, `note_dir` may be safer.

The choice should be visible in the confirm affordance.

## Prompt Injection Through Notes

Mention invocation turns Markdown into an execution vector. A note can contain instructions that the agent reads after launch.

Risk examples:

- pasted web text includes malicious instructions;
- an agent-authored note asks future agents to ignore Exo context;
- a synced note contains a fake `@claude` instruction;
- a private note causes a coding agent to include private details in generated code or commits.

V1 mitigations:

- strict mention syntax;
- explicit user confirmation;
- show source document path;
- show command and cwd;
- record invocation metadata and diffs;
- do not auto-run mentions from file watchers in V1.

## Private Zones

Private zones are deferred, but the doc must name the future requirement.

Potential future policies:

- advisory warnings for configured private folders;
- MCP/search filtering by invocation scope;
- per-command allowed roots;
- command execution from a restricted checkout;
- proposal-only writes for private roots.

V1 does not enforce these. The confirm UI should not imply it does.

## Global Context Contamination

Applying Exo context globally can help general agents understand the workspace, but it can also contaminate narrow subagents and unrelated projects.

The context UI should say:

> Applying Exo context globally helps agents running on this machine understand Exo, your exograph, and your workspace conventions. It can also contaminate narrow or unrelated agent sessions with Exo-specific assumptions. Use global context when you want most local agents to understand Exo by default.

## Confirmation Copy Requirements

Before launch, show:

- mention handle and label;
- document path;
- command or command label;
- cwd;
- whether the command may edit files directly;
- attribution mode: likely/ambiguous, not line-perfect.

## Red Lines

- No auto-run from arbitrary saved Markdown in V1.
- No claim that Exo restricts what the command can read unless a real sandbox/filter exists.
- No hidden global context apply.
- No direct writes without diff/attribution recording enabled.

-- Exo | 2026-07-08
