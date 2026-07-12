# Fable review packet: Loop 01 trust, editor, and repository convergence

Status: Fable review received; implementation proceeds asynchronously under the recorded ruling below.

## Context

Exo is a local, user-owned Markdown exocortex. The launch loop is a trustworthy Note Root, filesystem/QMD retrieval, actionable graph context, and explicit configured-Command invocation with reviewed Markdown changes. The product deliberately does **not** include Project Roots/Attached Folders, MCP, Plugin Manager, routines, provider harness management, or a general extension runtime.

Recent implementation has improved the editor's first-paint navigation path and added 100-sample regression budgets for Explorer, actual `exo open`, titlebar search result selection, breadcrumbs, and backlinks. Every route currently meets p50 <=99ms, p90 <=150ms, p99 <=300ms.

The current ledger groups the next work into: (1) trust gates, (2) editor/invocation completion, and (3) repository/type/docs distillation. The working tree also contains an unintegrated Command-readiness draft and documentation edits owned by earlier work; Loop 01 must preserve them until they receive explicit review.

## Decisions needed

1. Is the proposed sequence and package boundary right for completing these three phases without reintroducing old architecture?
2. Is hard removal of `projectRoots`/Attached Folder state, UI, IPC, and documentation the right migration policy for V1, given the explicit product decision that only Note Roots exist?
3. Is a root-relative `WorkspaceFiles` identity migration required before declaring filesystem containment complete, or can the current canonical-path authorization seam be closed with expanded behavior coverage first?
4. Does the existing invocation review model—observed file changes with likely/ambiguous attribution, dirty-buffer protection, and a page-native inline composer—have the correct V1 boundary for real-work dogfooding?

## Evidence

- `EXO-ISSUE-102` has revision-aware, main-process-owned settings patches, unknown-key preservation, and focused command-preservation coverage. Remaining evidence is section-by-section preservation (appearance/search/terminal/layout) and invokability after each round trip.
- `EXO-ISSUE-103` routes desktop IPC and command-server reads through a containment seam and covers traversal, absolute path, symlink, and missing-ancestor cases. Remaining work includes rename/delete/duplicate-root coverage, a root-relative identity decision, and guarded real-vault-copy dogfooding.
- `WorkspaceSettings`, `WorkspaceModel`, filesystem search, watchers, renderer settings, and tests still carry `projectRoots`; removing them is a cross-package persisted-model deletion with no intended replacement.
- The note editor now has a transient `@command` multiline composer; only Shift+Enter invokes. Invocation records and changed-file/diff attribution already exist. Remaining work is real-work dogfood and editor typography/H1 entry polish.
- Legacy plugin/harness/MCP/routine plans and some code/config vocabulary remain. The Exo extension guard requires live-caller evidence before preserving any legacy seam.

## Proposed packages

### P0 — establish a clean integration baseline

Review the untracked Command-readiness implementation and current dirty docs as owned work. Either integrate them with focused evidence or discard them deliberately. Do not mix this review with unrelated feature edits.

### P1 — Settings preservation closure (`EXO-ISSUE-102`)

Add Electron journeys proving each Settings section preserves commands, layout, unknown keys, and migration metadata; prove a persisted Command remains launchable after all round trips. No new settings fields, CLI flags, routes, or persistence mechanism.

### P2 — Note Root authority and Project Root removal (`EXO-ISSUE-103`)

First audit every live `projectRoots`/Attached Folder caller across core, desktop, CLI, tests, and docs. Delete the product capability and normalize stale persisted project-root entries away. Complete containment tests for rename/delete/duplicate roots and run guarded real-vault-copy dogfood. Do not add a second authorization class, fallback root, or compatibility UI. Stop if removal requires a new public CLI/command-server/shared-protocol contract.

### P3 — editor and invocation completion

Polish Markdown hierarchy and new-note H1 entry behavior with real-note Electron QA. Dogfood multiline `@claude` invocation and the changed-file/dirty-buffer review loop on real work. Retain the page-native composer; do not turn note save or arbitrary Markdown mentions into triggers.

### P4 — type/data-model/docs distillation

After P1/P2 settle the retained model, audit durable types, persisted settings, IPC payloads, and filesystem objects for one owner and one product meaning. Delete stale legacy code/plans after caller evidence; consolidate current docs and create a compact feature/data-model coverage index. Do not create plugin compatibility shims or preserve dead registries for possible future consumers.

## Options

**A. Recommended — P0, then P1 and P3 in parallel; P2; P4 last.**

P1 and P3 are independently testable. P2 is serialized after P1 because both touch persisted workspace settings. P4 follows retained-model decisions, avoiding a second documentation rewrite.

**B. Delete Project Roots first, then complete settings and editor work.**

Simplifies the model early but risks obscuring settings-preservation regressions and contaminating P1 with a migration.

**C. Treat Project Roots as a hidden compatibility/read-only context class.**

Rejected: it contradicts the explicit Note-Roots-only product decision and creates a second trust boundary.

## Orchestrator recommendation

Approve A. Hard-delete Project Roots with normalization that drops stale persisted entries rather than migrating them into a new concept. Require a complete caller audit and narrow tests before removal. Close containment with root-relative identities if they can be introduced behind the existing main-process boundary without a public contract; otherwise retain the current canonical authorization boundary, close its behavioral proof, and record root-relative IDs as a bounded follow-up rather than inventing a public migration.

## Please review

1. Risks or missing constraints in P0–P4.
2. Whether P2 should require root-relative identities before issue closure.
3. Whether dropping stale `projectRoots` is adequate or needs a user-visible migration/recovery artifact.
4. Whether the proposed invocation dogfood/attribution boundary is sufficient for V1.
5. Whether this plan may proceed to fan-out, needs revision, or needs a narrower first slice.

## Fable ruling — 2026-07-12

**Proceed with Option A:** P0, then P1 and P3 in parallel, then P2, then P4.

Required amendments:

1. **P0:** the untracked Command-readiness files have no live callers. Discard or explicitly park them; do not integrate an uncalled settings-adjacent surface. Make a keep/discard decision for current dirty docs without polishing them before P4.
2. **P2 deletion is pre-authorized for three known contracts:** remove `workspace.projectRoots` from app-off and app-backed `exo status`, remove `EXO_PROJECT_ROOTS` from spawned Command environments, and remove persisted `projectRoots`. Do not retain empty-array compatibility fields.
3. **Known removed key:** `projectRoots` is exempt from P1 unknown-key preservation. Its normalization/migration must drop it while preserving every other unknown key, layout, command, indexing, and migration field; it must not trigger onboarding.
4. **Containment:** root-relative identities are not required to close EXO-ISSUE-103. Retain canonical-path authorization, expand behavioral proof, and record root-relative IDs as a bounded interface-quality follow-up. After P2, prove former Project Root paths fail closed.
5. **Migration observability:** stripping path references needs no recovery artifact because no file data is removed, but emit a one-time main-process normalization notice naming dropped paths. Do not add compatibility UI.
6. **P3:** likely/ambiguous attribution, dirty-buffer protection, and Shift+Enter-only invocation are sufficient for V1. Real-work dogfood is the remaining gate; typography/H1 polish must not block it.

-- Fable review received through Exo terminal | 2026-07-12

-- Codex | 2026-07-12
