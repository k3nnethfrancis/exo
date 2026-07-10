# Agent Identity Reconciliation

Last updated: 2026-07-08

status: planning. Blocks V1 invocation implementation.

## Problem

Exo currently has promptable harness identities such as Claude, Codex, and Pi. Recent architecture work moved agent creation through registered, enabled, surface-approved harness ids.

The pivot introduces `AgentCommand`: a user-owned command invoked from a Markdown mention.

Without reconciliation, Exo will have two competing meanings of "agent":

- **Harness:** a provider/integration adapter with launch metadata, readiness, skills, traces, and availability.
- **AgentCommand:** a named mention handle mapped to a command string and cwd policy.

V1 should use one product identity: **AgentCommand**.

## Product Identity

An agent visible to note invocation is:

> A configured command with a mention handle, label, cwd policy, and invocation prompt contract.

Example:

```json
{
  "id": "claude",
  "label": "Claude",
  "handle": "claude",
  "command": "claude -p",
  "cwdPolicy": "workspace_root",
  "version": 1
}
```

The handle controls mention syntax: `@claude`.

## Harness Relationship

Harness adapters become optional command templates or legacy launch helpers, not the primary user-facing identity.

Possible migration:

| Old | New |
| --- | --- |
| `core.claude` harness | built-in AgentCommand template: `claude -p` |
| `core.codex` harness | built-in AgentCommand template: `codex ...` when stable |
| Pi-compatible harness | built-in/local AgentCommand template |
| Shell terminal | plain terminal, not an AgentCommand unless user configures one |

## Settings Shape

Agent commands should live in workspace settings, because they are workspace behavior:

```json
{
  "agentCommands": [
    {
      "id": "claude",
      "label": "Claude",
      "handle": "claude",
      "command": "claude -p",
      "cwdPolicy": "workspace_root",
      "version": 1
    }
  ]
}
```

Later UI can manage this. V1 can use hand-edited settings.

## Invocation Prompt Input

V1 assumes the command reads the prompt from stdin or as a final argument. This must be explicit in the command model before implementation.

Open design choice:

```ts
type PromptDelivery = "stdin" | "argv";
```

Default should be `stdin` if the terminal launch path supports it cleanly. If Exo launches a terminal and sends semantic input after process start, the command model must state that this is delivery through terminal input, not process stdin.

## Legacy CLI/MCP

Keep CLI. Remove MCP from the active product surface.

Existing surfaces such as `exo agents create` may remain temporarily as legacy/experimental terminal-agent lifecycle tools. MCP `create_agent`, `send_agent_message`, and related tools were deletion targets for the heavy-handed refactor and must not be replaced by hidden equivalents.

Later decision:

- keep `exo agents` as terminal-agent lifecycle tools;
- add `exo invocations` only after app V1 proves useful;
- or collapse both into command-based invocations.

Any public CLI or MCP removal needs architect review/public-contract handling.

## Red Lines

- Do not add another harness adapter to solve note invocation.
- Do not make mention invocation depend on harness availability state.
- Do not expose both harness id and command id in the V1 mention UI.
- Do not preserve MCP just because it exists.
- Do not migrate CLI until the app-local invocation model is proven.

-- Exo | 2026-07-08
