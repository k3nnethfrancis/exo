# Note-root-only distillation inventory

Status: pre-implementation evidence for Loop 01 P2/P4.
Scope: inventory only; no source, public-contract, or product behavior changed.
Decision being implemented: Exo owns one authorized mutable filesystem surface—**Note Roots**. It must not retain Project Roots or Attached Folders as a second read/search/preview/terminal surface.

## Executive recommendation

Delete the capability as one vertical migration, not a UI hiding exercise. First make the persisted model and core filesystem identity note-root-only; then remove main/preload/renderer/CLI consumers and their fixtures; finally delete superseded plans and refresh the durable docs. Preserve unknown settings keys generally, but explicitly strip the known removed `projectRoots` key through a named migration. Leaving it round-trippable would preserve an inactive authorization surface and make future reintroduction accidental.

This is a trust-boundary and protected-contract change. It should use the existing Fable review as an asynchronous review point, run in parallel with independent settings/editor work, and not block the rest of the wave. Before merging, the lead must update the protected-contract ledger if the CLI status payload or shared workspace types move.

## Current evidence

### 1. The legacy root is structural, persisted, and authorized

| Layer | Evidence | Consequence of leaving it |
| --- | --- | --- |
| Core data model | `packages/core/src/types.ts:3-29` defines `RootKind = "notes" | "projects"`, `AttachedRoot`, `WorkspaceModel.projectRoots`, and persisted `WorkspaceSettings.projectRoots`. | A second root kind remains valid everywhere types are trusted. |
| Resolution/settings | `packages/core/src/workspace.ts:54-77` reads `EXO_PROJECT_ROOTS`; `:158-161` silently invents an Exo project root. `packages/core/src/workspace-settings.ts:45-53,275-294,307-345` preserves and rehydrates project roots. | A clean install can regain an unasked-for read surface; persisted settings/registry keep it alive. |
| Core behavior | `workspace.ts:318-335`, `search-providers/filesystem-provider.ts:166`, `graph-snapshot.ts:134`, and graph scope types use project roots. | Search/index/graph identity still imply a non-note filesystem domain. |
| Main process | `workspace-watchers.ts:58`, `preview-target.ts:48-52`, `terminal-manager.ts:151`, `index.ts:207,224,374`, and `workspace-config-store.ts:103` consume/project the field. | The removed root remains watched, preview-authorized, exposed to Commands, and seeded from app environment. |
| Renderer | `useWorkspaceTrees.ts:81-93`, `FileTree.tsx:23-235`, `ShellLayout.tsx:123`, `ExplorerSections.tsx`, and settings controller/model/dialog types retain attached-folder rendering and structural save behavior. | It remains a visible alternate filesystem and a future UI regression trap. |
| CLI and protocol-adjacent output | `packages/cli/src/index.ts:207` serializes `projectRoots` in app-off status. | Removing it changes operator-visible JSON; it is covered by the public CLI command guard. |
| Tests/fixtures | `apps/desktop/tests/helpers.ts`, `shell.visual.spec.ts`, `agent-invocation.spec.ts`, core workspace/settings/graph/search tests, and main tests set `EXO_PROJECT_ROOTS` or assert root behavior. | Fixtures currently normalize the capability as required baseline behavior. |

There is no separate `packages/mcp` or plugin package left. The remaining root capability is therefore not justified as an extension or compatibility surface.

### 2. Legacy plans and concepts that must not become current truth

These are documentation/deletion targets, not active specifications (per `AGENTS.md`). Group them so a cleanup agent can make intentional decisions rather than bulk-replace strings.

| Class | Primary artifacts | Action |
| --- | --- | --- |
| Plugin/capability architecture | `docs/plugins.md`, `plugin-system-architecture.md`, `plugin-surface-contract.md`, `plugin-implementation-plan.md`, `plugin-manager-foundation.md`, `profile-plugin-management-plan.md`, `agent-harness-plugin-contract.md`, `activity-plugin-contract.md`, `graph-visualization-plugin-contract.md`, `docs/adr/0001-plugins-and-profiles.md` | Delete superseded plans/contracts. Retain only the current `docs/extension-architecture.md` and ADR 0003 if they accurately describe the future *distribution bundle*, never an in-process platform. |
| Harness/profile/routine/MCP history | `docs/harness.md`, `control-plane-catalog.md`, `mcp-nde-test-2026-06-20.md`, `agent-identity-reconciliation.md`, old completion/orchestration/refactor plans, `issues.md` historical entries | Keep historical issue evidence only if clearly marked resolved/superseded; delete or consolidate active-looking plans. Do not revive command routes, profile recovery, routines, or MCP. |
| Tmux/transcript runtime history | `docs/terminal-runtime-decision.md`, `terminal-refactor-plan.md`, `terminal-attach-spike-report.md`, `terminal-quality-standard.md`, `terminal-code-review-2026-06-23.md`, `terminal-fallback-audit.md`, `terminal-render-cleanup-protocol.md`; old issue text | Delete plans that prescribe tmux ownership/durable transcripts. Distill still-valid direct-PTY invariants into `skills/terminal-stability/SKILL.md`, `AGENTS.md`, and current architecture docs. Historical issue records may stay as history but must not contradict current runtime. |
| Still-live terminal compatibility state | `packages/core/src/types.ts:37-49`, `workspace-settings.ts:29,354-369`, `terminal-manager.ts:67`, renderer settings mapping/tests, E2E fixtures | Separate follow-up deletion/migration: transcript retention and exposed terminal tuning fields survive even though direct-PTY policy says xterm owns scrollback and no durable transcript is promised. Preserve bounded replay/read-tail invariants, remove user-facing obsolete controls/keys only after terminal-stability review. |
| Stale generated/artifact references | `docs/artifacts/core-plugin-boundary.html`, `overall-exo-architecture.html`, `terminal-runtime-v3.html`, preview tests that use `core-plugin-boundary.html` | Replace preview fixture with neutral test HTML before deleting stale artifact; otherwise preview tests accidentally retain plugin vocabulary. |

