# Exo Architecture

## First-phase system boundary

Exo phase one deliberately rebuilds only the shell:
- workspace model
- editor model
- terminal model
- validation model

The first implementation should preserve seams for:
- runtime
- memory
- workcells
- datasets
- evals

but not rebuild them yet.

## Runtime seam

Renderer never touches the filesystem or processes directly.

The renderer talks to:
- Electron preload bridge
- typed desktop services

The desktop services own:
- file navigation
- note parsing and saving
- backlinks/tag/link indexing
- terminal lifecycle
- workspace config resolution

## Phase 1 UI contract

Three primary surfaces:
- sidebar
- editor
- terminal dock

One auxiliary knowledge surface:
- backlinks / tags / links / search results

The shell should be able to swap terminal dock position between right and bottom without changing the editor/document state model.

