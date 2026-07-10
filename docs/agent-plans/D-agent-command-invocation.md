# Agent D Plan: AgentCommand And Invocation

Last updated: 2026-07-09

status: Fable-reviewed planning packet. Agent D did not implement code and did not contact Fable directly; the orchestrator routed review and incorporated the amendments below.

## Fable Amendments

Fable required material changes to this slice before implementation:

- Persistent trust must never be created by a single launch-confirmation click.
- V1 may support one-shot launch of an untrusted command from confirmation, but persistent trust must be a distinct, default-off action that shows the exact command fingerprint, even if it is co-located in the same dialog.
- Move trust state out of workspace `.exo` into app-local state keyed by workspace root plus command fingerprint. Workspace-controlled files must not be able to create, modify, or import trust.
- Existing workspace-local trust files such as `.exo/agent-command-trust.json` should be discarded, not migrated/imported.
- Reject `stdin` and `argv` prompt-delivery modes at settings normalization in V1. Do not persist modes that cannot launch.
- CLI spawn remains app-backed and cannot self-trust.
- `exo spawn @handle` needs a final public-contract review note after the final request/response/error shape settles.
- CLI spawn records lifecycle only in V1; direct-write observation is note-context only because observation depends on a tagged document anchor.

## Scope

Agent D owns the configured-command invocation path:

- `AgentCommand` command identity and settings shape.
- Templates as config, not harness integrations.
- Workspace trust for executable command config.
- Strict editor-owned Markdown mention parsing.
- Human confirmation before launch.
- Generic tmux-backed terminal launch for configured commands.
- CLI `exo spawn @handle <task>`.
- Invocation record lifecycle and end semantics.
- Monitor visibility through normal terminal/session surfaces.

## Non-Goals

- No watcher-owned auto-run from saved Markdown.
- No proposal staging as the default return path.
- No direct-write diff UI beyond the invocation record and monitor handoff; Agent E owns observation/diff review.
- No line-perfect authorship claims.
- No new MCP path.
- No deep Claude/Codex/Fable harness adapter work.
- No broad plugin/template marketplace.
- No private-zone sandboxing claims.

## Evidence Checked

Planning docs:

- `docs/exograph-refactor-completion-plan.md`
- `docs/exograph-completion-orchestration-plan.md`
- `docs/exograph-detailed-implementation-plans.md`
- `docs/exograph-completion-master-plan.md`
- `docs/extension-architecture.md`
- `docs/note-native-agent-invocation-pivot.md`
- `docs/invocation-context-and-safety.md`
- `tasks.md`
- `issues.md`

Relevant code and tests:

- `packages/core/src/agent-invocation.ts`
- `packages/core/src/agent-mention-parser.ts`
- `packages/core/src/agent-command-trust-store.ts`
- `packages/core/src/invocation-store.ts`
- `packages/core/src/workspace-settings.ts`
- `packages/core/src/command-protocol.ts`
- `apps/desktop/src/main/agent-command-invocation-service.ts`
- `apps/desktop/src/main/invocation-observation-service.ts`
- `apps/desktop/src/main/terminal-manager.ts`
- `apps/desktop/src/main/command-server.ts`
- `apps/desktop/src/main/workspace-ipc.ts`
- `apps/desktop/src/shared/api.ts`
- `apps/desktop/src/preload/index.ts`
- `apps/desktop/src/renderer/src/App.tsx`
- `apps/desktop/src/renderer/src/components/NoteEditor.tsx`
- `packages/cli/src/index.ts`
- `packages/cli/src/app-client.ts`
- `packages/core/src/__tests__/agent-invocation.test.ts`
- `packages/core/src/__tests__/agent-command-trust-store.test.ts`
- `packages/core/src/__tests__/invocation-store.test.ts`
- `apps/desktop/src/main/command-server.test.ts`
- `packages/cli/src/index.test.ts`
- `apps/desktop/tests/e2e/agent-invocation.spec.ts`

## Current State

