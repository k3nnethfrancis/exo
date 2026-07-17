# Graph product checkpoint

Date: 2026-07-17

## What we built

In plain English, we proved that Exo can turn a large Markdown workspace into a
fast, fluid spatial graph rather than a slow diagram. The graph has a stable
layout, real three-dimensional camera movement, focal labels, selection,
neighbor and path highlighting, WebGPU rendering, a Canvas fallback, and
desktop/mobile gestures. It stops doing work when the scene settles. GraphBench
separates rendering speed, layout quality, interaction quality, and knowledge
usefulness so a beautiful fast graph cannot pass by hiding a bad structure.

The latest benchmark work made those claims concrete. It runs the same fixed
workload through Exo and Sigma, includes a real SuiteSparse topology, verifies
that a 1% update to a 10,000-node graph preserves the old mental map, recovers
from an injected WebGPU failure to Canvas in about 22 ms with selection and
layout intact, and verifies that the settled renderer schedules zero frames. A
task-grounded usefulness harness now exists too, although its real public
knowledge corpus is still unfinished.

We also built the production foundation beneath the pixels. Markdown remains
canonical. The graph preserves open Concept types, lossless Properties, typed
Relations, authored/declared/derived authority, resolution state, and Evidence.
Generic Markdown works without configuration; OKF 0.1 is the first optional
interoperability profile. A renderer-neutral projection keeps ontology and file
objects out of hot GPU/draw paths.

## What this proves

- Large graphs can feel immediate on ordinary hardware.
- WebGPU can own pixels without owning graph meaning or interaction.
- The same graph can support authored links, properties, semantic overlays, and
  future model-space projections without confusing them as equally canonical.
- Speed, readable layout, and useful knowledge retrieval are separate things
  and need separate tests.

## What is still unfinished

1. Finish the public GraphBench publication matrix, cross-renderer GPU timing,
   pixel parity, browser-delivered device-loss, and multi-hardware evidence.
2. Freeze the OKF/OpenWiki fixtures and the integrity, retrieval, traversal, and
   corruption task corpus for GraphUtilityBench.
3. Finish the compact typed topology transport, stable persisted layout epochs,
   clean branch replay, and existing Exo latency regressions.
4. Integrate the real Stellar renderer into packaged Exo with accessibility,
   Canvas/device-loss fallback, idle quiescence, continuity, and editor latency
   under graph load.
5. Run the bounded embeddings-index projection after those graph contracts
   settle, using only a supported provider export seam.
6. Ship and evaluate the first reviewable graph-maintenance Skill only after the
   graph can show trustworthy evidence for its proposals.

## Interaction and product work we have not finished

Node size is only partially addressed. The GraphBench version now has separate
comparison, exploration, and image-capture presentation profiles. Exploration
and capture increase node radius with semantic zoom while the normalized
comparison profile deliberately keeps every node at four pixels. That is the
right technical separation, but the public preview and integrated Exo tracer do
not yet share it, and the real graph still looks too faint at useful overview
distances. We have not accepted legibility targets at overview, middle, and
focus distances against the real graph.

The integrated Canvas tracer now uses a normalized, higher-gain wheel rule and
supports line-mode wheel deltas; its node floor/radius is also larger at normal
zoom. Stellar still needs to consume the same rule, and both surfaces need a
real-trackpad/touch measurement of gestures and time from overview to one Note
and back.

The intended navigation contract is:

- click/tap a node: select it;
- double-click: open its Note;
- double-click a node whose Note is already open: immediately frame and zoom to
  that node;
- empty-space double-click: do nothing surprising;
- frame the full graph through an explicit control or shortcut;
- click the Graph icon beside editor Properties: open the graph focused on the
  current Note.

## Connections and Properties direction

The current Connections rail is transitional and its information architecture
is wrong. Outline should contain only document headings. Links should contain
backlinks, outgoing Note links, and external links in clear groups. Graph should
be a real local neighborhood for the selected Note, with an action to expand to
the full graph. Activity should be hidden until Exo has a meaningful
invocation/change/provenance stream to show.

The local graph may be two-dimensional, but only if it consumes the same
Knowledge Graph projection, Relation semantics, and selected Concept as the
full spatial graph. That makes it a small view of one system rather than another
graph implementation to maintain.

Keep both property surfaces for now. Editor Properties edits canonical Markdown
frontmatter. Connections/graph Properties explains the currently inspected
Concept: its interpreted type, Relations, Evidence, profile findings, and which
properties affect graph color, size, grouping, filtering, or physics. Editor,
Connections, local graph, and full graph must share one explicit inspected
Concept so changing Pane focus cannot produce unrelated “No properties” states.

The executable backlog is tracked in `issues.md#exo-issue-121-graph-navigation-and-connections-do-not-yet-form-one-system`.

## Implemented in the first integration slice

- The editor Properties chrome now exposes a Graph action that opens the full
  graph focused on the active Note.
- Canvas graph double-click no longer resets the camera on empty space; an
  already-open Note double-clicks into a focused zoom, while another Note opens
  normally.
- Connections Outline is headings-only; Links owns backlinks, internal links,
  external links, and tags; Graph now shows a compact connected neighborhood
  using the same local relation contract.
