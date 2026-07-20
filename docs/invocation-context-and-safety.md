# Invocation Context And Safety

Last updated: 2026-07-19

status: Current safety contract for shipped note-native invocation.

## Problem

The provider-neutral invocation prompt is editable in Agent settings. Exo renders a
protected protocol plus the Workspace root, configured Note Roots, working-note path,
explicit message, and a bounded note snapshot. The exact default lives in
`packages/core/src/agent-invocation-prompt.ts`.

The invoked command is still a native local process. It may have access to files and
credentials available to that process, plus network or external tools supplied by its
provider. Prompt context does not create a sandbox.

## V1 Context Policy

V1 should be explicit and conservative:

- Invocation requires an explicit editor gesture; saving a note never launches it.
- The first or changed executable requires one-shot authorization or persisted trust.
- Persisted trust is bound to the Workspace and executable fingerprint.
- Exo shows the command label and cwd before an untrusted launch.
- Exo does not promise sandboxing.
- Exo does not enforce private zones yet.
- Exo records the cwd and command version in the invocation record.
- Exo warns that the command may read files available to that process.

## Cwd Policy

Supported V1 policies:

- `workspace_root`: run from the active workspace root.
- `note_dir`: run from the directory containing the tagged document.
- `fixed`: run from a configured absolute path.

The shipped defaults use `workspace_root`. The choice remains editable per Command and
is shown in the authorization details when approval is required.

## Prompt Injection Through Notes

Mention invocation turns Markdown into an execution vector. A note can contain instructions that the agent reads after launch.

Risk examples:

- pasted web text includes malicious instructions;
- an agent-authored note asks future agents to ignore Exo context;
- a synced note contains a fake `@claude` instruction;
- a private note causes a coding agent to include private details in generated code or commits.

V1 mitigations:

- strict mention syntax;
- explicit user gesture and fingerprinted Command trust;
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

## Confirmation Copy Requirements

When a Command is not already trusted, show:

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