The branch already contains a first implementation of this slice:

- Core `AgentCommand`, `InvocationRecord`, prompt formatting, normalization, and fingerprinting exist.
- Unsupported V1 executable fields `env`, `template`, and `promptTemplate` are rejected by normalization.
- Strict mention parsing exists and ignores frontmatter, fences, blockquotes, lists, script/style/pre, comments, prose, and unknown handles.
- Workspace settings persist configured agent commands.
- A trust store exists, but it currently writes under workspace `.exo/agent-command-trust.json`; this must be replaced because workspace-local trust is not acceptable.
- Note invocation launches a generic configured command in a tmux-backed terminal through `TerminalManager.createAgentCommand`.
- CLI `exo spawn @handle <task>` posts to the app command-server route `/agent-commands/spawn`.
- CLI spawn blocks untrusted commands and rejects `note_dir`.
- Note invocation confirmation can currently trust a command through `trustOnHumanGesture: true`; Fable rejected this as a trust-and-launch fusion.
- Invocation records persist under `.exo/invocations/{id}/record.json`.
- Direct-write observation and diff finalization are partially implemented by Agent E's surface, but Agent D must preserve lifecycle compatibility.

## Add / Delete / Modify

### Add

- A user-visible command configuration surface or documented hand-edit path that makes `AgentCommand` config explicit and inspectable.
- A template-as-config mechanism for standard handles such as `@claude`, `@codex`, and `@fable`; templates should only prefill fields the user can inspect and own.
- A command trust review state in the UI that distinguishes never trusted, trusted, changed, disabled, and unsupported prompt delivery.
- A monitor-visible invocation list or terminal/session association sufficient for the user to find running `AgentCommand` sessions.
- Focused tests proving note invocation and CLI spawn share the same command model and trust semantics.

### Delete

- Any remaining mention-invocation dependency on harness registry readiness, send queues, semantic trace formatting, or provider-specific startup probes.
- Any UI copy that describes note invocation as Claude/Codex-specific rather than configured-command-specific.
- Any hidden auto-detection of prompt delivery mode.
- Any path that silently installs or enables command templates as trusted executable config.

### Modify

- Move trust state out of the workspace into app-local state keyed by workspace root and command fingerprint. Do not import existing workspace-local trust files.
- Replace trust-and-launch fusion with one-shot launch plus a separate, default-off persistent trust action that shows the exact fingerprint.
- Update confirmation copy to show the exact shell execution model: `/bin/zsh -lc "<configured command>"`, cwd, prompt delivery, command fingerprint/change status, and no sandbox claim.
- Ensure `AgentCommand` template/config docs say V1 supports only `terminalInputAfterLaunch`; `stdin` and `argv` are rejected at settings normalization until implemented.
- Keep CLI spawn app-backed for V1 and document that app-unavailable spawn fails intentionally.
- Ensure invocation record status semantics are exhaustive: `running`, `process-exited`, `user-ended`, `timeout-ended`, `failed`, and `orphaned`.

## Implementation Sequence

1. Freeze the data contract.
   Confirm `AgentCommand`, `InvocationRecord`, command-server request/response, and shared API shapes before more code lands. Any additive public fields need orchestrator/Fable review.

2. Resolve trust storage and trust gesture.
   Replace workspace-local trust with app-local trust keyed by workspace root plus command fingerprint. Add a one-shot launch path and a separate persistent trust act. Remove `trustOnHumanGesture: true` as a launch shortcut.

3. Complete config/template UX.
   Provide the minimal path to create/edit command records and instantiate templates as ordinary config. Do not add a Plugin Manager, marketplace, or harness adapter surface.

4. Harden note invocation confirmation.
   The confirmation must save or refuse dirty tagged documents, then launch only after the prompt pointer and pre-snapshot match disk. It must show exact command/cwd/no-sandbox/direct-write warnings.

