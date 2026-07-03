# Custom Pi-Compatible Harness Implementation

Last updated: 2026-07-03

This document explains how Exo should support custom Pi-compatible harnesses correctly. It is written from the current GA Pi setup, but the implementation must remain generic: GA Pi is one local configured instance of the generic Pi-compatible adapter, not a special Exo core feature.

## Goal

Exo should let a user configure and launch a Pi-compatible terminal agent from the normal Exo agent launcher.

For Kenneth's workspace, that means:

- Exo launches `projects/ga-pi/packages/coding-agent/dist/cli.js`
- Exo launches it from `/Users/kenneth/Desktop/lab`
- GA Pi discovers scoped context from that cwd, including `AGENTS.md`, `CLAUDE.md`, and `principal.md`
- Exo declares the local inference backend, currently llama.cpp, so the Pi harness is launchable

For other users, the same mechanism should support vanilla Pi, a local Pi fork, or another Pi-compatible build without hardcoding Kenneth, Shoshin, Guardian Angel, or local machine paths into Exo source defaults.

## Current State

The generic Pi adapter already exists in `packages/core/src/agent-harnesses/builtins.ts`.

Current env knobs:

- `EXO_PI_COMMAND`: explicit command to launch instead of auto-detection
- `EXO_PI_REPO_PATH`: explicit Pi-compatible source checkout path
- `EXO_PI_LABEL`: display label
- `EXO_PI_ARGS`: comma-separated launch args
- `EXO_PI_CHANNEL`: optional channel label
- `EXO_PI_BUILD`: optional build label
- `EXO_PI_ENABLED`: disable flag when set to `0` or `false`
- `EXO_PI_BACKEND_URL`: declares a compatible backend URL
- `EXO_PI_BACKEND_COMMAND`: declares a backend command
- `EXO_PI_BACKEND_LABEL`: display label for the backend
- `EXO_PI_BACKEND_KIND`: backend kind label
- `EXO_PI_BACKEND_READY`: optional strict readiness flag

Source checkout auto-detection can discover a Pi repo under `EXO_PROJECT_ROOTS` when it contains:

```text
packages/coding-agent/dist/cli.js
```

In Kenneth's workspace, `exo runtime launch-plan pi /Users/kenneth/Desktop/lab` resolves to:

```text
command: node
args: /Users/kenneth/Desktop/lab/projects/ga-pi/packages/coding-agent/dist/cli.js
cwd: /Users/kenneth/Desktop/lab
```

The missing piece is durable Exo-side configuration. Exo currently marks Pi as not launchable unless a backend is declared through process env. A Finder-launched packaged Mac app does not reliably inherit shell env, so this cannot be the long-term user experience.

## Boundary Decision

Keep the boundary this way:

```text
Exo core
  owns terminal runtime, harness registry, launchability checks, settings persistence, launcher UI, diagnostics

Generic Pi-compatible adapter
  owns command/args/cwd/env launch plan shape and dependency metadata

Pi or Pi fork
  owns provider/model config, prompt/context loading, tools, memory, principal.md behavior, and agent internals

GA Pi
  is a local configured Pi-compatible instance, not a new hardcoded Exo harness
```

Do not add `ga-pi` as a core Exo managed agent kind unless GA Pi stops being Pi-compatible at the terminal contract layer.

## Compatibility Contract

A custom Pi build remains compatible if it can still be launched as a terminal agent with:

- a command
- args
- cwd
- environment variables
- normal terminal stdin/stdout interaction

It can customize:

- source path or executable path
- display label
- provider/model/backend config
- project context loading such as `principal.md`
- memory strategy
- tools
- prompts and profiles
- local model backend
- extra flags through `EXO_PI_ARGS`

It likely needs a new adapter if it requires:

- a different launch protocol than command plus args
- a server/RPC process instead of a terminal agent
- multiple coordinated processes owned by Exo
- structured config files that Exo must generate at launch time
- custom readiness detection beyond the generic Pi startup behavior
- different semantic message delivery than the existing Pi terminal behavior

