# Exograph Completion Master Plan

Last updated: 2026-07-09

status: Fable-reviewed orchestration plan. This file is the lead-agent map for completing `refactor/note-native-exo`; detailed slice plans live under `docs/agent-plans/` and include slice-specific Fable amendments.

## Goal

Complete the Exograph pivot:

> Exograph builds your local exocortex from Markdown.

The product center is Markdown notes plus terminal panes in a composable local workspace. Graph context, CLI search/read/status, configurable search providers, AgentCommands, direct-write observation, and diff review make that workspace shared with agents without turning Exo into a universal agent cockpit.

## Completion Definition

This branch is complete when:

1. Current docs, tasks, roadmap, and agent instructions describe Exograph rather than the old plugin/routine/harness product regime.
2. MCP, Routine, Plugin Manager setup spine, profile apply setup paths, harness skill inventory, and deep harness-manager product surfaces are removed after caller audit.
3. Plugin architecture is reduced to the V1 boundary: no user-facing Plugin Manager product spine, no manifest marketplace, no routine/profile/harness plugins; the only active typed extension seam is search/index providers.
4. Markdown graph context works: outgoing links, backlinks, tags, properties/frontmatter, active-note context, and a basic graph/neighborhood view.
5. CLI `status`, `search`, `read`, and `spawn` are reliable without MCP.
6. Search providers remain swappable: QMD is one provider, filesystem fallback is real, and provider results use Exo-owned document identity.
7. AgentCommands are user-owned configured commands with local trust, strict mention parsing, human confirmation, generic terminal launch, monitor visibility, and CLI `exo spawn @handle`.
8. Invocation records persist under `.exo/invocations/`, with transcript refs and lifecycle states.
9. Direct writes during invocations are observed, diffed, attributed as likely or ambiguous, and shown in a toggleable review surface.
10. Dirty editor buffers are never clobbered.
11. BrowserPane and command-server trust boundaries are honest and test-covered for V1.
12. QA includes automated package gates, Electron app flows, CLI flows, and 10 real pointer-prompt dogfooding invocations against representative note shapes.

## High-Level Work Plan

### Phase 0: Freeze The New Map

Lock the product frame and planning docs before more implementation:

- keep `docs/exograph-refactor-completion-plan.md` as the canonical execution plan;
- keep this file as the orchestrator map;
- collect one detailed delegated plan per work package under `docs/agent-plans/`;
- route the combined plan through Fable;
- incorporate Fable changes into this file, the detailed plans, and `tasks.md`.

Implementation does not fan out from stale plugin/routine/harness docs.

### Phase 1: Delete Old Product Gravity

Remove, not hide, product paths that would keep dragging the branch back to the previous regime:

- delete MCP package/setup/contract paths after CLI parity and manual deregistration docs;
- delete Routine product code, CLI, UI, templates, tests, and docs that are not needed by invocation records;
- delete Plugin Manager as a setup/product surface;
- delete profile apply setup paths unless a specific current dependency remains;
- delete Agent Config skill inventory and provider-specific harness setup UI;
- remove public-contract checks for deleted surfaces and add checks for surviving command-server/CLI surfaces;
- retain only boring internals that are still required for current boot/search/provider operation, and name the removal condition for each survivor.

### Phase 2: Make The Graph Real

Make Exograph true before agent features become the headline:

- consolidate on snapshot-derived graph context;
- expose outgoing links, backlinks, tags, properties, unresolved/external refs, and neighborhoods;
- add or finish property edit affordances;
- ensure the renderer no longer depends on a competing `NoteKnowledge` model if graph context has replaced it;
- keep later document hydration in the notes: provider search returns snippets and ranks, Exo hydrates notes with metadata and graph context.

### Phase 3: Harden CLI And Search Providers

Make CLI the durable integration surface:

- ensure `exo status`, `exo search`, and `exo read` work without MCP;
- keep QMD behind a provider-neutral contract;
- keep filesystem fallback useful and visible;
- use canonical identity `rootId + rootRelativePath`;
- expose provider/index health without making provider internals the graph ontology;
- leave custom provider extension as the V1 typed seam.

### Phase 4: Finish AgentCommand Invocation

Replace harness identity with user-owned command identity:

- configure handles such as `@claude` or `@fable`;
- require local trust for executable command config;
- invalidate trust when command, cwd, prompt delivery, or future executable fields change;
- parse strict editor-owned mentions only;
- save or refuse dirty tagged documents before launch;
- confirm every launch with a human gesture;
- launch a plain terminal and send a pointer prompt after launch;
- support CLI `exo spawn @handle "<task>"` through the same command model;
- record invocation context, lifecycle, transcript refs, and end semantics.