5. Keep launch generic.
   `TerminalManager.createAgentCommand` remains a plain terminal path using `/bin/zsh -lc`; it should not pick up harness readiness gates, semantic send queues, or provider-specific behavior.

6. Close CLI spawn contract.
   `exo spawn @handle <task>` should remain app-backed in V1, require trusted config, reject `note_dir`, return JSON with invocation/terminal refs, and fail clearly when the app is unavailable.

7. Finish lifecycle and monitor visibility.
   Running invocations need a visible terminal/session. Interactive sessions must be endable without terminating the terminal, and app restart must mark active records orphaned honestly.

8. Handoff to Agent E/F.
   Agent E consumes invocation records and terminal exit/user-end events for diff attribution. Agent F verifies CLI, renderer, Electron, and real pointer-prompt dogfooding.

## Dependencies

- Agent A owns command-server public-contract guardrails and must preserve `/agent-commands/spawn` token auth if the route survives.
- Agent A also owns removal of stale harness-manager product paths after AgentCommand launch fully replaces them.
- Agent E depends on stable invocation ids, statuses, tagged document paths, terminal ids, and lifecycle events.
- Agent F owns the 10 real pointer-prompt dogfooding invocations and final QA matrix.
- Terminal runtime invariants from `terminal-stability` apply: no direct pty fallback, no transcript replay as live render, no provider-specific logic in low-level terminal runtime.

## Trust And Safety Implications

- A Markdown mention is an execution affordance. It must stay editor-owned and user-confirmed in V1.
- Agent-authored Markdown must not auto-chain into a new invocation.
- A configured command is native code from the user's machine. Exo must not imply sandboxing or private-zone enforcement.
- Trust invalidation must include command string, id, handle, cwd policy, fixed cwd, prompt delivery, version, and any future env/template/prompt fields before launch.
- Current note invocation can trust on human confirmation. This is no longer acceptable because it combines launch confirmation and first-time trust into one gesture.
- Current trust storage is inside workspace `.exo`. This is no longer acceptable; workspace-controlled files cannot create or carry trust.
- CLI spawn should not gain `--trust`, `--yes`, or other self-trust flags in V1.

## Public CLI Contract Implications

The public/operator surfaces in this slice are:

- CLI: `exo spawn @handle <task>`
- command-server route: `POST /agent-commands/spawn`
- shared protocol: `ExoSpawnAgentCommandRequest` and `ExoSpawnAgentCommandResponse`
- desktop IPC/preload: `workspace:launch-agent-invocation`, `workspace:end-agent-invocation`, `workspace:read-invocation-diff`

The plan assumes `exo spawn` is now an intended V1 CLI contract. Before shipping, the orchestrator should ensure `docs/public-contract-reviews.md` and `scripts/check-repo.mjs` include the surviving CLI/command-server/shared-protocol slices and that Fable review covers the final request/response shape.

## Tests And QA

Core:

- Normalize valid commands; reject invalid handles, multiline commands, duplicate ids/handles, missing fixed cwd, and unsupported V1 env/template fields.
- Fingerprint all executable fields and prove non-executable label changes do not invalidate trust.
- Parse mentions with false-positive cases from real vault shapes.
- Normalize note and CLI invocation records with lifecycle statuses.
- Trust store invalidates changed command/cwd/prompt/version.

Desktop main:

- Launch trusted configured commands through generic terminal path.
- Reject disabled, untrusted, unsupported prompt delivery, missing command, and CLI `note_dir`.
- Save or refuse dirty note before launch.
- Write invocation records with terminal/transcript refs.
- Mark never-exiting sessions user-ended through explicit action.
- Mark running records orphaned on app restart.

Renderer:

- Show invoke affordance only for strict mention lines with enabled configured handles.
- Confirmation copy includes document path, literal command, cwd, no-sandbox/direct-write warning, and mention text.
- Human confirmation is required.
- Dirty save failure refuses launch.
- Running invocation is visible and can be ended.

CLI/command server:

