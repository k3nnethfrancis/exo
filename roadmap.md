# Exograph Roadmap

Last updated: 2026-07-10

Exograph is Exo's active product frame:

> Build your local exocortex from Markdown.

Exograph is a local-first Markdown exocortex. Its launch formula is:

> **Local Markdown exocortex + modular, tunable search + inline agent invocation + graph management skills.**

Notes remain the durable source of truth. `.exo/` stores only derived indexes, invocation records, artifacts, and review/provenance state.

The canonical plan for the `refactor/note-native-exo` branch is `docs/exograph-simplification-plan.md`. Future workers should start there before changing roadmap, tasks, instructions, command surfaces, or implementation files.

## Current Ship Path

The current objective is no longer to complete the old plugin/routine/harness roadmap. The branch is shipping four launch primitives:

1. **Markdown workspace:** trustworthy files, authoring, properties, roots, canvas, and packaging.
2. **Modular Search:** reliable filesystem and QMD retrieval behind the one earned provider seam.
3. **Actionable graph:** links, backlinks, tags, properties, neighborhoods, and Connections today; Folder Index/Overview and explained relevant-context discovery are next-slice work.
4. **Inline invocation:** configured Commands run only on explicit invocation; Exo observes and reviews changes. The first user-editable graph-management Skill is next-slice work.

The product test is simple: a person can open an existing Markdown folder, resume thought, find context, understand the connection, explicitly invoke a configured Command, and review observed Markdown changes without surrendering file ownership. A bounded graph-management Skill is the next vertical slice.

## Shipped Core Loop: Inline Command Invocation

Inline invocation is not a future bet. Typing `@` in the Markdown editor offers configured Commands; selecting one opens a transient multiline composer. Only Shift+Enter, after explicit confirmation, launches the configured local Command in the visible terminal, writes an invocation record, and presents observed changes for review. The CLI can start the same configured Command with `exo spawn`.

The remaining work is quality rather than a second system: make the inline affordance easier to notice, keep mention parsing precise, prove dirty-document/save and trust behavior, and ship the first user-editable **Find and connect relevant context** skill through this loop. Do not reintroduce a harness manager or Skill Manager to achieve that.

Folder ontology is intentionally simple: folders provide a primary structural home; tags and typed relationships express additional membership. The optional `index.md` and Folder Overview design is accepted but not yet implemented, so it must not be described as current behavior.

## Active Work Packages

### WP0: Plan, Supersede, And Stop The Old Product

Status: active documentation/instruction rewrite.

- Rewrite top-level roadmap, tasks, README, and agent instructions around Exograph.
- Mark retired setup and runtime architecture as superseded or deletion-audit targets.
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

- Routine product UI/CLI/docs, keeping only reusable activity concepts where invocation records need them.
- Profile apply expansion and profile-template write paths as onboarding/setup spine.
- Provider skill install/sync expansion.

Harden before treating web content as untrusted extension content:

- BrowserPane iframe sandbox/navigation policy.
- Command-server mutation-route auth/CSRF protection.

Keep or reuse:

- Plain direct-PTY terminal runtime and bounded in-memory replay/read tails.
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
- After the active simplification/deletion/UI cleanup owners stabilize Explorer, Canvas, Files, and Graph, add Folder identity, path-derived containment, and Folder Overview support without resetting their work.
- Expose useful CLI graph/read/search status where appropriate.

### WP3: CLI And Search Provider Hardening

- Keep CLI as the durable local integration surface.
- Preserve custom search/indexing provider seams.
- Keep QMD as one provider behind the contract.
- Ensure fallback search/read works when QMD is unavailable.
- Make status output distinguish app/runtime state, provider state, index health, and degraded fallback mode.
- Later, add note result hydration: search providers return relevance/snippets/chunks, then Exo enriches each result with note metadata and graph context so agents get the note plus enough context for the next search/read decision in one response.

### WP4: Invocation Quality and First Skill

- Make valid mention invocation visibly inline and keyboard-reachable without turning any Markdown text into an auto-run trigger.
- Keep the existing user-owned `AgentCommand` model, explicit confirmation, visible terminal launch, local trust, `exo spawn`, and `.exo/invocations/` record as the one execution path.
- Close the remaining save/trust/dirty-document acceptance evidence.
- Ship **Find and connect relevant context** as the first provider-neutral, editable skill delivered through a configured Command and reviewed Markdown changes.