### Phase 5: Finish Direct-Write Review

Make direct writes understandable without proposal staging:

- snapshot the tagged document before launch;
- observe workspace changes during the invocation window;
- write patch refs under `.exo/invocations/{id}/diffs/`;
- mark changed files likely only when the evidence is clean;
- mark overlapping, dirty-buffer, out-of-scope, unreadable, restarted, or concurrent changes ambiguous;
- refresh clean open docs and preserve dirty buffers with explicit conflict choices;
- show a diff/attribution banner and detail view.

### Phase 6: Close QA, Docs, And Dogfooding

Finish with evidence, not vibes:

- run package typecheck/test/build gates;
- run focused Electron app flows for graph, AgentCommand, invocation, diff review, dirty-buffer preservation, BrowserPane, and command-server token behavior;
- run CLI QA for status/search/read/spawn with and without the app;
- run 10 real pointer-prompt dogfooding invocations in a copied representative workspace;
- update README, strategy, usability readiness, docs map, tasks, issues, and changelog;
- record any remaining work as explicit V2 follow-up rather than hidden V1 completion debt.

## Add / Delete / Modify Summary

### Add

- `AgentCommand` command identity, trust, and templates-as-config.
- CLI `exo spawn @handle`.
- Invocation records and diff refs.
- Direct-write attribution banner and detail view.
- Graph context and neighborhood view as first-class app surfaces.
- Provider-neutral search service with real fallback.
- Command-server token coverage and BrowserPane trusted-target hardening.
- Dogfooding evidence for real pointer-prompt use.

### Delete

- MCP as active product surface.
- Routine product.
- Plugin Manager product/setup surface.
- Profile apply setup/product paths unless a named current dependency remains.
- Harness skill inventory/product setup.
- Old skills/docs that instruct agents to build the superseded regime.
- Plugin/capability internals after graph/search/provider boot no longer need them.

### Modify

- README, roadmap, tasks, AGENTS/CLAUDE instructions, strategy, usability readiness, and docs index.
- CLI public contract and command-server public-contract guard.
- Search provider metadata and canonical result identity.
- Renderer graph data flow.
- Terminal launch path for generic configured commands.
- Editor refresh behavior for invocation-time writes.

## Delegated Planning

Each planning agent writes one detailed plan under `docs/agent-plans/`. Agents do not implement and do not contact Fable directly; they write a Fable review packet. The orchestrator consolidates those packets and routes Fable review.

| Agent | Plan File | Owns |
| --- | --- | --- |
| A | `docs/agent-plans/A-deletion-contracts-trust.md` | deletion, surviving contracts, command-server/BrowserPane trust, plugin-manager cleanup |
| B | `docs/agent-plans/B-graph-core-ui.md` | graph model, graph UI, properties, neighborhood, graph/document metadata notes |
| C | `docs/agent-plans/C-cli-search-providers.md` | CLI status/read/search, QMD/fallback, provider seam, canonical document identity |
| D | `docs/agent-plans/D-agent-command-invocation.md` | AgentCommand config, trust, mention parsing, terminal launch, CLI spawn, lifecycle |
| E | `docs/agent-plans/E-direct-write-diff-attribution.md` | observation, patch refs, attribution, dirty-buffer conflict, diff UI |
| F | `docs/agent-plans/F-qa-docs-dogfooding.md` | validation matrix, docs closure, 10 real pointer-prompt runs, completion gate |

## Fable Review Gate

Fable reviewed the master plan and the six delegated plans on 2026-07-09 through a headless fallback after the Exo-managed Fable session became unreadable through `exo agents read`.

The Exo session did acknowledge the request, but the readable Exo transcript stalled at "Still waiting on the deep-read fork"; direct tmux capture also failed. This is product signal for the Exo agent-monitor/read surface and should be tracked separately before relying on Exo-managed agent sessions as the only orchestration channel.

### Fable Decisions

