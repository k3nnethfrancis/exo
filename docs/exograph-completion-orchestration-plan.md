# Exograph Completion Orchestration Plan

Last updated: 2026-07-08

status: Fable-reviewed orchestration plan. Required revisions have been incorporated into the delegated worker briefs in `docs/exograph-detailed-implementation-plans.md`.

This document turns the Exograph pivot into the full completion plan for `refactor/note-native-exo`.

## Completion Target

This branch is complete when Exo is a light, local Exograph:

- Markdown notes are canonical and editable.
- The active note exposes graph context: links, backlinks, tags, frontmatter/properties, and a neighborhood view.
- CLI search/read/status works without MCP and reports provider/index health clearly.
- Search providers remain swappable, with QMD as one provider and fallback search working.
- Users can configure `AgentCommand` handles such as `@claude` or `@fable`.
- A strict note mention can launch a configured command in a normal terminal after human confirmation.
- `exo spawn @handle "<task>"` launches the same command model from CLI task context.
- Invocation records persist under `.exo/invocations/`.
- Direct writes during invocation are observed, diffed, and attributed as `likely` or `ambiguous`.
- Dirty editor buffers are never clobbered.
- Old MCP, Routine, Plugin Manager setup, profile-apply, skill-install, and deep harness-manager product surfaces are removed after caller audit.
- Web viewer and command-server trust gaps are either hardened or explicitly scoped to trusted content.
- Tests and app QA prove the core graph/read/invocation/review loop.

## High-Level Sequence

### 0. Planning And Review Gate

Produce detailed plans for each work package before implementation.

Required outputs:

- This orchestration plan.
- One detailed plan per delegated work package.
- Fable review notes for each detailed plan or one combined review that explicitly addresses every delegated plan.
- Worker-brief amendments for any Fable-required sequencing, lifecycle, trust, or QA change.
- Updated `tasks.md` if a plan changes sequencing or scope.

No implementation fan-out starts until the detailed plans are complete and reviewed.

### 1. Deletion And Contract Cleanup

Purpose: stop old product surfaces from shaping the new build.

Scope:

- MCP agent lifecycle and setup copy.
- Routine UI/CLI/docs/code not needed by invocation records.
- Plugin Manager setup spine.
- Profile apply setup paths.
- Harness skill inventory/setup paths.
- Public-contract checks and installed-machine cleanup.
- BrowserPane/command-server trust audit.

Exit criteria:

- Old product surfaces are either removed or have a named current dependency and removal condition.
- CLI/app runtime routes that survive are explicitly justified.
- Public-contract checks match the intended surface.
- Tests fail only for intentionally removed behavior, then are updated or deleted with the removed product code.

### 2. Graph Core And Graph UI

Purpose: make Exograph true before agents are the headline.

Scope:

- Consolidate `GraphSnapshot`, note graph context, backlinks, and neighborhoods.
- Add graph properties read/edit affordance.
- Ensure renderer surfaces use snapshot-derived graph context rather than competing `NoteKnowledge` models.
- Keep graph/plugin type coupling from blocking deletion.

Exit criteria:

- Active note shows useful graph context.
- Graph/neighborhood view opens for the active note.
- Deterministic graph tests cover aliases, fragments, duplicate basenames, frontmatter properties, and neighborhoods.

### 3. CLI And Search Provider Hardening

Purpose: make CLI the durable local integration surface.

Scope:

- Provider-neutral search status.
- QMD behind the provider contract.
- Fallback provider when QMD is missing/degraded.
- CLI search/read/status behavior without MCP.
- Path canonicalization for provider results.

Exit criteria:

- CLI can orient an agent with workspace/status/search/read without MCP.
- Degraded QMD is visible and actionable.
- Fallback search has useful lexical recall.
- Search provider seams are test-covered.

### 4. AgentCommand And Invocation

Purpose: replace promptable harness identity with user-owned command identity.

Scope:

- `AgentCommand` model and settings.
- Workspace trust for command-bearing config stored outside the workspace.
- Trust invalidation when executable command fields change.
- Strict editor-owned mention parsing.
- Human confirmation UI.
- Generic configured-command terminal launch.
- `exo spawn @handle "<task>"`.
- Invocation records and lifecycle.

Exit criteria:

- One configured command can launch from a note mention and from CLI spawn.
- Changed command/cwd/prompt/env fields block launch until re-trusted.
- Invocation confirmation cannot be auto-triggered by agent-authored Markdown.
- The terminal/session is visible and monitorable.

### 5. Direct-Write Observation And Diff Attribution

Purpose: make agent file writes reviewable without proposal staging as the default.

Scope:

- Tagged-document pre-snapshot.
- Watcher-based observed changes during invocation window.
- Patch refs under `.exo/invocations/{id}/diffs/`.
- `likely` vs `ambiguous` attribution.
- Dirty-buffer preservation and refresh conflict UI.
- Diff/attribution banner and detail view.

Exit criteria:

- Fake command append produces invocation record, patch ref, and visible diff.
- Concurrent user edit marks attribution ambiguous.
- Dirty buffer is preserved.
- App restart during a run marks orphaned invocation honestly.

### 6. QA, Docs Closure, And Dogfooding Gate

Purpose: prove the new product loop end to end.

Scope:

- Focused unit/integration tests per package.
- Electron app QA for graph, AgentCommand, invocation, direct-write review, and dirty-buffer behavior.
- CLI QA for search/read/status/spawn.
- Docs closure: README, strategy, usability readiness, docs map, ledger.
- Dogfooding script for 10 real pointer-prompt invocations.

Exit criteria:

- `pnpm ci:check` or an explicitly justified equivalent gate passes.
- App QA evidence exists for the core loop.
- Docs no longer point workers back to the old product regime.
- Remaining follow-ups are tracked as V2/deferred, not hidden completion blockers.

## Delegated Planning Work

Each agent writes a detailed implementation plan for its slice. Agents do not implement. Agents do not contact Fable directly; they include a Fable review packet with risks, questions, options, and a recommendation. The orchestrator routes those packets through Fable and incorporates the review before implementation begins.

| Agent | Slice | Owns | Detailed Plan Output |
| --- | --- | --- | --- |
| Agent A | Deletion/contracts/trust audit | Old product removal, public contracts, BrowserPane/command-server trust | deletion and contract cleanup plan |
| Agent B | Graph core/UI | graph query, backlinks, properties, graph viewer, renderer data flow | graph implementation plan |
| Agent C | CLI/search providers | provider contract, QMD/fallback, CLI status/read/search, path canonicalization | CLI/search implementation plan |
| Agent D | AgentCommand/invocation | command model, workspace trust, mention parsing, launch, CLI spawn | AgentCommand implementation plan |
| Agent E | Direct-write review | observation, patch refs, attribution, dirty-buffer UI | diff attribution implementation plan |
| Agent F | QA/docs/dogfooding | test matrix, app QA, docs closure, dogfooding script | QA and release-readiness plan |

## Cross-Package Dependencies

- Deletion cannot remove harness internals until AgentCommand launch no longer depends on them.
- Graph deletion cleanup cannot remove plugin/capability types until graph/search are decoupled.
- CLI/search can proceed before note invocation, but AgentCommand prompt context depends on reliable read/status/search.
- Direct-write attribution depends on invocation records and watcher behavior.
- QA planning should start immediately and update as detailed plans return.
- BrowserPane/command-server hardening is not optional if web content becomes untrusted extension content.
- Command-server token auth for all routes is now a Wave 1 requirement.
- BrowserPane remains trusted-only local/localhost in V1, with cheap hardening; untrusted extension hosting is deferred.
- One owner must land the workspace watcher subscription API before graph cache invalidation and invocation observation fan out.
- Invocation lifecycle must include an explicit end mechanism for interactive sessions that do not exit.
- Note invocation confirmation must save or refuse a dirty tagged document before launch so the pointer prompt and pre-snapshot match disk.

## Fable Review Protocol

For each plan, Fable should be asked:

1. Is the plan coherent with `docs/exograph-refactor-completion-plan.md` and `docs/extension-architecture.md`?
2. Does it preserve the right invariants?
3. Does it delete aggressively enough without breaking current dependencies?
4. Are trust boundaries honest and enforceable?
5. Are public contracts changed only with explicit review?
6. Is the QA gate sufficient for the risk?

The orchestrator updates this document or the slice plan if Fable changes architecture or sequencing.

## Fable Review Outcome

Fable reviewed the delegated plans on 2026-07-08 and returned `revise before implementation`.

Those revisions are now incorporated into `docs/exograph-detailed-implementation-plans.md` as worker-brief amendments:

- define invocation-end semantics for interactive sessions;
- save or block dirty tagged documents before invocation launch;
- use `rootId + rootRelativePath` as canonical search result identity;
- assign one owner for workspace watcher subscription fan-out;
- record command-server token auth as a public-contract change;
- make AgentCommand env fields explicit in trust fingerprint rules;
- mechanically verify `.exo/invocations/` is gitignored.

Implementation fan-out can begin only from those amended briefs, not from the pre-review agent drafts.

## Implementation Rule

After all detailed plans are complete and reviewed, implementation should fan out only where write scopes are disjoint. Any worker that discovers a public contract change, trust-boundary change, deletion dependency conflict, or dirty-buffer/data-loss risk must stop and report options before continuing.

-- Exo | 2026-07-08
