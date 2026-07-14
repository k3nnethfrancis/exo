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

-- Exo | 2026-07-13