### 3. Durable types, settings, and IPC/public payloads requiring review

| Surface | Required migration | Flag |
| --- | --- | --- |
| `WorkspaceModel`, `WorkspaceSettings`, `AttachedRoot`, `RootKind` | Collapse to a single explicit Note Root representation; delete `projectRoots`, `RootKind.projects`, and `AttachedRoot` only if no remaining consumer needs the generic shape. `indexedRoots` remains a search configuration but must not authorize editable/read paths outside Note Roots. | **Trust boundary**; shared core type. |
| `workspace-settings.json`, `workspace-registry.json`, transaction file | Implement an explicit, idempotent migration that removes only known legacy `projectRoots`/`EXO_PROJECT_ROOTS` data while retaining unrelated unknown keys. It must reconcile both primary settings and registry snapshots, including interrupted transaction recovery. | **User data migration**; no generic unknown-key loss. |
| App status JSON | Remove `projectRoots` from CLI `status` once core no longer has it; update help/docs and contract review hash. | **Protected CLI contract**. |
| Desktop IPC (`workspace:*`) | Payloads are typed through `WorkspaceApi` / `WorkspaceModel`; validate that list/read/preview/tree paths reject every non-note-root path after removal. No new IPC route should be introduced. | **Renderer/main filesystem authorization**. |
| Command environment | Remove `EXO_PROJECT_ROOTS` from terminal manager and app bootstrap. Commands retain an explicit user-configured cwd policy, but Exo must not elevate a deleted root list into implicit authority. | **Process execution/trust**. |
| Preview target validation | Limit local file preview to workspace policy deliberately. If "workspace root" itself permits arbitrary siblings outside Note Roots, remove that bypass too; local previews must not re-open the deleted root authorization surface. | **Preview security boundary**. |

## Ordered implementation plan

1. **Model and persistence migration (owner: core/main).**
   - Delete `projectRoots` model/settings/env/default-root construction; make root identity Note-Root-only.
   - Add migration tests for legacy settings, registry, and interrupted transaction: known legacy fields disappear; agent commands, layout, indexing, and unknown future fields survive.
   - Decide and document whether legacy data is rewritten immediately on successful load or at next save. Recommendation: rewrite atomically during the existing recovery/load transaction so inactive authority does not remain indefinitely on disk.

2. **Authorization and filesystem consumers (owner: core/main).**
   - Rebase watchers, graph/search indexing, document reader, tree/read/write operations, preview resolution, and command environment on Note Roots only.
   - Replace any broad `workspaceRoot` path authorization with canonical Note Root containment. Verify traversal, symlink, outside-root link, local preview, and command cwd cases.

3. **Renderer/CLI removal (owner: renderer + CLI).**
   - Delete attached-folder Explorer sections/toggles and structural setting plumbing; simplify mutation names that only distinguish attached roots.
   - Remove CLI status `projectRoots` serialization and stale environment injection. Do not add replacement “attach” affordances.
   - Update exact tests/visual baselines/fixtures to exercise multiple Note Roots instead.

4. **Terminal/data-model distillation (separate terminal-stability-owned subtask).**
   - Remove only obsolete transcript/tmux compatibility fields and plans after tracing current reads. Keep bounded live tail, replay, health, and direct-PTY QA; do not conflate this with the root migration.

5. **Documentation deletion and consistency sweep (owner: docs).**
   - Remove superseded plans/artifacts after live callers/tests are gone; update the durable architecture, glossary, readme, roadmap, tasks/ledger, and ADR index together.
   - Treat `AGENTS.md`/`CONTEXT.md` current references to Attached Folders as a required correction, not historical material.

6. **Full proof.**
   - Run focused core/desktop/CLI suites, `pnpm check:repo`, full `pnpm ci:check`, and packaged-app QA against a guarded real-vault copy. Verify opening old settings does not recreate or authorize legacy paths.

## Required test matrix

- Legacy config migration: settings, registry, transaction recovery, unknown keys, layout, agent commands, indexed roots.
- No `EXO_PROJECT_ROOTS` behavior: absent and present environment inputs cannot create roots or alter CLI status.
- Multiple Note Roots: tree, search, graph, open/read/edit, watcher updates, and folder-index behavior remain correct.
- Negative containment: relative traversal, symlink escape, clicked wikilink, command-server read/open, preview local file, and command cwd all reject outside roots.
- UI: Explorer has no Attached Folder section/toggle; Settings does not persist or render it; existing real note workflows remain accessible.
- Operator contract: app-off `status/search/read`, app-backed `open/preview/spawn/terminal`, and JSON output documented and protected.
- Packaged app: old config migration, onboarding, settings close/reopen, command preservation, layout preservation, and real-vault-copy operation.

## Review and stop conditions

Ask Fable to review these concrete decisions asynchronously while the independent Settings and editor work proceeds:

1. Whether legacy `projectRoots` should be atomically stripped on load (recommended) or only on save.
2. Whether a configured Command `cwd` may remain any explicit user-selected path after root deletion, or must be constrained to Note Roots (recommend explicit cwd can remain only with existing trust/confirmation, never as an implicit root grant).
3. Whether local Preview should permit an explicitly selected path outside Note Roots; the safe recommendation is no, unless a narrow, reviewed Preview target trust model is already implemented.

Stop before shipping if implementation requires a new command-server route, CLI flag/command, shared protocol route, generic attachment model, or unreviewed filesystem authority. Those are material public/trust changes, not cleanup.

-- Loop 01 inventory | 2026-07-12
