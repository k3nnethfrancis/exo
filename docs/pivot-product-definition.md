# Exograph Pivot Product Definition

Last updated: 2026-07-08

status: planning. This is the product definition for the note-native invocation pivot. It supersedes roadmap language only after the pivot is accepted and `roadmap.md` / `tasks.md` are rewritten.

## Product

Exograph is the product frame for Exo:

> Build your local exocortex from Markdown.

Exo is a Markdown-first exograph workspace, CLI, search/read surface, and graph substrate for building personal LM wikis. The pivot intentionally favors a small local CLI over multiple agent-control surfaces. The pivot adds a simpler rule for agents:

> Notes invoke configured agent commands; Exo records what changed.

The note-native agent loop:

1. A user writes in a Markdown document.
2. The user tags a configured agent with a strict mention such as `@claude look into this`.
3. Exo asks for confirmation.
4. Exo launches the user's configured command in a plain terminal with a pointer prompt naming the document path and mention text.
5. The agent opens the document, uses normal local context, and edits files directly.
6. Exo refreshes changed documents and shows a toggleable diff/attribution view for changes observed during the invocation.

## What Exo Is

- A local exocortex for Markdown-first LM wikis.
- A graph/exograph workspace where files, links, frontmatter, tags, searches, invocations, diffs, and provenance can become graph material.
- A CLI-accessible local work surface.
- A provider-neutral search/read substrate with room for custom search providers.
- A local Markdown/exograph editor and browser.
- A backlinks, graph properties, and graph-viewer product direction.
- A workspace with terminals, split panes, and web viewers for local customization.
- A reliable plain terminal workspace.
- A context manager for local agent instructions such as `AGENTS.md`, `CLAUDE.md`, and runtime overlays.
- A search/read surface that agents can use to orient to the exograph.
- A direct-write invocation recorder that links mentions, commands, terminal transcripts, file changes, and diffs.
- A review surface for "what changed after I tagged this agent?"

## What Exo Is Not

V1 is not:

- a universal agent cockpit;
- a deep Claude Code/Codex/Pi harness manager;
- a scheduler/routine product;
- a third-party plugin marketplace;
- an MCP-first integration layer;
- a line-perfect authorship system;
- a proposal-first agent write system;
- a replacement for Cursor, Codex app, or provider-native agent UIs.

## Surviving User Journeys

### Write And Tag

The user works in a note and writes:

```md
@claude please turn the above into a crisp implementation plan
```

Exo recognizes the strict invocation syntax and offers a send action. The user confirms. Exo launches the configured command and passes a pointer prompt.

### Watch Or Ignore

The invocation runs in a normal terminal. The user can watch output, switch away, or close the window while Exo remains resident.

### Review What Changed

When the invocation exits, Exo refreshes the open document and shows a diff banner. The banner lists changed files and labels them with invocation-scoped attribution:

> Likely edited by `@claude` via Claude command at 10:42.

If another invocation or user edit overlapped, Exo labels attribution as ambiguous.

### Configure Agent Commands

The user configures named agent commands. Exo may ship templates, but the user owns the actual command string and cwd policy.

## Product Center

The product center is no longer "manage agents." It is:

> Make a local exocortex generative and agent-addressable while preserving local ownership, context, graph structure, and review.

This means Exo should prioritize:

- editor correctness;
- file refresh behavior;
- terminal reliability;
- search/read quality;
- CLI reliability;
- custom search-provider seams;
- graph/exograph primitives;
- user-defined LM wiki ontology;
- context files and overlays;
- direct-write change detection;
- diff review;
- invocation-scoped provenance.

## Near-Term Product Non-Goals

- No new routine UI.
- No new plugin management UI.
- No new promptable harness lifecycle features.
- No MCP agent lifecycle contracts.
- No new CLI agent lifecycle contracts until invocation proves itself.
- No ontology enforcement before invocation works.
- No machine-wide skill scanning before a skill-root model is explicitly designed.

These are not non-goals:

- CLI;
- custom search providers;
- exograph/graph views;
- user-defined LM wiki profiles and ontology;
- local-first graph maintenance.

They remain core to Exo. They are just not the first implementation slice of the pivot.

MCP may return later as a thin adapter over the CLI or command server if repeated use demands it. It should not survive the refactor as an active design constraint.

## Product Test

The pivot is working when Kenneth can:

1. write a note;
2. see backlinks and graph properties for that note;
3. open a basic graph/neighborhood view;
4. use provider-backed search to find related graph context;
5. tag `@claude`;
6. send the mention to a configured command;
7. watch a plain terminal run;
8. see the note refresh without losing unsaved edits;
9. toggle a diff showing what changed;
10. understand which invocation likely authored the change.

-- Exo | 2026-07-08