1. **Plugin Manager:** delete active UI/model/CSS/tests and mutable lifecycle APIs now. Do not retain a read-only diagnostic surface; diagnostics should move to provider-neutral search/profile status.
2. **Plugin internals:** aggressively delete plugin/capability internals after graph/search/profile callers are decoupled. Git history is the V2 scaffold.
3. **Profile apply/recovery:** first audit whether real recovery manifests exist. If none exist, delete profile recovery now. If manifests exist, keep `profile-recovery` as operator-only safety until the 10-run pointer-prompt gate passes; delete setup/product copy either way.
4. **AgentCommand trust gesture:** persistent trust must not be established by a single launch-confirmation click. Acceptable V1 shape: one-shot launch can happen from confirmation, and persistent trust can be co-located in that dialog only as a distinct, default-off trust act showing the exact command fingerprint.
5. **Trust storage:** command trust must move out of workspace `.exo` into app-local state keyed by workspace root and command fingerprint. Discard existing workspace-local trust files; do not import them.
6. **CLI/search:** approve `rootId + rootRelativePath` canonical document identity, provider-neutral additive fields, QMD as one provider, search-service-owned filesystem fallback, and later Exo-owned document hydration. Resolve symlinks for identity and preserve display paths separately.
7. **Direct-write review:** approve tagged-document-only pre-snapshot, out-of-scope paths as ambiguous refs without diffs, orphan-on-restart always ambiguous, and `Changed during @handle` copy with likely/ambiguous badges. Make autosave suspension during conflicts a tested invariant. Use an injectable settle/grace period with a tested default around 2 seconds.
8. **Dogfooding:** 10 real pointer-prompt invocations remain a hard branch-completion gate in a copied scratch workspace. All ten must use the real Exo invocation path. At least one must be a live interactive Claude/Fable-style harness run that demonstrates it can locate/read the pointed document; the rest may be bounded local commands.
9. **Public contracts:** `exo spawn @handle` needs a final `docs/public-contract-reviews.md` entry after the final request/response/error shape settles.
10. **BrowserPane/command-server:** trusted-only local/localhost BrowserPane plus iframe sandbox and all-route token auth is enough for V1. Add cheap verification that the token never appears in URLs/logs/iframe-reachable context and keep sandbox without `allow-same-origin`.

### Settled Unknowns

- Graph ids may remain `note:${absolutePath}` for this branch. Search/read document identity is `rootId + rootRelativePath`. Convergence is a V2 follow-up.
- Command-server routes, CLI, and `command-protocol.ts` are public contracts. Renderer/main preload IPC is app-internal.
- CLI spawn invocations are lifecycle records only in V1. Direct-write observation is note-context only because it needs a tagged document anchor.
- `stdin` and `argv` prompt-delivery modes are rejected at settings normalization in V1, not persisted as unusable modes.
- Invocation retention/privacy is deferred to V2 but must be documented.

### Sequencing Changes

- Agent B graph renderer migration owns `useOpenDocuments.ts` and `NoteEditor.tsx` first. Agent E dirty-conflict/autosave work must land after B or be assigned to the same implementation worker. Do not run those renderer edits in parallel.
- Agent D must resolve trust gesture/storage before confirmation UI, trust store, and `exo spawn` response work continues.
- Agent A can start early deletion of Plugin Manager model/tests/CSS and stale preview tests, but broad capability/inventory deletion waits until B/C confirm imports are gone.

### Added Stop Conditions

- Full graph snapshot rebuild above roughly 1.5-2 seconds on the real vault or a 5k-note synthetic fixture stops implementation for an incremental design.
- Any trust record readable, writable, or importable from workspace-controlled files stops implementation.
- Any autosave/save path that writes an editor buffer while a dirty-buffer invocation conflict is active stops implementation.
- Command-server token appearing in a URL, query string, log, or BrowserPane-reachable context stops implementation.
- Any single gesture that both launches and persists trust without a distinct explicit trust act stops implementation.

Fable's conclusion: after incorporating these amendments, the planning set is sufficient to fan out implementation. Agent D requires the most material revision because trust gesture/storage changes affect confirmation UX, trust persistence, and `exo spawn` error shape.

## Original Review Criteria

Fable was asked to review the consolidated plan for:

- whether the deletion posture is heavy enough;
- whether plugin architecture is correctly reduced for V1 without destroying the search-provider seam;
- whether CLI/search contracts are stable enough for local agents;
- whether AgentCommand trust and invocation confirmation prevent self-triggering or untrusted command launch;
- whether direct-write attribution avoids overclaiming authorship;
- whether BrowserPane and command-server trust boundaries are honest;
- whether the QA/dogfooding gate is sufficient.

Implementation fan-out starts only after Fable feedback is incorporated.

## Stop Conditions

Pause implementation and escalate if any plan requires:

- unreviewed public CLI, command-server, or shared protocol changes;
- executable plugin loading or user-facing permission claims that are not enforced;
- auto-running agent-authored Markdown;
- launching untrusted command config;
- clobbering dirty buffers;
- treating BrowserPane as a general untrusted extension host;
- keeping a deleted product surface alive without a named V1 dependency;
- claiming line-perfect authorship from time-correlated writes.

-- Exo | 2026-07-09
