# EXO-ISSUE-115 session continuity implementation status

## 2026-07-13 — Started

- Loaded the approved Fable ruling, protected contract packet, architecture analysis, terminal invariants, and frontend configuration rules.
- Sequence: pin lifecycle to originating Workspace; land normalized contracts/store; add Claude continuity and locking; add compact setup/settings UI; run focused and full app gates.
- Stale-session fallback remains fail-closed unless a pre-turn stale signature is proven. No guessed provider parsing.
- Out of scope: inline diff work, CLI routes, queues, forks, plugin seams, Codex continuity.

## 2026-07-13 — Phase 1 complete: Workspace pinning

- `PreparedInvocation` now captures its originating Workspace root and Note Roots.
- Trust, initial records, prompts, active observations, and final settlement use the captured Workspace root rather than rereading whichever Workspace is active later.
- Added a regression test that switches the active settings getter from Workspace A to B before process exit and proves the final record remains only under Workspace A.
- Focused desktop suite: 24 files / 181 tests passed.

## 2026-07-13 — Phase 2 complete: contracts and derived head store

- Added explicit `generic` / `claude-code` / `codex-cli` Command adapters. Only exact known built-ins migrate to provider adapters; editable handles and custom commands remain generic.
- Added per-Command `continuous` / `fresh` policy. The exact built-in Claude Command defaults continuous; Codex and generic Commands normalize fresh until their continuity adapters are proven.
- Added per-Invocation fresh/resumed/fallback provenance while keeping provider session IDs separate from Exo Invocation IDs.
- Added an atomic, Workspace-local `.exo/invocation-continuity/v1` head store keyed by Workspace, Command, canonical cwd, and validated against adapter/fingerprint.
- Core: 15 files / 99 tests passed. Desktop focused suite: 24 files / 181 tests passed. Core and desktop typechecks passed.

## 2026-07-13 — Phase 3 complete: Claude continuity runtime

- Added explicit adapter-owned Claude fresh/resume command building and structured session extraction; provider logic no longer keys off handles.
- Automatic context continuation re-reads the head only after acquiring a per-lane lock. Same-lane overlap fails visibly; no queue or fork exists.
- The exact Claude 2.1.208 pre-turn stale signature falls back fresh once and records `resume-failed-fresh`; every other failure remains fail-closed without retry or head advancement.
- Process results now retain bounded stderr and spawn errors so recovery classification is evidence-based.
- Invocation lookup/review/reject/resume use an origin-Workspace scope map, records carry immutable origin scope, and renderer updates from another Workspace are ignored.
- Added fresh→resume, stale fallback, unknown failure, concurrency/release, adapter fixture, and cross-Workspace review/restore tests.
- Desktop: 25 files / 189 tests passed. Core: 15 files / 99 tests passed. Typechecks passed.

## 2026-07-13 — Phase 4 complete: policy and reset UI

- Onboarding and Agent Settings now expose a per-Command `Keep context` control only for the Claude adapter. Codex and generic Commands show context as unavailable and remain fresh-only.
- Agent Settings queries derived context status through a narrow active-Workspace IPC and offers `Reset` only when a stored head exists. Reset accepts only a Command ID, clears all cwd lanes for that Command in the current Workspace, and refuses while any matching lane is active.
- Unknown resume failures now retain explicit `resume-failed` provenance and render as `Could not continue context`; they are no longer mislabeled as continued or fresh.
- Focused desktop suite: 25 files / 191 tests passed. Core: 15 files / 101 tests passed. Core and desktop typechecks passed.

## 2026-07-13 — Final verification

- Full repository checks passed with an isolated dry-run install prefix: repo checks, all package typechecks, 12 script tests, 101 core tests, 191 desktop tests, 29 CLI tests, desktop production build, CLI build, and install dry run.
- The default install dry run correctly refused to replace the existing `~/.local/bin/exo` symlink from another checkout; rerunning against `/tmp/exo-ci-session-continuity` passed without mutating the installed command.
- Electron Playwright app QA could not start because this worktree's installed Electron package is incomplete (`Electron Framework.framework` is absent). This is an environment/runtime fixture failure before Exo launches, not an assertion failure. Focused lifecycle, adapter, renderer presentation, status/reset, and store coverage remains green.
- Remaining product boundary: automatic continuity is intentionally Claude-only. Codex and generic Commands remain visibly fresh-only until a provider-specific adapter and evidence-backed stale-session contract exist.

-- Exo | 2026-07-13
