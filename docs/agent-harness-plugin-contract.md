# Agent Harness Plugin Contract

Last updated: 2026-07-05

status: unstable. This contract is pre-public and carries no compatibility promise until the plugin manifest can declare a minimum supported contract version and the contract has two real consumers.

This document defines the adapter contract for official and local Exo agent harness plugins.

## Decision

Agent harness plugins adapt terminal-based agent systems to Exo. Claude Code, Codex, Pi-compatible builds, Aider, Goose, OpenCode, and local/open-source agents should all use the same contract shape.

Harness plugins do not own terminal rendering or terminal session durability. Exo core owns tmux-backed supervision, xterm rendering, scrollback, transcripts, reconnect, diagnostics, resize/focus behavior, and semantic message delivery. A harness plugin describes how an agent is discovered, launched, configured, messaged, and explained to the user.

## Type Surface

The TypeScript contract starts in `packages/core/src/agent-harness.ts`.

An `AgentHarness` exposes:

- capability metadata: persistent id, owner, lifecycle, surfaces, and requested permissions
- adapter metadata: adapter id, family, product name, executable names, docs, and homepage
- launch planning: command, args, title, and the current terminal runtime kind
- availability detection: enabled, configured, detected, launchable, status, executable path, repo path, install help, and dependency status
- semantic message behavior: paste/enter, stdin, command, or file-based submission, multiline support, readiness signals, and submit delay
- semantic trace declaration: optional sources, event kinds, default visibility, and trace artifact filename
- skill inventory: harness-visible skills, source, enabled state, required state, and config paths
- config inventory: env vars, config files, commands, services, value kind, required state, redaction, and setup detail
- setup guidance: install, configure, authenticate, start-service, and verify actions
- terminal ownership: always `core`

The public agent-create path now uses harness ids and validates them against registered, enabled, surface-approved, visible, launchable harnesses. The lower-level terminal runtime still carries compatibility `ManagedAgentKind` fields for built-in creation and persisted-session backfill; future cleanup should keep removing those from renderer/API launch descriptors without weakening terminal/session recovery.

## Adapter Families

Official and local adapters should use these families where possible:

- `claude-code`
- `codex`
- `pi`
- `aider`
- `goose`
- `opencode`
- `local`
- `open-source`

Specific local variants can use namespaced adapter ids such as `local:llama-agent` or `open-source:my-agent`. Local forks such as GA Pi should be configured instances of the generic Pi-compatible or local/open-source contract unless their protocol diverges enough to need a separate adapter.

## Availability

Availability detection must separate:

- `enabled`: policy allows this harness to launch
- `configured`: the user has supplied explicit configuration
- `detected`: Exo found installation evidence, such as an executable or repo path
- `launchable`: enabled, detected, and all required dependencies are satisfied
- `visible`: whether normal launcher/config lists should show the harness

Missing or broken harnesses should not render dead launcher buttons. They belong in Plugin Manager or Agent Config surfaces with setup guidance.

Dependencies should be explicit. Supported dependency kinds include binary, runtime, package manager, auth, config, model, and inference backend. Local/open-source harnesses should report model and inference-backend state instead of hiding missing local services behind a generic "not found" status.

## Launch Planning

A harness launch plan describes only the child process request:

- command
- args
- title
- current terminal runtime kind
- optional environment/config guidance

Core injects workspace/runtime environment such as `EXO_WORKSPACE_ROOT`, instruction overlay paths, retrieval provider metadata, and communication paths. Harness plugins should not bypass core terminal creation or write directly into renderer state.

## Semantic Messages

Harnesses must declare how Exo should submit semantic messages:

- supported modes: `paste-enter`, `stdin`, `command`, or `file`
- default mode
- multiline support
- whether Enter submits
- optional submit delay
- readiness signal, pattern, timeout, grace period, and failure patterns

Provider-specific startup heuristics should live in harness readiness policy, not in the generic terminal renderer. Core still performs the actual terminal write so transcripts, diagnostics, and user-visible delivery state remain consistent.

## Semantic Traces

Harnesses may declare whether they can produce structured semantic trace events. The current pre-public shape is metadata-only:

