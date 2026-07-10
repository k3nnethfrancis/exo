# Exograph Pivot Roadmap Rewrite Notes

Last updated: 2026-07-08

status: planning. Use this as the rewrite guide for `roadmap.md` and `tasks.md` after the note-native invocation pivot is accepted.

## Rewrite Goal

The current roadmap is still plugin/routine/harness-first. After the pivot, the roadmap should be exocortex-first:

> Exograph — build your local exocortex from Markdown.

Near-term work should make the Markdown exograph, search/read substrate, CLI, and note-native invocation coherent before returning to broader platform features:

1. gather prototype evidence;
2. settle planning docs;
3. delete old agent-cockpit surfaces aggressively enough that the branch dogfoods the new product shape;
4. build the graph read path that makes "Exograph" true: backlinks, properties, and a basic graph view;
5. build the mention-to-command tracer bullet;
6. add observed-change attribution and diff review;
7. preserve CLI, custom search providers, and graph/LM-wiki direction;
8. recover deleted code only when the new product proves it needs it.

## Sections To Remove Or Archive

Move these out of the active ship path:

- Plugin Architecture Completion as the primary gate;
- first-class Routine substrate POC;
- plugin-owned routine templates as a near-term goal;
- skill install and harness skill inventory as near-term setup;
- external plugin contract stabilization beyond what current shipped code needs;
- profile apply expansion beyond current safe inspection/proposal status;
- multi-agent cockpit/agent roster as the active coordination story.
- MCP as an active product surface; keep CLI as the local integration story.

Do not delete history from `ledger.md`. This is about active roadmap priority, not pretending prior work did not happen.

## Sections To Reframe

### Phase A

Old: Plugin Architecture Completion.

New: Note-Native Invocation.

Scope:

- product definition accepted;
- backlink index and panel;
- graph properties surface;
- basic graph/neighborhood viewer;
- agent identity reconciled;
- invocation context/safety rules accepted;
- output convention prototype run;
- `AgentCommand` settings model;
- editor-owned mention detection;
- command launch through plain terminal;
- invocation record;
- observed changes and diff banner.

### Phase B

Daily-use bug bash remains. It now serves the note-native product rather than plugin readiness.

Keep:

- editor save/refresh correctness;
- terminal quality;
- search reliability;
- settings clarity;
- hidden-window resident runtime.

### Phase C

Old: CLI/MCP multi-agent coordination.

New: CLI-first exocortex integration.

MCP tools are removed from the active roadmap. CLI, search/read, workspace-status, and custom search-provider seams become more important because invoked agents and LM wiki workflows need a durable local interface.

### Phase D

Old: Routine substrate POC.

New: Delete/defer. Invocation records are the first activity record. Generic routines wait until repeated note invocation use proves the required substrate.

### Phase E

Installable stable runtime remains.

### Phase F

Graph/exograph workbench remains core, not decorative. Ontology enforcement is deferred until note invocation and direct-write review work, but user-defined LM wiki profiles, graph semantics, custom search providers, and graph views stay in the roadmap.

## New Current Tasks

The top of `tasks.md` should become:

- [ ] Run prototype evidence: 10 real pointer-prompt invocations, false-positive mention search, one concurrent edit case.
- [ ] Accept or revise `docs/pivot-product-definition.md`.
- [ ] Accept or revise `docs/pivot-subsystem-disposition.md`.
- [ ] Accept or revise `docs/agent-identity-reconciliation.md`.
- [ ] Accept or revise `docs/invocation-context-and-safety.md`.
- [ ] Accept or revise `docs/invocation-concurrency-and-attribution.md`.
- [ ] Accept or revise `docs/agent-output-conventions.md`.
- [ ] Implement graph read-path foundation: link extraction, backlink index, and graph properties read surface.
- [ ] Implement first graph/neighborhood viewer.
- [ ] Implement tracer bullet: one hand-configured `AgentCommand`, editor-owned mention, confirm, terminal launch.
- [ ] Implement invocation record persistence under `.exo/invocations/`.
- [ ] Implement observed file changes and patch refs.
- [ ] Implement diff/attribution banner.
- [ ] Preserve CLI/search-provider/graph roadmap items as core exocortex work, not plugin-platform leftovers.
- [ ] Delete MCP agent lifecycle surfaces and docs after caller/public-contract audit.

## Defer Notes For Current Tasks

Mark these explicitly deferred or deletion-audit in `tasks.md`:

- harness readiness/send queue expansion;
- Routine product expansion;
- Plugin Manager expansion beyond diagnostics;
- skill install/sync expansion;
- profile apply expansion;
- all MCP surfaces pending deletion/audit.

Mark CLI explicitly active.

## Validation Before Code

Do not start invocation implementation until:

- agent identity doc is accepted;
- context/safety doc is accepted;
- output convention prototype has at least one real command example;
- concurrency/attribution doc is accepted enough to shape the diff banner.

-- Exo | 2026-07-08