### WP5: Direct-Write Review

- Observe changed files during invocation windows.
- Attribute changes as `likely` or `ambiguous`, not line-perfect authorship.
- Refresh open notes safely without overwriting dirty buffers.
- Reuse or adapt existing changed-file/diff surfaces for invocation review.
- Show a diff/attribution banner and detail view.

## Superseded Or Deletion-Audit Targets

These systems have real implementation history, but they are not the current ship path:

- Routine product: superseded; invocation records are the first activity record.
- Profile apply expansion: superseded; keep inspection/recovery history only where current callers require it, and stop expanding apply as setup.
- Provider skill install/sync: superseded; do not expand skill inventory/setup as a product spine.
- External plugin/routine/harness contract expansion: deferred unless the Exograph completion plan explicitly reopens a slice.

## Historical Ledger

The previous roadmap produced important substrate: direct terminal reliability, hidden-window runtime behavior, QMD-backed search, provider-neutral search contracts, proposal/review substrate, routine CLI experiments, profile recovery, and changed-file review surfaces.

That work is not erased. It is ledger history and reuse inventory. The active branch now uses it selectively to ship Exograph rather than continuing the agent-cockpit/plugin-platform buildout.

## Product North Star

Exograph should be the local workspace where a person builds and maintains a Markdown exocortex with agents as addressable local commands, not opaque remote actors. The launch loop is:

- capture or resume thought in Markdown;
- retrieve through modular Search;
- understand links, tags, properties, and graph context;
- explicitly invoke a configured Command and review its observed changes;
- add a bounded, editable graph-management Skill only after the next-slice gate.

## Long-Term Ashby Ladder

The launch primitives are also the substrate for later research, but later systems must not delay or distort V1:

1. **More graph-management Skills:** connection proposals, property extraction, consolidation, inbox organization, and neighborhood audits, each evaluated and reviewable after the first Skill earns the pattern.
   Skills receive the nearest Folder Index chain as editable user-owned organization context; they do not depend on an Exo-owned ontology registry.
2. **Ashby Gym:** frozen tasks, contexts, candidates, rubrics, rollouts, and comparison artifacts. The Gym evaluates prompting, Principal, retrieval, skills, SFT, preference learning, RL, and Search candidates without assuming weights must change.
3. **Learning recipes:** separate SFT, preference, RL, embedding, and reranker workflows that consume approved evidence and emit lineage-bearing candidates.
4. **Executors:** local and cloud compute targets remain independent from learning methods; Prime RL, Tinker, Hugging Face Jobs, MLX, or later backends start as Commands/packages.
5. **External Markdown sources:** Discord, RSS, social, or messenger material may eventually be materialized into scoped source-faithful Markdown inside an explicit Note Root. A native Feed is deferred.
6. **Additional index providers:** local or cloud indexing is allowed only after a second concrete implementation, explicit upload/privacy/deletion semantics, and measurable retrieval value earn the seam.
7. **Learning Factory:** only after real recipes and executors expose stable shared behavior. It remains outside Exo core and cannot activate a candidate or expand authority.
8. **Plugin packaging:** only after a proven combination of Skills, ontology templates, Commands, evals, or external integrations needs repeatable installation, versioning, updates, and sharing. Plugin is the distribution bundle, not a new internal architecture.

This is loose modularity through Markdown, config, Commands, packages, and artifacts—not a reason to restore a general plugin platform. Method, executor, evaluator, index provider, and artifact adapter are independent dimensions; do not create a Cartesian collection of “local-SFT,” “cloud-SFT,” “local-RL,” and “cloud-RL” plugins. Package stable combinations only when distribution becomes the problem.

## Deferred Architecture Skill Suite

Rebuild a small Exo architecture-skill suite only after the live Search, Graph, Command/Invocation, Workspace Canvas, and review boundaries settle through dogfooding. Ground each skill in current modules, tests, and failure evidence; keep Guardian training as a separate workflow unless Exo gains a proven integration boundary. Until then, use `AGENTS.md`, the simplification plan, focused runtime/UI skills, and the legacy-extension guardrail rather than inventing speculative Search, Graph, Trainer, or UI plugin contracts.