- source: stdout JSONL, stderr JSONL, sidecar JSONL, hooks, command log, ANSI transcript, or none
- supported event kinds from `exo.semantic-trace.v1`
- default visibility for emitted events
- optional trace artifact filename

The first implemented capture seam is the launch-plan `traceCapture` declaration for `stream-json`-shaped stdout/stderr/sidecar JSONL. Pi-compatible harnesses bind this first through `sidecar-jsonl`: Exo provisions a session-specific sidecar path under `.exo/traces/sidecars/{sessionId}.ndjson`, passes it through the declared `EXO_PI_SEMANTIC_TRACE_PATH` env var, and also supplies generic `EXO_SEMANTIC_TRACE_PATH`, `EXO_SEMANTIC_TRACE_SESSION_ID`, and `EXO_SEMANTIC_TRACE_HARNESS_ID` env vars for compatible adapters.

The stream-json sidecar contract accepts line-delimited packets such as `session-start`, `turn-start`, `assistant-text`, `tool-call`, `tool-result`, and `lifecycle`. Exo follows the declared sidecar and maps packets into `.exo/traces/{sessionId}.ndjson`, with `.exo/traces/{sessionId}.json` linking the trace artifact. Unknown packets are kept as `harness.raw`. Fixture-only direct writes into `.exo/traces/{sessionId}.ndjson` are test setup only, not production trace capture.

Semantic traces are separate from terminal output. Core terminal services still own tmux, xterm, scrollback, transcripts, reconnect, and input delivery. Harness adapters may later tee provider-native JSON streams, hooks, or sidecar logs into `.exo/artifacts/{activityId}/semantic-trace.jsonl`, but they must not use semantic traces as a second live terminal screen source.

Trace payloads remain plugin/provider-owned. Core only defines the envelope and reference model so later trace collectors, eval exporters, dataset builders, and review tools can consume events without another terminal-service re-plumb.

Trace production is the first external harness contract Exo should validate because the Pi-compatible sidecar path is already the first producer and Claude is the intended second producer. Dataset/export and eval packet schemas should wait until a real consumer, expected to be Helm reading Exo traces for judging or training-data workflows, exists.

## Skills And Config

Skills are harness-visible capabilities that prompts and routine templates can require. The first contract is metadata-only:

- skill id and label
- source: built-in, filesystem, or external
- enabled/required state
- compatible harnesses
- config paths
- detail/warnings

Config inventory should name what a harness needs without exposing secrets:

- environment variables
- config file paths
- commands
- local services
- value kind and redaction
- required/configured state

Exo can use this inventory to warn when a Routine needs a skill the selected harness does not expose, or when a harness is installed but missing auth, model, or backend setup.

## Setup Guidance

Setup guidance should be actionable and non-executable by default. A setup action may name a command or URL, but Exo must not run arbitrary plugin setup commands from a manifest without a future explicit permissioned flow.

Use setup actions for:

- install instructions
- environment or config steps
- authentication
- local service startup
- verification

## Security And Trust

Plugin manifests are metadata-only today. Discovery reads `exo.plugin.json`; it does not import code, spawn setup commands, grant terminal launch rights, add MCP tools, or mount renderer panels.

`trusted + enabled` exposes metadata and supported settings through reviewed surfaces. Executable adapter loading, setup command execution, and plugin-contributed CLI/MCP/UI surfaces require future sandboxing, permission grants, logging, revocation, and tests.

## Why Terminal Rendering Remains Core

Terminal behavior is a product safety boundary. Exo needs one reliable implementation for:

- tmux-backed process durability
- xterm rendering and scrollback
- transcripts and live tails
- resize, focus, reconnect, and hydration
- semantic send versus raw write behavior
- diagnostics and recovery
- CLI/MCP/app terminal APIs

Letting each harness own terminal rendering would multiply failure modes and make agent work impossible to debug. Harness plugins provide semantics; core owns the terminal.

Instrumented runtimes do not change this boundary. A harness may emit structured trace events, but terminal runtime, rendering, transport, reconnect, transcripts, diagnostics, and semantic message delivery remain core-owned and are not plugin contracts.