## Desired Product Behavior

Exo should expose a persisted Pi-compatible harness configuration surface. It can start simple and does not need arbitrary plugin execution.

Minimum v1 fields:

- enabled
- label
- command
- repoPath
- args
- backendUrl
- backendCommand
- backendLabel
- backendKind
- backendReady

The resolver should merge config in this order:

1. built-in defaults
2. persisted workspace or plugin settings
3. process env overrides

Process env should remain a developer/operator override, not the normal packaged-app configuration path.

## Suggested Implementation Shape

Add a typed persisted harness settings model, probably under workspace settings or plugin settings. Since the current plugin system treats manifests as metadata-only and official harnesses are still built-in adapters, the simplest near-term shape is workspace settings.

Suggested type:

```ts
interface PiHarnessSettings {
  enabled?: boolean;
  label?: string;
  command?: string;
  repoPath?: string;
  args?: string[];
  channel?: string;
  build?: string;
  backendUrl?: string;
  backendCommand?: string;
  backendLabel?: string;
  backendKind?: string;
  backendReady?: boolean;
}
```

Then add a helper that projects settings into the same env vocabulary the current adapter already understands:

```text
PiHarnessSettings -> EXO_PI_* env entries -> existing PiAgentHarness resolution
```

This keeps the adapter behavior stable while removing the packaged-app env problem.

## UI Surface

The first UI can live in Agent Config Editor -> Harnesses or Plugin Manager -> Pi details. It should let the user see:

- detected command or source checkout
- configured label
- backend status
- launchable / launch unavailable
- why launch is blocked

Editing can be basic:

- set repo path or command
- set backend URL or command
- set label
- save and refresh harness status

Do not add a dead launcher button when Pi is detected but missing backend config. The current launcher behavior is correct: only enabled, visible, launchable harnesses appear in the tool surface.

## GA Pi Local Configuration

Kenneth's desired persisted config should be equivalent to:

```text
EXO_PI_LABEL=GA Pi
EXO_PI_REPO_PATH=/Users/kenneth/Desktop/lab/projects/ga-pi
EXO_PI_BACKEND_URL=http://127.0.0.1:8080
EXO_PI_BACKEND_LABEL=llama.cpp
```

Exo should launch the harness from the active workspace cwd:

```text
/Users/kenneth/Desktop/lab
```

Do not force cwd to the `ga-pi` repo. GA Pi should discover context from the cwd and ancestors, like Pi does for `AGENTS.md`, with the GA fork additionally reading `principal.md`.

## Tests

Add focused coverage for:

- persisted Pi settings make Pi launchable without process env
- env overrides still win over persisted settings
- missing backend hides Pi from launcher surfaces and shows setup detail in Agent Config / Plugin Manager
- configured backend makes Pi visible in launcher surfaces
- source checkout detection still works from project roots
- launch plan uses workspace cwd, not repo cwd
- no source default points to Kenneth's local paths

Useful existing test areas:

- `packages/core/src/__tests__/agent-harness-registry.test.ts`
- `packages/core/src/__tests__/runtime.test.ts`
- `packages/core/src/__tests__/surface-descriptor.test.ts`
- `apps/desktop/src/renderer/src/App.test.tsx`
- `apps/desktop/tests/e2e/shell.spec.ts`

## Acceptance

- A packaged Exo app can be opened normally and still show configured Pi-compatible harness status.
- A configured Pi-compatible harness appears in the launcher when backend config is present.
- A missing backend shows a clear missing dependency state and does not render a dead launcher.
- Kenneth can configure GA Pi without hardcoding GA Pi into Exo source defaults.
- `exo runtime status` and `exo runtime launch-plan pi` reflect the persisted config.
- The implementation preserves the plugin/harness boundary: metadata and settings are persisted, but no arbitrary plugin code is executed.

-- Shoshin | 2026-07-03
