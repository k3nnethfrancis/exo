# Desktop main-process map

This directory owns Electron-process composition and lifecycle. It turns the
core model into local services and IPC; it does not define Markdown, graph,
search, command-wire, or renderer state contracts.

## Start with the owner

- Workspace activation and committed scope: `workspace-runtime-coordinator.ts`.
  Its candidate is private until one synchronous final commit; late work must
  not publish or degrade a replacement Workspace. Start at
  `workspace-runtime-coordinator.test.ts`.
- Workspace settings, filesystem service, and IPC wiring:
  `workspace-config-store.ts`, `workspace-notes-service.ts`, and
  `workspace-ipc.ts`. Core owns path containment and persistent model types.
- Watcher lifetime: `workspace-watchers.ts`. Filesystem freshness comes from
  this service, not renderer polling. Test `workspace-watchers.test.ts`.
- Derived indexing: `indexing-service.ts` and `derived-index-*.ts`; it stays
  asynchronous and must never make renderer interaction wait.
- Command-server lifecycle: `command-server-lifecycle.ts`; HTTP route/payload
  contracts belong in `packages/core/src/command-protocol.ts` and the transport
  implementation is `command-server.ts`.
- Invocation execution and review artifacts: `invocation-runner.ts` and
  `invocation-review.ts`. The renderer owns review presentation and decisions.
- Direct PTY lifecycle: `terminal-manager.ts` and `terminal-runtime*.ts`. Read
  `../../../../skills/terminal-stability/SKILL.md` before changing any terminal
  behavior.

`index.ts` is composition only: assemble services, register IPC, and make no
second implementation of a named owner.

## Non-ownership and invariants

- Renderer code reaches this directory only through preload/shared IPC types;
  do not import renderer modules here.
- Do not widen Note Root authority in a main-process convenience path. Core
  containment rules apply to every read, write, preview, and watcher action.
- A command server for candidate B is not discoverable until the coordinator
  commits B. A stale watcher, index callback, or recovery task must be ignored.
- Keep terminal bytes and ordinary xterm scrollback intact; do not add tmux or
  harness-specific terminal transport.
- Do not add or change CLI/command-server routes or shared protocol shapes
  without the protected-contract approval recorded in the task brief.

## Focused gates

```bash
pnpm --filter @exo/desktop exec vitest run src/main/workspace-runtime-coordinator.test.ts
pnpm --filter @exo/desktop exec vitest run src/main/workspace-watchers.test.ts
pnpm --filter @exo/desktop exec vitest run src/main/command-server-lifecycle.test.ts src/main/command-server.test.ts
pnpm --filter @exo/desktop exec vitest run src/main/invocation-runner.test.ts src/main/invocation-review.test.ts
pnpm --filter @exo/desktop typecheck
```

For a cross-process change, also follow `../../../../docs/harness.md` and run
the relevant Electron path; unit tests alone do not prove main/preload/renderer
agreement.