- `exo spawn @handle <task>` posts exact handle/task and prints JSON result.
- Missing `@` handle or task fails with usage.
- App unavailable fails clearly.
- Untrusted command returns structured 403.
- Command-server auth token is required for the route.

E2E/manual:

- Fake configured command appends to a note and shows a terminal, running banner, finalized record, and diff.
- Real configured command receives the pointer prompt and can locate the document.
- CLI spawn launches the same configured command from trusted config.
- Run 10 real pointer-prompt invocations against copied representative notes before broad dogfooding.

## Open Unknowns

1. What is the exact app-local storage location and keying format for command trust?
2. What copy and layout make the one-shot launch action and persistent trust action impossible to confuse?
3. Is `/bin/zsh -lc "<configured command>"` acceptable long-term, or should V2 split executable/args for safer display and fingerprinting?
4. How much monitor UI is required for V1: terminal visibility only, or an invocation list with status/end controls?
5. How should settings report rejected `stdin` and `argv` modes in imported configs?
6. Should command templates be stored in docs only, workspace settings presets, or a small built-in template registry that writes ordinary config?
7. What retention/cleanup story should exist for invocation records that contain private prompt text and diffs?

## Fable Review Packet

Context:

- Exo is pivoting to note-native configured-command invocation.
- The branch already has `AgentCommand`, strict mention parsing, trust store, generic terminal launch, command-server spawn, CLI `exo spawn`, invocation records, and E2E fake-command coverage.
- Remaining architectural risks are trust semantics, public contract shape, and whether current trust storage satisfies the product boundary.

Decision needed:

- Approve or revise the AgentCommand trust/launch contract before implementation continues.

Options:

- Option A: note confirmation both trusts and launches; CLI spawn requires pre-trusted config.
  This is fastest and matches the current implementation, but the confirmation copy must be very explicit because one click activates native code for future runs.

- Option B: note confirmation launches only already trusted commands; command config review/trust is a separate UI action.
  This is stricter and cleaner for cloned workspaces, but adds one more setup surface before note invocation feels usable.

- Option C: allow one-shot untrusted launch without persisting trust.
  This reduces persistent risk but makes repeated use noisy and still launches native code from workspace config.

Recommendation:

- Use a pragmatic Option B/C hybrid: allow one-shot untrusted launch, but persistent trust is a distinct default-off action in the confirmation/config review UI.
- Move trust state to app-local data keyed by workspace root and command fingerprint. Discard workspace-local trust files.
- Keep `/bin/zsh -lc` for V1, with literal command display and fingerprinting.
- Keep CLI spawn app-backed and no-self-trust in V1.

Fable answered this packet on 2026-07-09:

- Trust model: use one-shot launch plus a separate, default-off persistent trust act showing the fingerprint.
- Trust storage: app-local only; discard workspace-local trust.
- `exo spawn` / `/agent-commands/spawn`: final shape needs a separate public-contract review note after implementation settles.
- `stdin`/`argv`: reject at settings normalization in V1.
- Terminal visibility is enough monitor coverage for V1 if invocation lifecycle/end controls are visible.
- QA matrix is sufficient after adding negative tests for workspace-local trust import and trust-and-launch fusion.

## Stop Conditions

Stop and escalate to the orchestrator if implementation requires:

- A new CLI flag, command-server route, or shared protocol field not covered by public-contract review.
- Auto-running mentions from watcher-detected file changes.
- Launching untrusted or changed command config without explicit human trust.
- Trusting command config from a cloned workspace automatically.
- Reading, writing, or importing trust from workspace-controlled files, including `.exo`.
- Persisting trust and launching from one undifferentiated click.
- Claiming sandboxing, private-zone enforcement, or line-perfect authorship.
- Reintroducing provider-specific harness launch behavior into `AgentCommand`.
- Clobbering dirty editor buffers before pointer prompt/pre-snapshot alignment.
- Treating app-unavailable CLI spawn as a reason to run commands directly from the CLI in V1.

-- Exo Agent D | 2026-07-09
