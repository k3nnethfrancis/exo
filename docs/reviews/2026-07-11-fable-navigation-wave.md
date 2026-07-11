# Fable review: navigation and utility wave

Date: 2026-07-11

## Verdict

The product model is right: one mutually exclusive utility region, terminal creation separated from navigation, titlebar search, typed breadcrumbs, and a core-owned folder-index lifecycle.

The wave is not complete because the previous dual-surface model remains restorable through the editor pane tree.

## Must fix before the wave closes

1. Remove terminal and browser content kinds from the editor pane tree, including legacy `terminalTree` restoration. Migrate persisted layouts to editor-only leaves, bump the layout version, and remove the stale `inspectorCollapsed` compatibility field.
2. Make Preview rail selection non-creating. Render an empty Preview destination when it has no tabs, and do not switch silently to Terminal when the last tab closes.
3. Render files outside note roots as a single honest file breadcrumb rather than clickable relative segments that cannot pass IPC authorization.
4. Rewrite `CHANGELOG.md` Unreleased to describe the product that exists now rather than removed plugin, profile, tmux, and MCP regimes.

## Explicit deferrals

- Persisting utility destination/open state.
- Additional confirmation UX for explicit bulk folder-index creation.
- Attached Folders UI.
- The broad stale-doc cleanup, including removed `exo agents` commands.
- Richer Connections functionality.

## Command-readiness recommendation

Resume only after the four must-fix items. Keep the pure factual readiness model, but first decide where it belongs in the new shell. The likely home is inside Terminal near Command launch—not a new rail destination or region.

## Hard gate

- `pnpm ci:check` passes.
- A persisted legacy layout containing terminal/browser leaves decodes to an editor-only canvas.
- The packaged app restores a pre-wave user-data directory without mounting terminals outside the utility destination.
- One terminal session is never mounted in two docks.
- `CHANGELOG.md` is honest before push.
- Complete visual Computer Use confirmation when macOS is unlocked.

Source: headless `claude -p --model fable` review requested after commits `03ecaac`, `592df1c`, `ccacc66`, and `e0d43a4`.
