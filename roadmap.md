# Exograph Roadmap

Last updated: 2026-07-08

Exograph is Exo's active product frame:

> Build your local exocortex from Markdown.

Exograph is a local-first Markdown exocortex with graph semantics, CLI/search/read surfaces, custom search/indexing providers, terminals, split panes, web viewers, and local LM wiki management tools. Notes remain the durable source of truth. `.exo/` stores derived indexes, invocation records, transcripts, artifacts, and review/provenance state.

The canonical refactor plan for the `refactor/note-native-exo` branch is `docs/exograph-refactor-completion-plan.md`. Future workers should start there before changing roadmap, tasks, instructions, command surfaces, or implementation files.

## Current Ship Path

The current objective is no longer to complete the old plugin/routine/harness roadmap. The branch is shipping the Exograph pivot:

1. Graph read path: Markdown link extraction, wikilinks, tags, frontmatter/properties, backlinks, graph context for the active note, and a basic graph/neighborhood viewer.
2. CLI and search/read hardening: reliable `workspace`, `read`, `search`, and provider-status surfaces that work without MCP, with QMD and fallback providers behind a provider-neutral contract.
3. Note-native AgentCommand invocation: strict Markdown mentions launch user-configured commands in plain terminals with pointer prompts.
4. Invocation records: command metadata, mention text, terminal transcript references, timestamps, and changed-file observations persist under `.exo/invocations/`.
5. Direct-write diff/attribution: Exograph detects file changes during an invocation, refreshes open notes without clobbering dirty editor buffers, and shows likely/ambiguous attribution with a toggleable diff view.

The product test is simple: Kenneth can write a Markdown note, inspect its graph context, search/read related context through CLI/provider-backed search, tag a configured agent command, watch it run in a plain terminal, and review what changed afterward.

## Active Work Packages

### WP0: Plan, Supersede, And Stop The Old Product

Status: active documentation/instruction rewrite.

- Rewrite top-level roadmap, tasks, README, and agent instructions around Exograph.
- Mark the old MCP, routine product, deep harness-manager, profile-apply expansion, provider skill install/sync, and Plugin Manager setup-spine paths as superseded or deletion-audit targets.
- Keep old planning docs available as history, but prevent them from looking like the current ship path.
- Add the root deletion-audit task so Phase 1 workers audit callers before removing surfaces.

### WP0.5: Prototype Evidence

- Run 10 real pointer-prompt invocations against representative notes.
- Count likely false positives for strict mention syntax in the vault.
- Run one concurrent-edit case: user edit plus agent direct write.
- Decide the prompt delivery mechanism for `AgentCommand`.
- Record findings in a short committed artifact.

### WP1: Heavy-Handed Deletion And Surface Removal

Remove after caller/public-contract audit:

- MCP as an active product surface, especially agent lifecycle tools and setup/install copy.
- Routine product UI/CLI/docs, keeping only reusable activity concepts where invocation records need them.
- Deep harness manager features: readiness/send queues, promptable harness selectors, and harness skill inventory setup surfaces.
- Profile apply expansion and profile-template write paths as onboarding/setup spine.
- Provider skill install/sync expansion.
- Plugin Manager setup spine, plugin review onboarding, and plugin/routine/profile setup copy.

Harden before treating web content as untrusted extension content:

- BrowserPane iframe sandbox/navigation policy.
- Command-server mutation-route auth/CSRF protection.

Keep or reuse:

- Plain terminal runtime and transcripts.
- Command server routes still consumed by the app or CLI.
- Search provider code and provider-neutral seams.
- Changed-file/diff rendering that can support direct-write review.
- Plugin registry internals only where graph/search/provider boot still needs them until decoupled.

### WP2: Graph Read Path

- Reuse and consolidate `packages/core/src/graph.ts`, `packages/core/src/graph-snapshot.ts`, and existing editor graph affordances.
- Extract deterministic graph facts from Markdown links, wikilinks, tags, frontmatter/properties, headings where useful, unresolved links, and external links.
- Add backlink query support and a note graph context surface.
- Add graph properties read/edit affordance for a note.
- Add a basic graph/neighborhood viewer.
- Expose useful CLI graph/read/search status where appropriate.

### WP3: CLI And Search Provider Hardening

- Keep CLI as the durable local integration surface.
- Preserve custom search/indexing provider seams.
- Keep QMD as one provider behind the contract.
- Ensure fallback search/read works when QMD is unavailable.
- Make status output distinguish app/runtime state, provider state, index health, and degraded fallback mode.
- Later, add note result hydration: search providers return relevance/snippets/chunks, then Exo enriches each result with note metadata and graph context so agents get the note plus enough context for the next search/read decision in one response.

### WP4: Agent Commands

- Add a user-owned `AgentCommand` model: id, label, handle, command, cwd policy, prompt delivery, enabled state, and invocation metadata.
- Detect strict Markdown mentions in the editor.
- Confirm before launch.
- Launch through the plain terminal runtime with a pointer prompt that names the document path and mention text.
- Add CLI spawn over the same command model: `exo spawn @handle "<task>"` starts the configured command with CLI task context instead of note pointer context.
- Require workspace trust for command-bearing config; changing executable command fields invalidates trust.
- Require a human confirmation gesture before any note mention launches.
- Persist invocation records under `.exo/invocations/`.

### WP5: Direct-Write Review

- Observe changed files during invocation windows.
- Attribute changes as `likely` or `ambiguous`, not line-perfect authorship.
- Refresh open notes safely without overwriting dirty buffers.
- Reuse or adapt existing changed-file/diff surfaces for invocation review.
- Show a diff/attribution banner and detail view.

## Superseded Or Deletion-Audit Targets

These systems have real implementation history, but they are not the current ship path:

- MCP search/read/status: superseded as an active product surface and targeted for audit/removal or later thin adapter status; CLI is the active local integration surface.
- MCP agent lifecycle: deletion-audit target.
- Routine product: superseded; invocation records are the first activity record.
- Deep harness manager: superseded; user-owned `AgentCommand` replaces promptable harness identity for V1.
- Profile apply expansion: superseded; keep inspection/recovery history only where current callers require it, and stop expanding apply as setup.
- Provider skill install/sync: superseded; do not expand skill inventory/setup as a product spine.
- Plugin Manager setup spine: removed from the active product; keep only named internals that graph/search/provider boot still uses until they are decoupled.
- External plugin/routine/harness contract expansion: deferred unless the Exograph completion plan explicitly reopens a slice.

## Historical Ledger

The previous roadmap produced important substrate: tmux-backed terminal reliability, hidden-window runtime behavior, QMD-backed search, provider-neutral search contracts, plugin metadata and permissions work, proposal/review substrate, semantic trace capture, routine CLI experiments, profile apply recovery, MCP integration, and changed-file review surfaces.

That work is not erased. It is ledger history and reuse inventory. The active branch now uses it selectively to ship Exograph rather than continuing the agent-cockpit/plugin-platform buildout.

## Product North Star

Exograph should be the local workspace where a person builds and maintains a Markdown exocortex with agents as addressable local commands, not opaque remote actors. The core loop is:

- write Markdown;
- see graph context;
- search and read local context through reliable providers;
- invoke configured commands from notes;
- let commands edit files directly when appropriate;
- review exactly what changed and why Exograph thinks it belongs to an invocation.

Longer-term graph, ontology, eval, training, workflow, and plugin ideas remain possible only after the graph/read/invocation/review loop is stable.
